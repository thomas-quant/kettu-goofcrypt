/**
 * Argon2id key derivation, matching stegcloak-rs (src/encrypt.rs):
 *   Params::new(m = 65536 KiB, t = 3, p = 1), Algorithm::Argon2id,
 *   Version::V0x13, output 32 bytes.
 *
 * salt = the Discord channelId (UTF-8 bytes); password = UTF-8. Deterministic,
 * so callers cache the result per (channelId, password) — see core/keycache.
 *
 * Note: @noble/hashes' argon2id is pure JS and intentionally not fast (no fast
 * 64-bit ints in JS). With m=64MiB this is the expensive step; it MUST be
 * cached, never run per-message.
 */
import { argon2id, argon2idAsync } from "@noble/hashes/argon2";
import { utf8Encode } from "./deflate";

export const KEY_LENGTH = 32;

const OPTS = {
    t: 3, // time cost (iterations)
    m: 65536, // memory cost in KiB = 64 MiB
    p: 1, // parallelism
    dkLen: KEY_LENGTH,
    version: 0x13, // Argon2 v1.3 (19)
} as const;

/** Synchronous — used only by the device-free harness / core/stegcloak. */
export function deriveKey(password: string, channelId: string): Uint8Array {
    return argon2id(utf8Encode(password), utf8Encode(channelId), OPTS);
}

/**
 * Async derivation used on-device. noble's argon2idAsync yields to the event
 * loop periodically, so the UI stays responsive instead of freezing during the
 * (expensive) 64 MiB derivation.
 */
// asyncTick = how often (ms) argon2idAsync yields to the event loop. With the
// build-time macrotask patch this keeps the UI responsive during derivation.
const ASYNC_OPTS = { ...OPTS, asyncTick: 50 };

export async function deriveKeyAsync(password: string, channelId: string): Promise<Uint8Array> {
    return argon2idAsync(utf8Encode(password), utf8Encode(channelId), ASYNC_OPTS);
}

/** Time one async derivation (ms), for the /encrypt bench command. */
export async function benchOnce(): Promise<number> {
    const t0 = Date.now();
    await argon2idAsync(utf8Encode("benchpassword"), utf8Encode("benchsaltvalue"), ASYNC_OPTS);
    return Date.now() - t0;
}
