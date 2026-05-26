/**
 * Derived-key cache. Argon2id (64 MiB) is the one expensive step, so a key is
 * derived at most ONCE per (channelId, password) and reused forever:
 *   - in-memory Map for the hot path,
 *   - persisted (base64) into plugin storage so restarts don't re-derive,
 *   - a per-channel "winning password" hint so decrypt tries the likely one first.
 *
 * Derivation is ASYNC (argon2idAsync) so it never freezes the JS thread; the
 * sync getCachedKey() is used on hot paths (flux decrypt) and returns null on a
 * miss rather than blocking.
 *
 * Security caveat: persisted keys live in plaintext JSON on a device with no
 * keychain — same exposure as the stored passwords. Pre-shared-password crypto
 * for casual privacy, not a secure enclave.
 */
import { sha256 } from "@noble/hashes/sha2";
import { deriveKeyAsync } from "../crypto/argon";
import { utf8Encode } from "../crypto/deflate";
import { toBase64, fromBase64 } from "../util/base64";

export interface KeyCacheStore {
    /** channelId -> { passwordId -> base64(key) } */
    keys?: Record<string, Record<string, string>>;
}

const mem = new Map<string, Uint8Array>(); // `${channelId} ${password}` -> key
const pending = new Map<string, Promise<Uint8Array>>(); // dedupe concurrent derivations
const winners = new Map<string, string>(); // channelId -> password (in-memory)

let store: KeyCacheStore | null = null;

export function initKeyCache(persisted: KeyCacheStore): void {
    store = persisted;
    if (!store.keys) store.keys = {};
}

/**
 * Stable, collision-free, non-reversible id for a password within the persisted
 * key store. Must match the desktop key-derivation tool exactly (it imports this
 * function) so synced keys land under the same id.
 */
export function passwordId(password: string): string {
    return toBase64(sha256(utf8Encode(password))).slice(0, 22); // 128 bits
}

/**
 * Merge desktop-derived keys into the persisted cache so mobile never runs
 * Argon2 for those channels. Shape: { [channelId]: { [passwordId]: base64key } }.
 * Returns the number of keys imported.
 */
export function importKeys(keysObj: Record<string, Record<string, string>>): number {
    if (!store) return 0;
    if (!store.keys) store.keys = {};
    let n = 0;
    for (const cid of Object.keys(keysObj)) {
        const slot = (store.keys[cid] ??= {});
        const inner = keysObj[cid];
        for (const pid of Object.keys(inner)) {
            slot[pid] = inner[pid];
            n++;
        }
    }
    return n;
}

/** Synchronous: return a cached key (memory or persisted) or null. Never derives. */
export function getCachedKey(channelId: string, password: string): Uint8Array | null {
    const memKey = `${channelId} ${password}`;
    const hit = mem.get(memKey);
    if (hit) return hit;
    const b64 = store?.keys?.[channelId]?.[passwordId(password)];
    if (b64) {
        const key = fromBase64(b64);
        mem.set(memKey, key);
        return key;
    }
    return null;
}

/** Async: return the cached key or derive (argon2idAsync), caching the result. */
export function deriveKey(channelId: string, password: string): Promise<Uint8Array> {
    const cached = getCachedKey(channelId, password);
    if (cached) return Promise.resolve(cached);

    const memKey = `${channelId} ${password}`;
    const inflight = pending.get(memKey);
    if (inflight) return inflight;

    const p = (async () => {
        const key = await deriveKeyAsync(password, channelId);
        mem.set(memKey, key);
        if (store?.keys) (store.keys[channelId] ??= {})[passwordId(password)] = toBase64(key);
        return key;
    })();
    pending.set(memKey, p);
    p.finally(() => pending.delete(memKey));
    return p;
}

export function rememberWinner(channelId: string, password: string): void {
    winners.set(channelId, password);
}

export function orderPasswords(channelId: string, passwords: string[]): string[] {
    const win = winners.get(channelId);
    if (!win || !passwords.includes(win)) return passwords;
    return [win, ...passwords.filter((p) => p !== win)];
}

export function isCached(channelId: string, password: string): boolean {
    return getCachedKey(channelId, password) !== null;
}

export function clearMemory(): void {
    mem.clear();
    winners.clear();
    pending.clear();
}
