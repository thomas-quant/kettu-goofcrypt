/**
 * Plugin settings, persisted via Kettu's reactive storage proxy. Also holds the
 * key cache (see core/keycache). Defaults are applied lazily once storage loads.
 */
import type { KeyCacheStore } from "./core/keycache";

/**
 * Result of testing one native-crypto candidate (a reachable native module that
 * might reproduce the exact Argon2id derivation). Plain-JSON only — no
 * Uint8Array/Map/Set — so it survives JSON.stringify into plugin.storage and a
 * restart (D-01 persistability). Stores NO secret material: module names,
 * booleans, output-shape classification, timing — never key bytes or passwords.
 */
export interface CandidateResult {
    /** Native module / surface name that was probed (e.g. "Sodium", "crypto_pwhash"). */
    name: string;
    /** The candidate surface was found and callable. */
    reachable: boolean;
    /** The candidate accepted the real 19-byte channelId salt (not just a fixed 16-byte one). */
    saltAccepted: boolean;
    /** Shape of the candidate's return value when asked to derive. */
    outputKind: "raw32" | "phc-string" | "other" | "unknown";
    /** The candidate's 32 raw bytes byte-matched the noble reference (D-09). */
    byteMatch: boolean;
    /** The candidate hard-crashed (detected via the persisted armed flag, D-05). */
    crashed: boolean;
    /** JS-level error message if the candidate threw (non-secret). */
    error?: string;
    /** Wall-clock derivation time in ms, if measured. */
    timingMs?: number;
}

/**
 * Persisted, restart-survivable snapshot of the on-device native-crypto probe
 * (SPIKE-01). Plain-JSON only; non-secret only. Written via settings() and read
 * back after a restart (and surfaced via __goofcrypt.diag / /encrypt status).
 */
export interface ProbeReport {
    /** Schema version of this report (bump when the shape changes). */
    version: number;
    /** Date.now() when the probe ran. */
    timestamp: number;
    /** Discord/Hermes build tag — for the D-02 staleness check + D-10 device coverage. */
    buildTag: string | null;
    /** OS / platform string (D-10 device-coverage record). */
    platform: string | null;
    /** Number of nativeModuleProxy keys scanned. */
    scannedKeys: number;
    /** nativeModuleProxy key names matching the crypto-ish regex. */
    cryptoIsh: string[];
    /** TurboModule probe hits: module name + first method names found. */
    turboHits: Array<{ name: string; methods: string[] }>;
    /** metro.findByProps probe results per searched prop. */
    metroHits: Array<{ prop: string; found: boolean; methods: string[] }>;
    /** Whether globalThis.crypto.subtle is present. */
    subtle: boolean;
    /** Per-candidate derivation-test results (only populated by the manual --test path). */
    candidates: CandidateResult[];
    /** Overall verdict: GREEN = a byte-matching native path exists, RED = none, untested = enumeration-only. */
    verdict: "GREEN" | "RED" | "untested";
}

export interface Settings extends KeyCacheStore {
    /** Master toggle for ENCRYPTING outgoing messages. Decryption is always on. */
    enabled: boolean;
    /** Comma-separated pre-shared passwords (raw user input). */
    passwords: string;
    /** Visible cover text the secret is hidden inside (empty = invisible message). */
    cover: string;
    /** Prefix prepended to decrypted text so the user can tell it was decrypted. */
    mark: string;
    /** Index of the password used for sending (cycled via /encrypt). */
    chosenIndex: number;
    /** Opt-in to an INSECURE Math.random nonce if no secure RNG is found. */
    allowInsecureRng: boolean;
    /** Persisted native-crypto probe report (SPIKE-01); null until the probe runs. */
    nativeProbe?: ProbeReport | null;
    /** Crash-safety flag: candidate name set BEFORE a native call, cleared after (D-05). */
    nativeProbeArmed?: string | null;
    /** Enable zero-overhead-off Argon2 instrumentation (D-08); off by default. */
    debugInstrument?: boolean;
}

export const DEFAULTS: Settings = {
    enabled: false,
    passwords: "",
    cover: "",
    mark: "🔒 ",
    chosenIndex: 0,
    allowInsecureRng: false,
    keys: {},
    nativeProbe: null,
    nativeProbeArmed: null,
    debugInstrument: false,
};

let store: Settings | null = null;

export function initSettings(s: Settings): void {
    store = s;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        const d = (DEFAULTS as any)[k];
        // Never write null/undefined into Kettu's reactive plugin.storage proxy.
        // It wraps object-typed values with `new Proxy(value)` for reactivity, and
        // because `typeof null === "object"` that becomes `new Proxy(null)` →
        // "new proxy target must be an object" (on-device Hermes only; Node CI has
        // no such proxy so this never shows up in the harness). A null/undefined
        // default just stays absent — every read site already treats absent as
        // "not set yet" (`if (x)`, `x ?? null`). SPIKE-03 on-device finding.
        if (store[k] === undefined && d != null) (store as any)[k] = d;
    }
}

export function settings(): Settings {
    if (!store) throw new Error("settings not initialised");
    return store;
}

export function isReady(): boolean {
    return store !== null;
}

/** Pure: parse a comma-separated string into trimmed, de-duplicated entries. */
export function parsePasswords(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const parts = raw.split(",");
    for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t && !seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    return out;
}

/** Parsed, trimmed, de-duplicated, non-empty password list from settings. */
export function getPasswordList(): string[] {
    return parsePasswords(settings().passwords);
}

/** The currently-selected password for sending, or undefined if none configured. */
export function chosenPassword(): string | undefined {
    const list = getPasswordList();
    if (list.length === 0) return undefined;
    const i = ((settings().chosenIndex % list.length) + list.length) % list.length;
    return list[i];
}

/** Advance to the next password; returns the newly-selected one. */
export function cyclePassword(): string | undefined {
    const list = getPasswordList();
    if (list.length === 0) return undefined;
    settings().chosenIndex = (settings().chosenIndex + 1) % list.length;
    return list[settings().chosenIndex];
}

/** A short, safe-to-display hint of a password (first 2 chars). */
export function maskPassword(pw: string | undefined): string {
    if (!pw) return "(none)";
    return pw.slice(0, 2) + "…";
}
