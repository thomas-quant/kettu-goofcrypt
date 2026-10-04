import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";

const directory = resolve(process.argv[2] ?? "site");
const source = readFileSync(`${directory}/index.js`, "utf8");
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
const vector = JSON.parse(readFileSync("tests/fixtures/remoteKdf/argon2id-v1.json", "utf8"));
assert.equal(createHash("sha256").update(source).digest("hex").slice(0, 16), manifest.hash);

for (const mode of ["manual", "remote"]) {
    const passwordId = createHash("sha256").update(vector.password).digest("base64").slice(0, 22);
    const store = {
        enabled: true,
        passwords: vector.password,
        cover: "public cover",
        mark: "",
        chosenIndex: 0,
        allowInsecureRng: false,
        keySource: mode,
        remoteSendSlot: 0,
        keys: { [vector.channelId]: { [passwordId]: vector.keyBase64 } },
        remoteHost: mode === "remote" ? "https://review.example.test" : "",
        remoteAuthToken: mode === "remote" ? "0123456789abcdef0123456789abcdef" : "",
        remoteAllowInsecureLocalhost: false,
        remoteKeyCache: {
            version: 1,
            currentRevision: "A".repeat(43),
            revisionCheckedAt: Date.now(),
            channels: {
                [vector.channelId]: [{ settingsRevision: "A".repeat(43), keys: [vector.keyBase64], sendCapable: true }],
            },
        },
    };
    const errors = [];
    const actions = {
        sendMessage(_cid, message) { return message.content; },
        editMessage(_cid, _id, message) { return message.content; },
        sendBotMessage() {},
    };
    const dispatcher = { dispatch() {} };
    const patcher = {
        instead(name, parent, callback) {
            const original = parent[name];
            parent[name] = function (...args) { return callback.call(this, args, original); };
            return () => { parent[name] = original; };
        },
        before(name, parent, callback) {
            const original = parent[name];
            parent[name] = function (...args) { callback(args); return original.apply(this, args); };
            return () => { parent[name] = original; };
        },
    };
    const vendetta = {
        plugin: { storage: store },
        patcher,
        metro: {
            common: { React: {}, ReactNative: {}, FluxDispatcher: dispatcher },
            findByProps: (...props) => props.includes("sendMessage") ? actions : undefined,
        },
        commands: { registerCommand: () => () => {} },
        logger: { log() {}, error(...args) { errors.push(args.map(String).join(" ")); } },
        ui: { toasts: { showToast() {} } },
    };
    const context = vm.createContext({
        vendetta,
        crypto: { getRandomValues: (array) => webcrypto.getRandomValues(array) },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        AbortController,
        Response,
        fetch: async () => { throw new Error("no external requests in bundle check"); },
    });
    const plugin = vm.runInContext(source, context).default;
    plugin.onLoad();
    assert.deepEqual(errors, []);
    try {
        for (const action of ["sendMessage", "editMessage"]) {
            const plaintext = `private ${mode} ${action} 👩‍💻`;
            const message = { content: plaintext };
            const args = action === "sendMessage" ? [vector.channelId, message] : [vector.channelId, "edited-id", message];
            const ciphertext = await actions[action](...args);
            assert.notEqual(ciphertext, plaintext);
            const incoming = { id: `bundle-${action}`, channel_id: vector.channelId, content: ciphertext };
            dispatcher.dispatch({ type: "MESSAGE_CREATE", message: incoming });
            assert.equal(incoming.content, plaintext);
            const revisedText = "new private version 👩‍💻";
            const revisedCipher = await actions.sendMessage(vector.channelId, { content: revisedText });
            const update = { id: incoming.id, channel_id: vector.channelId, content: revisedCipher };
            dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: update });
            assert.equal(update.content, revisedText);
            const reloaded = { id: incoming.id, channel_id: vector.channelId, content: ciphertext };
            dispatcher.dispatch({ type: "LOAD_MESSAGES_SUCCESS", channelId: vector.channelId, messages: [reloaded] });
            assert.equal(reloaded.content, plaintext);
        }
    } finally {
        plugin.onUnload();
    }
    console.log(`PASS built bundle without TextEncoder/Buffer: ${mode} sends, edits, and history`);
}
console.log(`PASS manifest hash and eval expression: ${manifest.hash}`);
