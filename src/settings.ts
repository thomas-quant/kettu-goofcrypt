/**
 * Plugin settings, persisted via Kettu's reactive storage proxy. Also holds the
 * key cache (see core/keycache). Defaults are applied lazily once storage loads.
 */
import type { KeyCacheStore } from "./core/keycache";

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
}

export const DEFAULTS: Settings = {
    enabled: false,
    passwords: "",
    cover: "",
    mark: "🔒 ",
    chosenIndex: 0,
    allowInsecureRng: false,
    keys: {},
};

let store: Settings | null = null;

export function initSettings(s: Settings): void {
    store = s;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        if (store[k] === undefined) (store as any)[k] = (DEFAULTS as any)[k];
    }
}

export function settings(): Settings {
    if (!store) throw new Error("settings not initialised");
    return store;
}

export function isReady(): boolean {
    return store !== null;
}

/** Parsed, trimmed, de-duplicated, non-empty password list. */
export function getPasswordList(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of settings().passwords.split(",")) {
        const t = p.trim();
        if (t && !seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
    }
    return out;
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
