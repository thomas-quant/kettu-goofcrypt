/**
 * On-load self-test. Catches transpile-induced runtime breakage on the REAL
 * device Hermes (e.g. the swc for...of iterator lowering that silently dropped
 * the first element) — things Node/CI cannot reproduce. Runs cheap checks (no
 * Argon2) and reports the first failure.
 */
import { parsePasswords } from "./settings";
import { passwordId } from "./core/keycache";
import { conceal, extract, isCloaked } from "./stego/zwc";
import { toBase64, fromBase64 } from "./util/base64";

/**
 * Index-loop byte comparator (Hermes-safe). Exported so the discord-layer probe
 * (src/discord/nativeProbe.ts) can reuse the EXACT comparison the harness uses
 * for the D-09 on-device byte-match — selfTest is a top-level src/ cross-cutting
 * utility, NOT in core/crypto, so importing it from discord is a sanctioned
 * sibling-utility edge, not an up-graph layering violation.
 */
export function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Returns null on success, or a short description of the first failed check. */
export function selfTest(): string | null {
    // 1. for...of / iterator integrity (the single-vs-duplicate password bug).
    const one = parsePasswords("solo");
    if (one.length !== 1 || one[0] !== "solo") return `parsePasswords single -> ${JSON.stringify(one)}`;
    const three = parsePasswords("aa,bb,cc");
    if (three.length !== 3 || three[0] !== "aa" || three[2] !== "cc") return `parsePasswords multi -> ${JSON.stringify(three)}`;

    // 2. zero-width stego round-trip (exercises string for...of in conceal/extract).
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 42, 7]);
    const stego = conceal(bytes);
    if (!isCloaked(stego)) return "isCloaked(conceal) false";
    if (isCloaked("plain visible text")) return "isCloaked(plain) true";
    if (!eqBytes(extract(stego), bytes)) return "extract(conceal) mismatch";

    // 3. base64 round-trip (typed-array indexing).
    const b64 = toBase64(bytes);
    if (!eqBytes(fromBase64(b64), bytes)) return "base64 round-trip mismatch";

    // 4. passwordId determinism + uniqueness (sha256 on-device; key-sync needs this stable).
    if (passwordId("alpha") !== passwordId("alpha")) return "passwordId nondeterministic";
    if (passwordId("alpha") === passwordId("beta")) return "passwordId collision";

    return null;
}
