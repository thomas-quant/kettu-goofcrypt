/**
 * Desktop key-derivation tool for GoofCrypt key-sync.
 *
 * Argon2id (64 MiB) is too slow on mobile Hermes (~10s/chat). Since the key is
 * deterministic — argon2id(password, channelId) — you can derive it here at
 * native speed and import the result into the mobile plugin, so mobile runs
 * ZERO Argon2 for those chats.
 *
 * Usage (run with tsx so it shares the plugin's exact derivation code):
 *   npx tsx tools/derive-keys.mjs --passwords "p1,p2" --channels "111,222"
 *
 * Get a channel ID: enable Discord Developer Mode, right-click a DM/channel →
 * "Copy Channel ID". The output is a base64 bundle — paste it on mobile with
 *   /encrypt import:<bundle>
 */
import { deriveKey } from "../src/crypto/argon.ts";
import { passwordId } from "../src/core/keycache.ts";
import { toBase64 } from "../src/util/base64.ts";

function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const split = (s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const passwords = split(arg("--passwords"));
const channels = split(arg("--channels"));

if (passwords.length === 0 || channels.length === 0) {
    console.error('Usage: npx tsx tools/derive-keys.mjs --passwords "p1,p2" --channels "channelId1,channelId2"');
    process.exit(1);
}

const keys = {};
for (const c of channels) {
    keys[c] = {};
    for (const p of passwords) {
        process.stderr.write(`deriving channel ${c} / pw ${p.slice(0, 2)}…\n`);
        keys[c][passwordId(p)] = toBase64(deriveKey(p, c));
    }
}

const bundle = Buffer.from(JSON.stringify({ v: 1, keys })).toString("base64");
console.error(`\nDerived ${channels.length * passwords.length} key(s). Paste this on mobile with /encrypt import:\n`);
console.log(bundle);
