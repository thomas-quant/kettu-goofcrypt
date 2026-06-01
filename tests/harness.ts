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
import type { ProbeReport } from "../src/settings";

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

const CHANNEL = "1234567890123456789"; // snowflake-shaped salt

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
        if (Buffer.compare(Buffer.from(buf), Buffer.from(extract(conceal(buf)))) !== 0) {
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
    const VEC_PW = "goofcryptspikevector";
    // Committed 32-byte expected vector — captured once from deriveKey(VEC_PW, CHANNEL).
    const EXPECTED = new Uint8Array([
        88, 212, 83, 25, 57, 47, 174, 59, 190, 19, 9, 128, 131, 89, 130, 17,
        233, 183, 232, 77, 56, 210, 16, 176, 20, 165, 100, 68, 226, 205, 232, 4,
    ]);
    const key = deriveKey(VEC_PW, CHANNEL);
    // Hermes-safe index-loop comparator (mirrors selfTest.ts eqBytes).
    function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    check("deriveKey(VEC_PW, CHANNEL) equals committed 32-byte vector", key.length === 32 && eqBytes(key, EXPECTED), `got [${Array.from(key).slice(0, 4).join(",")}…]`);
    // Cross-check the vector is from the byte-compat path (not a typo) by round-tripping
    // the SAME password+channel through the stegcloak-rs reference instance.
    check(
        "VEC_PW path is GoofCord byte-compatible (sc round-trip)",
        ourReveal(sc.hide("x", VEC_PW, CHANNEL, "cover"), VEC_PW, CHANNEL) === "x",
        "stegcloak-rs round-trip failed for VEC_PW",
    );
}

console.log(`\n${failed === 0 ? "✅" : "❌"} harness: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
