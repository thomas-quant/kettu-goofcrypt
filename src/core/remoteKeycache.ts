/**
 * Versioned ordered cache for remote-derived channel keys. This is deliberately
 * separate from the manual passwordId-indexed cache in keycache.ts.
 */
import { parseDeriveResponse, parseRevisionResponse, type KdfDeriveResponse, type KdfRevisionResponse } from "../cloud/contracts";
import { fromBase64, toBase64 } from "../util/base64";

export const REMOTE_KEY_CACHE_VERSION = 1;
export const MAX_REMOTE_REVISIONS_PER_CHANNEL = 3;

export interface RemoteChannelKeySet {
    settingsRevision: string;
    keys: string[];
    sendCapable: boolean;
}

export interface RemoteKeyCacheV1 {
    version: 1;
    currentRevision?: string;
    revisionCheckedAt?: number;
    channels: Record<string, RemoteChannelKeySet[]>;
}

export interface RemoteKeyCacheStore {
    remoteKeyCache?: RemoteKeyCacheV1;
}

export interface RemoteDecodedKeySet {
    settingsRevision: string;
    keys: Uint8Array[];
}

const CHANNEL_ID = /^[0-9]{1,20}$/;
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
let store: RemoteKeyCacheStore | null = null;

function emptyCache(): RemoteKeyCacheV1 {
    return { version: REMOTE_KEY_CACHE_VERSION, channels: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) if (allowed.indexOf(keys[i]) < 0) return false;
    return true;
}

function validRevision(value: unknown): value is string {
    return typeof value === "string"
        && parseRevisionResponse({ version: 1, settingsRevision: value }).ok;
}

function validKey(value: unknown): value is string {
    if (typeof value !== "string" || !KEY_BASE64.test(value)) return false;
    const decoded = fromBase64(value);
    return decoded.length === 32 && toBase64(decoded) === value;
}

function sanitizeSet(value: unknown): RemoteChannelKeySet | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ["settingsRevision", "keys", "sendCapable"])) return null;
    if (Object.keys(value).length !== 3 || !validRevision(value.settingsRevision)) return null;
    if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 8) return null;
    const keys: string[] = [];
    for (let i = 0; i < value.keys.length; i++) {
        if (!validKey(value.keys[i])) return null;
        keys.push(value.keys[i]);
    }
    if (typeof value.sendCapable !== "boolean") return null;
    return { settingsRevision: value.settingsRevision, keys, sendCapable: value.sendCapable };
}

function sanitizeEnvelope(value: unknown): RemoteKeyCacheV1 {
    if (
        !isRecord(value)
        || !hasOnlyKeys(value, ["version", "currentRevision", "revisionCheckedAt", "channels"])
        || value.version !== REMOTE_KEY_CACHE_VERSION
        || !isRecord(value.channels)
    ) {
        return emptyCache();
    }
    const currentRevision = value.currentRevision === undefined
        ? undefined
        : validRevision(value.currentRevision) ? value.currentRevision : undefined;
    const revisionCheckedAt = value.revisionCheckedAt === undefined
        ? undefined
        : Number.isSafeInteger(value.revisionCheckedAt) && (value.revisionCheckedAt as number) >= 0
            ? value.revisionCheckedAt as number
            : undefined;
    const channels: Record<string, RemoteChannelKeySet[]> = {};
    const channelIds = Object.keys(value.channels);
    for (let i = 0; i < channelIds.length; i++) {
        const channelId = channelIds[i];
        const rawSets = value.channels[channelId];
        if (!CHANNEL_ID.test(channelId) || !Array.isArray(rawSets)) continue;
        const sets: RemoteChannelKeySet[] = [];
        const seen: Record<string, boolean> = {};
        for (let j = 0; j < rawSets.length && sets.length < MAX_REMOTE_REVISIONS_PER_CHANNEL; j++) {
            const parsed = sanitizeSet(rawSets[j]);
            if (!parsed || seen[parsed.settingsRevision]) continue;
            seen[parsed.settingsRevision] = true;
            parsed.sendCapable = sets.length === 0
                && currentRevision !== undefined
                && parsed.settingsRevision === currentRevision
                && parsed.sendCapable;
            sets.push(parsed);
        }
        if (sets.length > 0) channels[channelId] = sets;
    }
    const out: RemoteKeyCacheV1 = { version: REMOTE_KEY_CACHE_VERSION, channels };
    if (currentRevision !== undefined) out.currentRevision = currentRevision;
    if (revisionCheckedAt !== undefined) out.revisionCheckedAt = revisionCheckedAt;
    return out;
}

function current(): RemoteKeyCacheV1 {
    if (!store) throw new Error("remote key cache not initialised");
    const sanitized = sanitizeEnvelope(store.remoteKeyCache);
    store.remoteKeyCache = sanitized;
    return sanitized;
}

function cloneChannels(channels: Record<string, RemoteChannelKeySet[]>): Record<string, RemoteChannelKeySet[]> {
    const out: Record<string, RemoteChannelKeySet[]> = {};
    const ids = Object.keys(channels);
    for (let i = 0; i < ids.length; i++) {
        out[ids[i]] = channels[ids[i]].map((set) => ({
            settingsRevision: set.settingsRevision,
            keys: set.keys.slice(),
            sendCapable: set.sendCapable,
        }));
    }
    return out;
}

function demoteAll(channels: Record<string, RemoteChannelKeySet[]>): void {
    const ids = Object.keys(channels);
    for (let i = 0; i < ids.length; i++) {
        const sets = channels[ids[i]];
        for (let j = 0; j < sets.length; j++) sets[j].sendCapable = false;
    }
}

export function initRemoteKeyCache(persisted: RemoteKeyCacheStore): void {
    store = persisted;
    store.remoteKeyCache = sanitizeEnvelope(store.remoteKeyCache);
}

export function getRemoteAuthoritativeRevision(): string | undefined {
    return current().currentRevision;
}

export function getRemoteRevisionCheckedAt(): number | undefined {
    return current().revisionCheckedAt;
}

export function storeRemoteDerivedKeys(channelId: string, value: KdfDeriveResponse, checkedAt: number): boolean {
    const parsed = parseDeriveResponse(value);
    if (!CHANNEL_ID.test(channelId) || !parsed.ok || !Number.isSafeInteger(checkedAt) || checkedAt < 0 || !store) return false;
    const before = current();
    const channels = cloneChannels(before.channels);
    if (before.currentRevision !== parsed.value.settingsRevision) demoteAll(channels);

    const previous = channels[channelId] ?? [];
    const retained: RemoteChannelKeySet[] = [];
    for (let i = 0; i < previous.length; i++) {
        if (previous[i].settingsRevision !== parsed.value.settingsRevision) {
            retained.push({ ...previous[i], keys: previous[i].keys.slice(), sendCapable: false });
        }
    }
    const next: RemoteChannelKeySet = {
        settingsRevision: parsed.value.settingsRevision,
        keys: parsed.value.keys.map((entry) => entry.key),
        sendCapable: true,
    };
    channels[channelId] = [next, ...retained].slice(0, MAX_REMOTE_REVISIONS_PER_CHANNEL);
    store.remoteKeyCache = {
        version: REMOTE_KEY_CACHE_VERSION,
        currentRevision: parsed.value.settingsRevision,
        revisionCheckedAt: checkedAt,
        channels,
    };
    return true;
}

export function applyRemoteRevision(value: KdfRevisionResponse, checkedAt: number): { ok: boolean; changed: boolean } {
    const parsed = parseRevisionResponse(value);
    if (!parsed.ok || !Number.isSafeInteger(checkedAt) || checkedAt < 0 || !store) return { ok: false, changed: false };
    const before = current();
    const changed = before.currentRevision !== undefined && before.currentRevision !== parsed.value.settingsRevision;
    const channels = cloneChannels(before.channels);
    if (changed) demoteAll(channels);
    store.remoteKeyCache = {
        version: REMOTE_KEY_CACHE_VERSION,
        currentRevision: parsed.value.settingsRevision,
        revisionCheckedAt: checkedAt,
        channels,
    };
    return { ok: true, changed };
}

function decodeKeys(keys: string[]): Uint8Array[] | null {
    const out: Uint8Array[] = [];
    for (let i = 0; i < keys.length; i++) {
        if (!validKey(keys[i])) return null;
        out.push(Uint8Array.from(fromBase64(keys[i])));
    }
    return out;
}

export function getRemoteSendKeys(channelId: string): Uint8Array[] | null {
    if (!CHANNEL_ID.test(channelId)) return null;
    const cache = current();
    const first = cache.channels[channelId]?.[0];
    if (!first?.sendCapable || first.settingsRevision !== cache.currentRevision) return null;
    return decodeKeys(first.keys);
}

export function getRemoteDecryptKeySets(channelId: string): RemoteDecodedKeySet[] {
    if (!CHANNEL_ID.test(channelId)) return [];
    const sets = current().channels[channelId] ?? [];
    const out: RemoteDecodedKeySet[] = [];
    for (let i = 0; i < sets.length; i++) {
        const keys = decodeKeys(sets[i].keys);
        if (keys) out.push({ settingsRevision: sets[i].settingsRevision, keys });
    }
    return out;
}

export function clearRemoteKeyCache(): void {
    if (!store) return;
    store.remoteKeyCache = emptyCache();
}

export function remoteKeyCacheCounts(): { channels: number; sets: number } {
    const channels = current().channels;
    const ids = Object.keys(channels);
    let sets = 0;
    for (let i = 0; i < ids.length; i++) sets += channels[ids[i]].length;
    return { channels: ids.length, sets };
}
