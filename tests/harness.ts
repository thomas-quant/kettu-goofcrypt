/**
 * Device-free byte-compatibility gate.
 *
 * Cross-checks our pure-JS pipeline against the REAL stegcloak-rs WASM lib in
 * BOTH directions, plus internal identities. Run via `npm test` (which esbuild-
 * bundles this with the .wasm asset, then executes the bundle under Node).
 */
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
// Real reference implementation (the exact lib GoofCord ships).
import { StegCloak } from "stegcloak-rs";
// Our pure-JS reimplementation.
import { hide as ourHide, reveal as ourReveal, isCloaked as ourIsCloaked, DecryptionError } from "../src/core/stegcloak";
import { conceal, extract } from "../src/stego/zwc";
// Wave-0 CI assertions ([7]-[9]): ProbeReport schema, nextTick caret tripwire, D-09 vector.
import { nextTick } from "@noble/hashes/utils";
import { deriveKey } from "../src/crypto/argon";
import { fromBase64, toBase64 } from "../src/util/base64";
import {
    KDF_ERROR_CODES,
    KDF_ERROR_STATUS,
    MAX_CLOUD_KEY_UTF8_BYTES,
    MAX_KDF_KEYS,
    createDeriveRequest,
    parseDeriveRequest,
    parseDeriveResponse,
    parseErrorResponse,
    parseRevisionResponse,
} from "../src/cloud/contracts";
import type { ProbeReport } from "../src/settings";
import { initSettings, DEFAULTS } from "../src/settings";
import { runRemoteKdfStage3Checks } from "./remoteKdfStage3";

interface ArgonVector {
    version: number;
    algorithm: string;
    argonVersion: number;
    memoryKiB: number;
    passes: number;
    parallelism: number;
    outputBytes: number;
    passwordEncoding: string;
    saltEncoding: string;
    password: string;
    channelId: string;
    keyHex: string;
    keyBase64: string;
}

const ARGON_VECTOR = JSON.parse(readFileSync(
    "tests/fixtures/remoteKdf/argon2id-v1.json",
    "utf8",
)) as ArgonVector;

const rng = (n: number) => {
    const b = new Uint8Array(n);
    webcrypto.getRandomValues(b);
    return b;
};

const sc = new StegCloak();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
    if (cond) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? "  — " + detail : ""}`);
    }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const CHANNEL = ARGON_VECTOR.channelId; // snowflake-shaped salt

interface Case {
    name: string;
    msg: string;
    pw: string; // single password for hide
    cover: string;
}

const CASES: Case[] = [
    { name: "ascii, single-space cover", msg: "hello world", pw: "p1", cover: "Sending a normal message" },
    { name: "no-whitespace cover (S=0)", msg: "no whitespace cover", pw: "k", cover: "abcdefghij" },
    { name: "single-char cover", msg: "tiny", pw: "k", cover: "x" },
    { name: "tabs + multi-space runs", msg: "tabs and spaces", pw: "k", cover: "a\tb  c\n\nd   e" },
    { name: "NBSP + unicode whitespace", msg: "weird ws", pw: "pw", cover: "a b c　d" },
    { name: "leading/trailing whitespace", msg: "edges", pw: "pw", cover: "   padded   " },
    { name: "unicode message + emoji", msg: "unicode 😀 café — naïve", pw: "k", cover: "Hello there my friend" },
    { name: "long message (5k)", msg: "x".repeat(5000), pw: "k", cover: "a cover with several words here" },
];

console.log("\n[1] Cross-compat: ours.hide → theirs.reveal");
for (const c of CASES) {
    try {
        const stego = ourHide(c.msg, c.pw, CHANNEL, c.cover, rng);
        const back = sc.reveal(stego, c.pw, CHANNEL);
        check(c.name, back === c.msg, `got ${JSON.stringify(back.slice(0, 40))}`);
    } catch (e) {
        check(c.name, false, "threw " + (e as Error).message);
    }
}

console.log("\n[2] Cross-compat: theirs.hide → ours.reveal");
for (const c of CASES) {
    try {
        const stego = sc.hide(c.msg, c.pw, CHANNEL, c.cover);
        const back = ourReveal(stego, c.pw, CHANNEL);
        check(c.name, back === c.msg, `got ${JSON.stringify(back.slice(0, 40))}`);
    } catch (e) {
        check(c.name, false, "threw " + (e as Error).message);
    }
}

console.log("\n[3] isCloaked parity");
for (const c of CASES) {
    const oursStego = ourHide(c.msg, c.pw, CHANNEL, c.cover, rng);
    const theirsStego = sc.hide(c.msg, c.pw, CHANNEL, c.cover);
    check(`${c.name} (ours output)`, ourIsCloaked(oursStego) === StegCloak.isCloaked(oursStego));
    check(`${c.name} (theirs output)`, ourIsCloaked(theirsStego) === StegCloak.isCloaked(theirsStego));
    check(`${c.name} (plain cover not cloaked)`, ourIsCloaked(c.cover) === StegCloak.isCloaked(c.cover));
}

console.log("\n[4] conceal/extract round-trip identity");
{
    let ok = true;
    let badLen = -1;
    for (let i = 0; i < 2000; i++) {
        const buf = rng(((Math.random() * 256) | 0) + 1);
        if (!equalBytes(buf, extract(conceal(buf)))) {
            ok = false;
            badLen = buf.length;
            break;
        }
    }
    check("conceal/extract identity (2000 random buffers)", ok, ok ? "" : `mismatch at len=${badLen}`);
}

console.log("\n[5] wrong-password behaviour");
{
    const stego = sc.hide("secret text", "rightpass", CHANNEL, "cover words here");
    let threw = false;
    try {
        ourReveal(stego, "wrongpass", CHANNEL);
    } catch (e) {
        threw = e instanceof DecryptionError;
    }
    check("ours.reveal wrong password → DecryptionError", threw);

    // right password still works after a wrong attempt
    check("ours.reveal right password works", ourReveal(stego, "rightpass", CHANNEL) === "secret text");
}

console.log("\n[6] salt sensitivity (different channel ⇒ cannot decrypt)");
{
    const stego = sc.hide("channel-bound", "pw", CHANNEL, "some cover text");
    let threw = false;
    try {
        ourReveal(stego, "pw", "9999999999999999999");
    } catch {
        threw = true;
    }
    check("different salt → fails to decrypt", threw);
    check("correct salt → decrypts", ourReveal(stego, "pw", CHANNEL) === "channel-bound");
}

console.log("\n[7] ProbeReport serialization round-trip (SPIKE-01 off-device persistability)");
{
    // A fully-populated ProbeReport must survive JSON.stringify → JSON.parse with
    // deep equality — proving the schema is plain-JSON (no Map/Set/typed-array).
    const sample: ProbeReport = {
        version: 1,
        timestamp: 1717200000000,
        buildTag: "stable-12345",
        platform: "android",
        scannedKeys: 312,
        cryptoIsh: ["DCDCrypto", "NativeSodium", "DCDDAVEManager"],
        turboHits: [
            { name: "Sodium", methods: ["crypto_pwhash", "crypto_secretbox_easy"] },
            { name: "Aes", methods: ["encrypt", "decrypt"] },
        ],
        metroHits: [
            { prop: "crypto_pwhash", found: true, methods: ["crypto_pwhash", "crypto_pwhash_ALG_ARGON2ID13"] },
            { prop: "argon2id", found: false, methods: [] },
        ],
        subtle: false,
        candidates: [
            {
                name: "Sodium.crypto_pwhash",
                reachable: true,
                saltAccepted: false,
                outputKind: "raw32",
                byteMatch: false,
                crashed: false,
                error: "salt must be 16 bytes",
                timingMs: 42,
            },
        ],
        verdict: "RED",
    };
    const roundTripped: ProbeReport = JSON.parse(JSON.stringify(sample));
    // Stable re-stringify both sides for a deep-equality comparison.
    check(
        "ProbeReport round-trips through JSON with deep equality",
        JSON.stringify(sample) === JSON.stringify(roundTripped),
        "round-trip diverged",
    );
}

console.log("\n[8] nextTick macrotask-form caret tripwire (SPIKE-03 off-device half)");
{
    // The freeze fix depends on scripts/build.mjs rewriting noble's microtask
    // `nextTick` into a setTimeout macrotask. That build-time patch (.replace of
    // `export const nextTick = async () => { };`) silently no-ops if a noble
    // version bump changes the declaration's source form. This test harness is
    // bundled by scripts/test.mjs, which does NOT apply that build-time patch —
    // so the imported `nextTick` here is the UNPATCHED microtask form. Asserting
    // its runtime form would therefore test the wrong thing. Instead we assert
    // the build patch's EXACT target string still exists in the shipped noble
    // source, i.e. the build-time macrotask rewrite will still fire. That is the
    // true caret-regression tripwire. The on-device assertMacrotaskYield()
    // (Plan 02) is the runtime counterpart that checks the patched form in situ.
    const runtimeForm = String(nextTick); // documentation only: the unpatched form
    const require = createRequire(import.meta.url);
    // The package "exports" map blocks deep paths, so resolve the public ./utils
    // entry (CJS) and derive the ESM sibling the build plugin actually patches
    // (filter /@noble[\\/]hashes[\\/](esm[\\/])?utils\.js$/ in scripts/build.mjs).
    const cjsUtils = require.resolve("@noble/hashes/utils");
    const esmUtils = join(dirname(cjsUtils), "esm", "utils.js");
    const nobleSrc = readFileSync(esmUtils, "utf8");
    // This is the exact literal scripts/build.mjs .replace()s. If noble changes
    // it, the build patch fails (it throws) — catch that here, off-device.
    const buildPatchTarget = "export const nextTick = async () => { };";
    check(
        "build-time macrotask patch target still present in noble esm source",
        nobleSrc.includes(buildPatchTarget),
        `noble nextTick source drifted — build patch would fail. runtime form: ${runtimeForm.slice(0, 40)}`,
    );
}

console.log("\n[9] D-09 reference-key vector (SPIKE-04 honest-verdict CI target)");
{
    // The on-device native byte-match (D-09) compares a candidate's 32 raw bytes
    // against this committed reference. The reference is deriveKey(VEC_PW, CHANNEL)
    // — the same sync noble path that [1]/[2] already prove byte-compatible with
    // stegcloak-rs. NOTE: Phase-2 GATE-01 turns this into a structural gate; Phase 1
    // commits only the reference VALUE so downstream plans build against a fixed target.
    const VEC_PW = ARGON_VECTOR.password;
    const EXPECTED = fromBase64(ARGON_VECTOR.keyBase64);
    const key = deriveKey(VEC_PW, CHANNEL);
    let expectedHex = "";
    for (let i = 0; i < EXPECTED.length; i++) expectedHex += EXPECTED[i].toString(16).padStart(2, "0");
    check(
        "Argon fixture freezes exact GoofCord parameters and encodings",
        ARGON_VECTOR.version === 1
            && ARGON_VECTOR.algorithm === "argon2id"
            && ARGON_VECTOR.argonVersion === 19
            && ARGON_VECTOR.memoryKiB === 65536
            && ARGON_VECTOR.passes === 3
            && ARGON_VECTOR.parallelism === 1
            && ARGON_VECTOR.outputBytes === 32
            && ARGON_VECTOR.passwordEncoding === "utf8-exact-no-normalization"
            && ARGON_VECTOR.saltEncoding === "utf8-exact-no-normalization",
        "fixture metadata drifted",
    );
    check(
        "Argon fixture key encodings are canonical and identical",
        expectedHex === ARGON_VECTOR.keyHex && toBase64(EXPECTED) === ARGON_VECTOR.keyBase64,
        "fixture key encoding mismatch",
    );
    check("deriveKey(VEC_PW, CHANNEL) equals committed 32-byte vector", key.length === 32 && equalBytes(key, EXPECTED), `got [${Array.from(key).slice(0, 4).join(",")}…]`);
    // Cross-check the vector is from the byte-compat path (not a typo) by round-tripping
    // the SAME password+channel through the stegcloak-rs reference instance.
    check(
        "VEC_PW path is GoofCord byte-compatible (sc round-trip)",
        ourReveal(sc.hide("x", VEC_PW, CHANNEL, "cover"), VEC_PW, CHANNEL) === "x",
        "stegcloak-rs round-trip failed for VEC_PW",
    );
}

console.log("\n[10] Kettu null-hostile storage proxy (SPIKE-03 on-device init-crash guard)");
{
    // Faithfully mimics Kettu's reactive plugin.storage: object-typed values are
    // wrapped with `new Proxy()` for reactivity. Because `typeof null === "object"`,
    // an unguarded wrap of null throws "new proxy target must be an object" — the
    // exact on-device init crash a user hit. Node CI has no such proxy, so without
    // this stub the whole class of bug is invisible off-device.
    function makeKettuLikeStorage(): any {
        const handler: ProxyHandler<any> = {
            get(t, k) { return (t as any)[k]; },
            set(t, k, v) {
                const wrapped = typeof v === "object" ? new Proxy(v, handler) : v; // new Proxy(null) throws
                (t as any)[k] = wrapped;
                return true;
            },
        };
        return new Proxy({}, handler);
    }

    let initThrew = "";
    try {
        initSettings(makeKettuLikeStorage());
    } catch (e) {
        initThrew = (e as Error)?.message ?? String(e);
    }
    check("initSettings writes no null into a null-hostile reactive proxy", initThrew === "", initThrew);

    // The runtime disarm path (nativeProbe.ts) must clear the armed flag with a
    // primitive, never null — assigning null would re-trip the same proxy crash.
    let clearThrew = "";
    try {
        const s = makeKettuLikeStorage();
        initSettings(s);
        s.nativeProbeArmed = undefined; // disarm pattern used after a candidate call
    } catch (e) {
        clearThrew = (e as Error)?.message ?? String(e);
    }
    check("disarm via undefined does not crash the storage proxy", clearThrew === "", clearThrew);

    // Sanity: a literal `= null` assignment WOULD crash that proxy (documents why).
    let nullThrew = false;
    try {
        const s = makeKettuLikeStorage();
        s.nativeProbeArmed = null;
    } catch {
        nullThrew = true;
    }
    check("control: assigning null to the proxy does throw (mechanism confirmed)", nullThrew);
}

console.log("\n[11] Remote KDF v1 contracts (strict mobile boundary)");
{
    const revision = "A".repeat(43);
    const key1 = ARGON_VECTOR.keyBase64;
    const key2 = `${"A".repeat(43)}=`;
    const validResponse = {
        version: 1,
        settingsRevision: revision,
        keys: [{ slot: 0, key: key1 }, { slot: 1, key: key2 }],
    };

    check("derive request accepts exact minimum bounds", createDeriveRequest("1", "x").ok);
    check(
        "derive request counts cloud-key UTF-8 bytes",
        createDeriveRequest("9".repeat(20), "é".repeat(MAX_CLOUD_KEY_UTF8_BYTES / 2)).ok
            && !createDeriveRequest("1", "é".repeat((MAX_CLOUD_KEY_UTF8_BYTES / 2) + 1)).ok,
    );
    const invalidChannels = ["", "1".repeat(21), "-1", "1.0", "１２３", "1e3"];
    let channelsRejected = true;
    for (let i = 0; i < invalidChannels.length; i++) {
        if (createDeriveRequest(invalidChannels[i], "x").ok) channelsRejected = false;
    }
    check("derive request rejects non-decimal or out-of-bound channel strings", channelsRejected);
    check("derive request rejects an empty cloud key", !createDeriveRequest("1", "").ok);
    check(
        "request parser rejects account selectors and parameter overrides",
        parseDeriveRequest({ version: 1, channelId: "123", cloudEncryptionKey: "key" }).ok
            && !parseDeriveRequest({ version: 1, channelId: "123", cloudEncryptionKey: "key", userId: "victim" }).ok
            && !parseDeriveRequest({ version: 1, channelId: "123", cloudEncryptionKey: "key", m: 8 }).ok,
    );
    check("derive response accepts ordered multiple slots", parseDeriveResponse(validResponse).ok);

    const invalidResponses: unknown[] = [
        { ...validResponse, keys: [] },
        { ...validResponse, keys: new Array(MAX_KDF_KEYS + 1).fill(0).map((_, slot) => ({ slot, key: key1 })) },
        { ...validResponse, keys: [{ slot: 1, key: key1 }] },
        { ...validResponse, keys: [{ slot: 0, key: key1 }, { slot: 0, key: key2 }] },
        { ...validResponse, keys: [{ slot: 0, key: key1 }, { slot: 2, key: key2 }] },
        { ...validResponse, keys: [{ slot: 0, key: key1.slice(0, -1) }] },
        { ...validResponse, keys: [{ slot: 0, key: `${key1.slice(0, -1)}!` }] },
        { ...validResponse, keys: [{ slot: 0, key: toBase64(new Uint8Array(31)) }] },
        { ...validResponse, extra: true },
    ];
    let responsesRejected = true;
    for (let i = 0; i < invalidResponses.length; i++) {
        if (parseDeriveResponse(invalidResponses[i]).ok) responsesRejected = false;
    }
    check("derive response rejects malformed keys, slots, counts, and extras", responsesRejected);
    check(
        "revision response requires exact unpadded base64url SHA-256 shape",
        parseRevisionResponse({ version: 1, settingsRevision: revision }).ok
            && !parseRevisionResponse({ version: 1, settingsRevision: `${revision}=` }).ok
            && !parseRevisionResponse({ version: 1, settingsRevision: revision, extra: true }).ok,
    );
    check(
        "error codes retain the fixed HTTP mapping",
        JSON.stringify(KDF_ERROR_CODES) === JSON.stringify([
            "INVALID_REQUEST", "UNAUTHORIZED", "CLOUD_SETTINGS_MISSING", "PASSWORDS_NOT_SYNCED",
            "CLOUD_DECRYPT_FAILED", "KDF_BUSY", "KDF_FAILED",
        ])
            && KDF_ERROR_STATUS.INVALID_REQUEST === 400
            && KDF_ERROR_STATUS.UNAUTHORIZED === 401
            && KDF_ERROR_STATUS.CLOUD_SETTINGS_MISSING === 404
            && KDF_ERROR_STATUS.PASSWORDS_NOT_SYNCED === 409
            && KDF_ERROR_STATUS.CLOUD_DECRYPT_FAILED === 422
            && KDF_ERROR_STATUS.KDF_BUSY === 429
            && KDF_ERROR_STATUS.KDF_FAILED === 500,
    );
    let errorsAccepted = true;
    for (let i = 0; i < KDF_ERROR_CODES.length; i++) {
        if (!parseErrorResponse({ version: 1, error: { code: KDF_ERROR_CODES[i] } }).ok) errorsAccepted = false;
    }
    check(
        "error parser accepts only exact stable-code responses",
        errorsAccepted
            && !parseErrorResponse({ version: 1, error: { code: "WRONG_KEY" } }).ok
            && !parseErrorResponse({ version: 1, error: { code: "KDF_FAILED", detail: "secret" } }).ok,
    );
}

await runRemoteKdfStage3Checks(check);

console.log(`\n${failed === 0 ? "✅" : "❌"} harness: ${passed} passed, ${failed} failed\n`);
if (failed !== 0) throw new Error(`${failed} harness checks failed`);
