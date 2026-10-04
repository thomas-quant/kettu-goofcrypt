/**
 * Compression + UTF-8 helpers.
 *
 * stegcloak-rs uses raw DEFLATE (miniz_oxide compress_to_vec / decompress, no
 * zlib/gzip header). fflate's deflateRaw/inflateRaw are wire-compatible: only
 * the *decoder* must interoperate, so our compression level need not match the
 * Rust side (level 10) — the recipient inflates any valid raw-deflate stream.
 *
 * UTF-8 encoding is explicit; decoding uses fflate's strFromU8. No
 * TextEncoder/TextDecoder globals are required.
 */
import { deflateSync, inflateSync, strFromU8 } from "fflate";

// fflate 0.8.3 corrupts surrogate pairs when TextEncoder is absent.
export function utf8Encode(s: string): Uint8Array {
    const out = new Uint8Array(s.length * 3);
    let offset = 0;
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const low = s.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                c = 0x10000 + ((c - 0xd800) << 10) + low - 0xdc00;
                i++;
            } else c = 0xfffd;
        } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) {
            out[offset++] = c;
        } else if (c < 0x800) {
            out[offset++] = 0xc0 | (c >> 6);
            out[offset++] = 0x80 | (c & 0x3f);
        } else if (c < 0x10000) {
            out[offset++] = 0xe0 | (c >> 12);
            out[offset++] = 0x80 | ((c >> 6) & 0x3f);
            out[offset++] = 0x80 | (c & 0x3f);
        } else {
            out[offset++] = 0xf0 | (c >> 18);
            out[offset++] = 0x80 | ((c >> 12) & 0x3f);
            out[offset++] = 0x80 | ((c >> 6) & 0x3f);
            out[offset++] = 0x80 | (c & 0x3f);
        }
    }
    return out.subarray(0, offset);
}
export const utf8Decode = (b: Uint8Array): string => strFromU8(b);

// fflate's deflateSync/inflateSync are RAW DEFLATE (no zlib/gzip header),
// matching stegcloak-rs's miniz_oxide compress_to_vec / decompress.
export const compress = (data: Uint8Array): Uint8Array => deflateSync(data, { level: 9 });
export const decompress = (data: Uint8Array): Uint8Array => inflateSync(data);
