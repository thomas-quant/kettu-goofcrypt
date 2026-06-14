/**
 * Permanent on-device native-crypto probe (D-01) — the durable replacement for
 * the fire-and-forget `diagnose2.txt`. This is the ONLY new code allowed to
 * touch `vendetta.*` / `globalThis.nativeModuleProxy` / `__turboModuleProxy` /
 * metro. It MUST NOT be imported by core/ or crypto/ (it is discord layer).
 *
 * It does three things:
 *   - enumerateSurface()/runProbe(): scan the native surface into a persisted
 *     ProbeReport (SPIKE-01). Enumeration ONLY — never invokes native crypto.
 *   - reconcileArmedFlag(): D-05 poison detection — a still-set armed flag on
 *     load means a candidate hard-crashed the app last run; mark it crashed.
 *   - testCandidate(): the ONLY native-invoking function (called solely from the
 *     manual /encrypt diag --test verb). Tiered cheap-then-real params (D-04),
 *     armed-flag protection (D-05), and a byte-match vs the on-device noble
 *     reference for a real 19-byte salt (D-09).
 *
 * Module shape mirrors src/crypto/random.ts: module-level `let` singletons +
 * exported functions, NO `class`, NO generators. Array index loops ONLY — never
 * iterate a Map/Set with `for...of` (the swc iterator lowering drops the first
 * element under Discord's Hermes — see scripts/build.mjs + CONCERNS.md).
 *
 * LAYER NOTE: the byte-match comparator imports `eqBytes` from `../selfTest`.
 * selfTest is a top-level src/ cross-cutting utility (NOT core/crypto/stego/util),
 * so the discord layer MAY import it as a sibling utility — this is explicitly
 * NOT an up-graph layering violation. We reuse it (rather than inline a second
 * comparator) so the D-09 comparison matches the harness exactly.
 */
import { settings } from "../settings";
import type { ProbeReport, CandidateResult } from "../settings";
import { deriveKey } from "../crypto/argon"; // SYNC noble reference for D-09
import { eqBytes } from "../selfTest"; // sanctioned cross-cutting-util sibling import
import { fromBase64 } from "../util/base64"; // Hermes-safe base64 (no atob/Buffer)
import { noteError } from "../core/health";

/** D-09 real-length salt: a 19-byte Discord snowflake (matches harness.ts CHANNEL). */
const REAL_SALT = "1234567890123456789";

/** D-09 reference-vector password (the CI-committed vector, Plan 01). */
const VEC_PW = "goofcryptspikevector";

/** Cheap shape-probe params (m=8KiB, t=1) — learn the candidate shape without OOM. */
const CHEAP_PARAMS = { m: 8, t: 1, p: 1, dkLen: 32, version: 0x13 };

/** Real GoofCord-compatible params (m=64MiB, t=3, p=1) — the byte-exact derivation. */
const REAL_PARAMS = { m: 65536, t: 3, p: 1, dkLen: 32, version: 0x13 };

/** TurboModule candidate names to probe (ported from diagnose2.txt). */
const TURBO_CANDS = [
    "NativeCryptoModule",
    "DCDCrypto",
    "Sodium",
    "NativeSodium",
    "RNSodium",
    "DCDSodiumManager",
    "NativeDAVE",
    "DCDDAVEManager",
    "NativeMLS",
    "Aes",
];

/** metro.findByProps probe list (ported from diagnose2.txt). */
const METRO_PROBES = [
    "crypto_pwhash",
    "argon2id",
    "argon2",
    "crypto_pwhash_ALG_ARGON2ID13",
    "scrypt",
    "pbkdf2",
    "subtle",
    "secretbox",
];

const CRYPTO_RE = /crypt|sodium|nacl|argon|pwhash|kdf|scrypt|pbkdf|dave|hash/i;

/**
 * The shape of a candidate adapter: given Argon2 params + a salt, produce a
 * derivation result (Uint8Array | number[] | base64-string | PHC-string | …).
 * Built lazily by candidateAdapters() — handles are re-resolved on every call
 * (no memoization) to avoid the `_msgActions ??=` stale-handle bug (metro.ts).
 */
export type NativeArgonCandidate = (params: typeof CHEAP_PARAMS, salt: string) => any;

/** Try to read a Discord/Hermes build tag; null if none reliably reachable (A5). */
function detectBuildTag(): string | null {
    try {
        const v: any = (globalThis as any).vendetta;
        const ci = v?.metro?.common?.constants?.ClientInfoModule || v?.metro?.findByProps?.("Build", "Version");
        const tag = ci?.Build || ci?.Version || ci?.OTABuild;
        if (tag) return String(tag);
    } catch {
        /* ignore — A5 fallback to manual-only re-probe (Open Question 2) */
    }
    try {
        const hp: any = (globalThis as any).HermesInternal;
        const props = hp?.getRuntimeProperties?.();
        const ver = props?.["OSS Release Version"];
        if (ver) return "hermes:" + String(ver);
    } catch {
        /* ignore */
    }
    return null;
}

/** Best-effort OS/platform string (D-10 device-coverage record). */
function detectPlatform(): string | null {
    try {
        const v: any = (globalThis as any).vendetta;
        const Platform = v?.metro?.common?.ReactNative?.Platform;
        if (Platform?.OS) return String(Platform.OS) + (Platform.Version ? " " + String(Platform.Version) : "");
    } catch {
        /* ignore */
    }
    return null;
}

/**
 * Enumeration-only scan of the native surface (D-03). Every host access is in
 * its own try/catch because the vendetta/native API is `any`-typed and may be
 * absent. NEVER invokes a native crypto function. Array index loops only.
 */
export function enumerateSurface(): ProbeReport {
    const nmp: Record<string, any> = (globalThis as any).nativeModuleProxy || {};
    let keys: string[] = [];
    try {
        keys = Object.keys(nmp);
    } catch (e) {
        noteError("deriveFails", e);
    }
    const cryptoIsh: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        if (CRYPTO_RE.test(keys[i])) cryptoIsh.push(keys[i]);
    }

    const turbo = (globalThis as any).__turboModuleProxy;
    const turboHits: Array<{ name: string; methods: string[] }> = [];
    for (let i = 0; i < TURBO_CANDS.length; i++) {
        const n = TURBO_CANDS[i];
        let m: any;
        try {
            m = (turbo && turbo(n)) || nmp[n];
        } catch {
            /* skip — candidate absent */
        }
        if (m) {
            let methods: string[] = [];
            try {
                methods = Object.keys(m).slice(0, 20);
            } catch {
                /* ignore */
            }
            turboHits.push({ name: n, methods });
        }
    }

    const findByProps = (globalThis as any).vendetta?.metro?.findByProps;
    const metroHits: Array<{ prop: string; found: boolean; methods: string[] }> = [];
    for (let i = 0; i < METRO_PROBES.length; i++) {
        const p = METRO_PROBES[i];
        let mod: any;
        try {
            mod = findByProps?.(p);
        } catch {
            /* ignore */
        }
        let methods: string[] = [];
        if (mod) {
            try {
                methods = Object.keys(mod).slice(0, 10);
            } catch {
                /* ignore */
            }
        }
        metroHits.push({ prop: p, found: !!mod, methods });
    }

    let subtle = false;
    try {
        subtle = !!((globalThis as any).crypto && (globalThis as any).crypto.subtle);
    } catch {
        /* ignore */
    }

    return {
        version: 1,
        timestamp: Date.now(),
        buildTag: detectBuildTag(),
        platform: detectPlatform(),
        scannedKeys: keys.length,
        cryptoIsh,
        turboHits,
        metroHits,
        subtle,
        candidates: [],
        verdict: "untested",
    };
}

/**
 * Enumerate the surface and persist it via the settings() accessor (NEVER raw
 * plugin.storage). Enumeration ONLY — never invokes native crypto here (D-03).
 */
export function runProbe(): ProbeReport {
    const report = enumerateSurface();
    try {
        settings().nativeProbe = report;
    } catch (e) {
        noteError("deriveFails", e);
    }
    return report;
}

/**
 * D-05 poison detection. If `nativeProbeArmed` is still set on load, the named
 * candidate hard-crashed the app during its last test (it never reached the
 * `finally` that clears the flag) → mark it crashed/unsafe in the report so it
 * is skipped on future tests, then clear the flag.
 */
export function reconcileArmedFlag(report: ProbeReport): void {
    let armed: string | null | undefined;
    try {
        armed = settings().nativeProbeArmed;
    } catch {
        return;
    }
    if (!armed) return;
    // Record the crash in the report's candidate list (skip future tests).
    let found = false;
    for (let i = 0; i < report.candidates.length; i++) {
        if (report.candidates[i].name === armed) {
            report.candidates[i].crashed = true;
            found = true;
            break;
        }
    }
    if (!found) {
        report.candidates.push({
            name: armed,
            reachable: true,
            saltAccepted: false,
            outputKind: "unknown",
            byteMatch: false,
            crashed: true,
            error: "hard-crashed last run (armed flag survived)",
        });
    }
    try {
        settings().nativeProbe = report;
        // Clear with `undefined`, NOT null: Kettu's storage proxy wraps object-typed
        // values with new Proxy(), and `typeof null === "object"` makes that throw
        // "new proxy target must be an object" on-device. undefined is a primitive,
        // serializes to an absent key (= disarmed), and persists via the set trap.
        settings().nativeProbeArmed = undefined;
    } catch (e) {
        noteError("deriveFails", e);
    }
}

/** Race a promise against a timeout (ms) — guards against a hanging native call. */
function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let done = false;
        const id = setTimeout(() => {
            if (!done) {
                done = true;
                reject(new Error("timeout after " + ms + "ms"));
            }
        }, ms);
        Promise.resolve(p).then(
            (v) => {
                if (!done) {
                    done = true;
                    clearTimeout(id);
                    resolve(v);
                }
            },
            (e) => {
                if (!done) {
                    done = true;
                    clearTimeout(id);
                    reject(e);
                }
            },
        );
    });
}

/**
 * Normalize a candidate return into 32 raw bytes (or null if not raw-32).
 * Hermes-safe: uses fromBase64 from util/base64 (NEVER atob/Buffer/TextDecoder).
 * Handles Uint8Array, number[], and base64-string returns.
 */
function toBytes(v: any): Uint8Array | null {
    try {
        if (v instanceof Uint8Array) return v;
        if (Array.isArray(v)) return Uint8Array.from(v as number[]);
        if (v && typeof v === "object" && typeof v.length === "number" && typeof v[0] === "number") {
            // ArrayBuffer-like / typed-array-like
            const out = new Uint8Array(v.length);
            for (let i = 0; i < v.length; i++) out[i] = v[i] & 0xff;
            return out;
        }
        if (typeof v === "string") {
            // Could be a PHC string ("$argon2id$...") — those are NOT raw-32.
            if (v.charCodeAt(0) === 36 /* $ */) return null;
            const b = fromBase64(v);
            return b;
        }
    } catch {
        /* fall through */
    }
    return null;
}

/** Classify a candidate's derivation output shape. */
function classifyOutput(v: any): CandidateResult["outputKind"] {
    if (typeof v === "string" && v.charCodeAt(0) === 36) return "phc-string";
    const b = toBytes(v);
    if (b && b.length === 32) return "raw32";
    if (v == null) return "unknown";
    return "other";
}

/**
 * The ONLY native-invoking function (D-05). Called solely from the manual
 * /encrypt diag --test verb (Task 3) — never on load.
 *
 * A1 / Pitfall 4 SPIKE FINDING TO CONFIRM ON-DEVICE: the armed-flag write below
 * MUST reach disk BEFORE the native call for crash detection to work. Kettu's
 * plugin.storage is a reactive proxy that persists asynchronously — whether the
 * write is flushed synchronously before the native call is a MEDIUM-confidence
 * assumption. Task 4 (manual, on-device) verifies it: set flag → force-quit
 * mid-call → relaunch → confirm the flag survived. Record the result.
 *
 * Tiered (D-04): a cheap shape-probe (m=8,t=1) first; ONLY if the shape is
 * raw-32 AND the salt was accepted do we run ONE real (m=65536,t=3,p=1) pass and
 * byte-match its 32 bytes against the on-device noble reference (D-09) via
 * eqBytes. Native handles are re-resolved by the caller's adapter on each call
 * (no memoization — avoids the stale-handle bug).
 */
export async function testCandidate(name: string, fn: NativeArgonCandidate): Promise<CandidateResult> {
    const result: CandidateResult = {
        name,
        reachable: true,
        saltAccepted: false,
        outputKind: "unknown",
        byteMatch: false,
        crashed: false,
    };

    // 1. POISON FLAG before the call — must survive a hard native crash (A1).
    try {
        settings().nativeProbeArmed = name;
    } catch (e) {
        result.error = (e as Error)?.message ?? String(e);
    }

    try {
        // 2. Cheap-params shape probe with the REAL 19-byte salt.
        const shape = await withTimeout(fn(CHEAP_PARAMS, REAL_SALT), 8000);
        result.saltAccepted = shape != null;
        result.outputKind = classifyOutput(shape);

        // 3. Only on a clean raw-32 shape, do ONE real run + D-09 byte-match.
        if (result.outputKind === "raw32" && result.saltAccepted) {
            const t0 = Date.now();
            const real = await withTimeout(fn(REAL_PARAMS, REAL_SALT), 30000);
            result.timingMs = Date.now() - t0;
            const realBytes = toBytes(real);
            if (realBytes && realBytes.length === 32) {
                // on-device noble reference for the SAME 19-byte salt (D-09).
                // VEC_PW "goofcryptspikevector" is the CI-committed D-09 vector
                // password (Plan 01); a byte-match here means the candidate
                // reproduces the exact GoofCord-compatible derivation.
                const reference = deriveKey(VEC_PW, REAL_SALT);
                result.byteMatch = eqBytes(realBytes, reference);
            }
        }
    } catch (e) {
        result.error = (e as Error)?.message ?? String(e); // JS throw → caught, not fatal
    } finally {
        // 4. CLEAR the flag — reached only if the call did NOT hard-crash the app.
        // `undefined` not null: Kettu's storage proxy throws "new proxy target must
        // be an object" on null (typeof null === "object" → new Proxy(null)).
        try {
            settings().nativeProbeArmed = undefined;
        } catch {
            /* ignore */
        }
    }
    return result;
}

/**
 * Build per-candidate adapters from the persisted report's reachable surfaces.
 * Handles are RE-RESOLVED here on every call (no memoization) so a stale handle
 * never poisons a later run. Each adapter maps (params, salt) onto whatever the
 * native module exposes; absent shapes simply throw (caught by testCandidate).
 */
export function candidateAdapters(report: ProbeReport): Array<{ name: string; fn: NativeArgonCandidate }> {
    const out: Array<{ name: string; fn: NativeArgonCandidate }> = [];
    // Skip any candidate already known to crash (D-05).
    const crashed: Record<string, boolean> = {};
    for (let i = 0; i < report.candidates.length; i++) {
        if (report.candidates[i].crashed) crashed[report.candidates[i].name] = true;
    }

    // TurboModule / nativeModuleProxy candidates (e.g. Sodium.crypto_pwhash).
    for (let i = 0; i < report.turboHits.length; i++) {
        const name = report.turboHits[i].name;
        if (crashed[name]) continue;
        out.push({
            name,
            fn: (params, salt) => {
                const turbo = (globalThis as any).__turboModuleProxy;
                const nmp: Record<string, any> = (globalThis as any).nativeModuleProxy || {};
                const m = (turbo && turbo(name)) || nmp[name];
                if (!m) throw new Error("handle vanished");
                const f = m.argon2id || m.crypto_pwhash || m.argon2 || m.hash;
                if (typeof f !== "function") throw new Error("no argon-shaped method");
                return f(salt, params);
            },
        });
    }

    // metro.findByProps candidates (e.g. a JS module exposing crypto_pwhash).
    for (let i = 0; i < report.metroHits.length; i++) {
        const hit = report.metroHits[i];
        if (!hit.found || crashed[hit.prop]) continue;
        out.push({
            name: hit.prop,
            fn: (params, salt) => {
                const findByProps = (globalThis as any).vendetta?.metro?.findByProps;
                const mod = findByProps?.(hit.prop);
                if (!mod) throw new Error("handle vanished");
                const f = mod[hit.prop] || mod.argon2id || mod.argon2;
                if (typeof f !== "function") throw new Error("no argon-shaped method");
                return f(salt, params);
            },
        });
    }

    return out;
}

/** Compact one-line render for /encrypt status — mirrors healthSummary(). */
export function probeSummary(): string {
    let report: ProbeReport | null | undefined;
    try {
        report = settings().nativeProbe;
    } catch {
        return "";
    }
    if (!report) return " · probe: none (run /encrypt diag --probe)";
    let crashed = 0;
    for (let i = 0; i < report.candidates.length; i++) {
        if (report.candidates[i].crashed) crashed++;
    }
    return ` · probe: ${report.verdict}, ${report.candidates.length} cand, ${crashed} crashed`;
}

/**
 * Full, copyable digest of the persisted ProbeReport — the complete SPIKE-01
 * enumeration evidence (what native-crypto surface actually exists on-device),
 * formatted for a Clyde bot message. Lists are capped so the message stays under
 * Discord's 2000-char limit. Read-only; never invokes native crypto.
 */
export function probeDigest(): string {
    let r: ProbeReport | null | undefined;
    try {
        r = settings().nativeProbe;
    } catch {
        return "probe: (settings unavailable)";
    }
    if (!r) return "probe: none yet — pick action “diag: probe (enumerate)” to run it";
    const cap = (a: string[], n: number): string =>
        a.length === 0 ? "none" : a.slice(0, n).join(", ") + (a.length > n ? ` …(+${a.length - n})` : "");
    const turbo =
        r.turboHits.length === 0
            ? "none"
            : r.turboHits
                  .slice(0, 12)
                  .map((t) => `${t.name}[${t.methods.slice(0, 6).join("|")}]`)
                  .join("; ") + (r.turboHits.length > 12 ? ` …(+${r.turboHits.length - 12})` : "");
    const metro = r.metroHits.filter((m) => m.found).map((m) => m.prop);
    const cands =
        r.candidates.length === 0
            ? "none"
            : r.candidates
                  .map(
                      (c) =>
                          `${c.name}: reach=${c.reachable} salt=${c.saltAccepted} out=${c.outputKind} ` +
                          `match=${c.byteMatch} crash=${c.crashed}` +
                          (c.timingMs != null ? ` ${c.timingMs}ms` : "") +
                          (c.error ? ` err=${c.error}` : ""),
                  )
                  .join("\n  ");
    return (
        `verdict: ${r.verdict}\n` +
        `build: ${r.buildTag ?? "null"} · platform: ${r.platform ?? "null"}\n` +
        `scannedKeys: ${r.scannedKeys} · crypto.subtle: ${r.subtle}\n` +
        `cryptoIsh (${r.cryptoIsh.length}): ${cap(r.cryptoIsh, 40)}\n` +
        `turboHits (${r.turboHits.length}): ${turbo}\n` +
        `metroHits found: ${metro.length ? metro.join(", ") : "none"}\n` +
        `candidates (${r.candidates.length}):\n  ${cands}`
    );
}
