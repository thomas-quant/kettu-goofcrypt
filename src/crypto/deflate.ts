/**
 * Compression + UTF-8 helpers.
 *
 * stegcloak-rs uses raw DEFLATE (miniz_oxide compress_to_vec / decompress, no
 * zlib/gzip header). fflate's deflateRaw/inflateRaw are wire-compatible: only
 * the *decoder* must interoperate, so our compression level need not match the
 * Rust side (level 10) — the recipient inflates any valid raw-deflate stream.
 *
 * We use fflate's strToU8/strFromU8 for UTF-8 so we don't depend on
 * TextEncoder/TextDecoder being present in Hermes (Kettu doesn't declare them).
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";

export const utf8Encode = (s: string): Uint8Array => strToU8(s);
export const utf8Decode = (b: Uint8Array): string => strFromU8(b);

// fflate's deflateSync/inflateSync are RAW DEFLATE (no zlib/gzip header),
// matching stegcloak-rs's miniz_oxide compress_to_vec / decompress.
export const compress = (data: Uint8Array): Uint8Array => deflateSync(data, { level: 9 });
export const decompress = (data: Uint8Array): Uint8Array => inflateSync(data);
