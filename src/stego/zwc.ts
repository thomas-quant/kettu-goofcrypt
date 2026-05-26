/**
 * Zero-width-character steganography, byte-exact port of stegcloak-rs
 * (github:Milkshiift/stegcloak-rs, src/message.rs).
 *
 * Base-8 encoding: 3 bits per character, MSB-first, over 8 zero-width chars.
 * The concealed stream is distributed across the cover text's whitespace RUNS
 * (one slot per maximal run, chunk inserted immediately before each run,
 * remainder front-loaded). If the cover has no whitespace, the stream is
 * appended at the end.
 */

// Index order IS the base-8 alphabet (value 0..7 -> ZWC[value]).
export const ZWC = [
    "​", // 0 Zero Width Space
    "‌", // 1 Zero Width Non-Joiner
    "‍", // 2 Zero Width Joiner
    "⁠", // 3 Word Joiner
    "⁡", // 4 Function Application
    "⁢", // 5 Invisible Times
    "⁣", // 6 Invisible Separator
    "⁤", // 7 Invisible Plus
] as const;

const IDX = new Map<string, number>(ZWC.map((c, i) => [c, i]));

/**
 * Unicode White_Space property — must match Rust's `char::is_whitespace()`
 * exactly so that whitespace-run slotting is identical. Note: none of the 8
 * ZWC chars (U+200B..U+200D, U+2060..U+2064) are White_Space, so there is no
 * conflict between the payload chars and the cover's whitespace runs.
 */
export function isWhitespace(cp: string): boolean {
    const c = cp.codePointAt(0)!;
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true; // space, \t \n \v \f \r
    if (c === 0x85 || c === 0xa0) return true; // NEL, NBSP
    if (c === 0x1680) return true; // Ogham space mark
    if (c >= 0x2000 && c <= 0x200a) return true; // en quad .. hair space
    if (c === 0x2028 || c === 0x2029) return true; // line/paragraph separator
    if (c === 0x202f || c === 0x205f) return true; // narrow nbsp, medium math space
    if (c === 0x3000) return true; // ideographic space
    return false;
}

/** bytes -> ZWC string (base-8, MSB-first; trailing <3 bits left-shifted / zero-padded right). */
export function conceal(bytes: Uint8Array): string {
    let out = "";
    let acc = 0;
    let nbits = 0;
    for (let i = 0; i < bytes.length; i++) {
        acc = (acc << 8) | bytes[i];
        nbits += 8;
        while (nbits >= 3) {
            nbits -= 3;
            out += ZWC[(acc >>> nbits) & 0x7];
        }
    }
    if (nbits > 0) {
        out += ZWC[(acc << (3 - nbits)) & 0x7];
    }
    return out;
}

/** ZWC chars within `text` -> bytes (base-8, MSB-first; trailing <8 padding bits discarded). */
export function extract(text: string): Uint8Array {
    const out: number[] = [];
    let acc = 0;
    let nbits = 0;
    for (const ch of text) {
        const v = IDX.get(ch);
        if (v === undefined) continue;
        acc = (acc << 3) | v;
        nbits += 3;
        while (nbits >= 8) {
            nbits -= 8;
            out.push((acc >>> nbits) & 0xff);
        }
    }
    return Uint8Array.from(out);
}

/**
 * Distribute a ZWC string across the cover's whitespace runs.
 * Direct port of stegcloak-rs `embed()` (the distribution half).
 */
export function embed(cover: string, zwc: string): string {
    const zarr = Array.from(zwc);

    // Count maximal whitespace runs.
    let spacesCount = 0;
    let inSpace = false;
    for (const c of cover) {
        if (isWhitespace(c)) {
            if (!inSpace) {
                inSpace = true;
                spacesCount++;
            }
        } else {
            inSpace = false;
        }
    }

    if (spacesCount === 0) {
        return cover + zwc;
    }

    const base = Math.floor(zarr.length / spacesCount);
    const remainder = zarr.length % spacesCount;

    let result = "";
    let zi = 0;
    let currentSpace = 0;
    inSpace = false;

    for (const c of cover) {
        const isWs = isWhitespace(c);
        if (isWs && !inSpace) {
            const n = base + (currentSpace < remainder ? 1 : 0);
            for (let k = 0; k < n && zi < zarr.length; k++) {
                result += zarr[zi++];
            }
            currentSpace++;
            inSpace = true;
        } else if (!isWs && inSpace) {
            inSpace = false;
        }
        result += c;
    }

    // Any leftover (normally none: base*S + remainder === zarr.length).
    while (zi < zarr.length) result += zarr[zi++];

    return result;
}

/** True iff `text` contains any of the 8 ZWC chars. */
export function isCloaked(text: string): boolean {
    for (const ch of text) if (IDX.has(ch)) return true;
    return false;
}
