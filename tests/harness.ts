/**
 * Device-free byte-compatibility gate.
 *
 * Cross-checks our pure-JS pipeline against the REAL stegcloak-rs WASM lib in
 * BOTH directions, plus internal identities. Run via `npm test` (which esbuild-
 * bundles this with the .wasm asset, then executes the bundle under Node).
 */
import { webcrypto } from "node:crypto";
// Real reference implementation (the exact lib GoofCord ships).
import { StegCloak } from "stegcloak-rs";
// Our pure-JS reimplementation.
import { hide as ourHide, reveal as ourReveal, isCloaked as ourIsCloaked, DecryptionError } from "../src/core/stegcloak";
import { conceal, extract } from "../src/stego/zwc";

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

console.log(`\n${failed === 0 ? "✅" : "❌"} harness: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
