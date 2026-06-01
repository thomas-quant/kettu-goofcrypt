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
import { nextTick } from "@noble/hashes/utils"; // the build-patched macrotask symbol
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

/**
 * On-device runtime tripwire for the @noble/hashes caret regression (D-06).
 *
 * noble's `argon2idAsync` yields the JS thread via `await nextTick()`. The build
 * (scripts/build.mjs) rewrites that symbol from the upstream empty-async-arrow
 * (a MICROTASK — does NOT yield to the render loop, so the UI freezes) to a
 * `setTimeout`-backed MACROTASK form. A future `^1.7.1 → 2.x` bump could revert
 * it to the microtask form and silently re-freeze. This asserts the runtime form
 * is NOT the empty-async-arrow microtask shape — the on-device counterpart to the
 * Plan 01 CI source-literal assertion.
 */
export function assertMacrotaskYield(): { ok: boolean; form: string } {
    const src = String(nextTick);
    // Empty async arrow `async () => {}` is the upstream microtask form (regressed).
    const isMicrotask = /async\s*\(\s*\)\s*=>\s*\{\s*\}/.test(src);
    return { ok: !isMicrotask, form: src.slice(0, 80) };
}

/**
 * Debug-flagged instrumented wrapper over the REAL deriveKeyAsync (D-06a / D-08).
 *
 * `debug` is a plain PARAMETER, never read from the settings module — argon.ts
 * is crypto layer and must not import settings (that would create a forbidden
 * crypto→settings up-graph edge). This mirrors random.ts's `rng: RandomBytes`
 * dependency-injection-by-parameter convention. When `debug` is false this
 * early-returns the plain `deriveKeyAsync` result with zero added overhead.
 *
 * A4 caveat: noble's internal `await nextTick()` count is NOT observable from
 * outside its closure. The `setInterval(0)` sampler instead proves whether
 * macrotasks FIRE during derivation (UI alive) versus zero samples across a
 * multi-second derivation (the JS thread is starved ⇒ effectively frozen).
 */
export async function deriveKeyAsyncInstrumented(password: string, channelId: string, debug = false) {
    if (!debug) return deriveKeyAsync(password, channelId);
    const t0 = Date.now();
    let firstYield = -1;
    const samples: number[] = [];
    const id = setInterval(() => {
        const t = Date.now() - t0;
        if (firstYield < 0) firstYield = t;
        samples.push(t);
    }, 0);
    try {
        const key = await deriveKeyAsync(password, channelId);
        return {
            key,
            totalMs: Date.now() - t0,
            firstYieldMs: firstYield,
            yieldSamples: samples.length,
            ...assertMacrotaskYield(),
        };
    } finally {
        clearInterval(id);
    }
}

/** Time one async derivation (ms), for the /encrypt bench command. */
export async function benchOnce(): Promise<number> {
    const t0 = Date.now();
    await argon2idAsync(utf8Encode("benchpassword"), utf8Encode("benchsaltvalue"), ASYNC_OPTS);
    return Date.now() - t0;
}

/**
 * Enriched bench readout for the /encrypt diag/bench command (D-06b). Runs ONE
 * derivation under the same setInterval(0) macrotask sampler as
 * deriveKeyAsyncInstrumented and returns a LOCKED contract that Plan 03's bench
 * wiring binds against:
 *   - totalMs: wall-clock derivation time
 *   - firstYieldMs: latency to the first fired macrotask (front-loaded first pass)
 *   - longestBlockMs: max gap between consecutive samples ⇒ the worst UI stall
 *   - yieldCount: number of macrotasks that fired (zero across a multi-second
 *     derivation ⇒ the JS thread was starved ⇒ effectively frozen)
 *   - ok / form: spread from assertMacrotaskYield() (the caret-regression tripwire)
 *
 * Still takes no settings — argon.ts is crypto layer and only measures here.
 * benchOnce()'s `Promise<number>` signature is left untouched so existing callers
 * do not break.
 */
export async function benchOnceDetailed(): Promise<{
    totalMs: number;
    firstYieldMs: number;
    longestBlockMs: number;
    yieldCount: number;
    ok: boolean;
    form: string;
}> {
    const t0 = Date.now();
    let firstYield = -1;
    let last = 0;
    let longestBlock = 0;
    const samples: number[] = [];
    const id = setInterval(() => {
        const t = Date.now() - t0;
        if (firstYield < 0) firstYield = t;
        const gap = t - last;
        if (gap > longestBlock) longestBlock = gap;
        last = t;
        samples.push(t);
    }, 0);
    try {
        await argon2idAsync(utf8Encode("benchpassword"), utf8Encode("benchsaltvalue"), ASYNC_OPTS);
        const totalMs = Date.now() - t0;
        // Account for the tail block between the last sample and completion.
        const tailGap = totalMs - last;
        if (tailGap > longestBlock) longestBlock = tailGap;
        return {
            totalMs,
            firstYieldMs: firstYield,
            longestBlockMs: longestBlock,
            yieldCount: samples.length,
            ...assertMacrotaskYield(),
        };
    } finally {
        clearInterval(id);
    }
}
