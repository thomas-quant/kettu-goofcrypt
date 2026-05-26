/**
 * Minimal base64 <-> Uint8Array, with no dependency on Buffer/atob/btoa
 * (none are guaranteed present in Hermes). Used to persist 32-byte derived keys.
 */
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
    const t = new Int16Array(128).fill(-1);
    for (let i = 0; i < CHARS.length; i++) t[CHARS.charCodeAt(i)] = i;
    return t;
})();

export function toBase64(bytes: Uint8Array): string {
    let out = "";
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + CHARS[n & 63];
    }
    const rem = bytes.length - i;
    if (rem === 1) {
        const n = bytes[i] << 16;
        out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + "=";
    }
    return out;
}

export function fromBase64(str: string): Uint8Array {
    let len = str.length;
    while (len > 0 && str[len - 1] === "=") len--;
    const outLen = (len * 3) >> 2;
    const out = new Uint8Array(outLen);
    let acc = 0;
    let bits = 0;
    let o = 0;
    for (let i = 0; i < len; i++) {
        const v = LOOKUP[str.charCodeAt(i)];
        if (v < 0) continue;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (acc >> bits) & 0xff;
        }
    }
    return out;
}
