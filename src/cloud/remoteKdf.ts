/**
 * Mobile remote-KDF coordinator: configuration, ordered mutation commits,
 * revision freshness, shared cold operations, cooldown, and cache lifecycle.
 */
import {
    RemoteKdfError,
    createRemoteKdfClient,
    normalizeRemoteOrigin,
    normalizeRemoteToken,
    probeRemoteTransport,
    type RemoteBoundingMode,
    type RemoteClientConfiguration,
    type RemoteKdfClient,
    type RemoteKdfErrorCode,
} from "./client";
import { createDeriveRequest, type KdfDeriveResponse, type KdfRevisionResponse } from "./contracts";
import {
    clearRemoteKeyCache,
    getRemoteAuthoritativeRevision,
    getRemoteRevisionCheckedAt,
    getRemoteSendKey,
    initRemoteKeyCache,
    remoteKeyCacheCounts,
    storeRemoteDerivedKeys,
    applyRemoteRevision,
    MAX_REMOTE_REVISIONS_PER_CHANNEL,
} from "../core/remoteKeycache";
import {
    clearRemoteSession,
    clearRemoteVerification,
    isRemoteVerified,
    markRemoteVerified,
    remoteCloudKey,
    remoteSessionState,
    setRemoteCloudKey,
} from "./session";
import type { Settings } from "../settings";

export const REMOTE_REVISION_TTL_MS = 300000;
export const REMOTE_FAILURE_COOLDOWN_MS = 30000;

export interface RemoteKdfDependencies {
    clientFactory?: (configuration: RemoteClientConfiguration) => RemoteKdfClient;
    now?: () => number;
}

export interface RemoteKdfStatus {
    configured: boolean;
    supported: boolean;
    boundingMode: RemoteBoundingMode;
    keyPresent: boolean;
    ready: boolean;
    revisionKnown: boolean;
    revisionFresh: boolean;
    cachedChannels: number;
    cachedSets: number;
    pendingOperations: number;
    cooldowns: number;
    retention: number;
    ttlMs: number;
    lastCode?: RemoteKdfErrorCode;
}

interface RemoteCooldown {
    until: number;
    code: RemoteKdfErrorCode;
}

let store: Settings | null = null;
let client: RemoteKdfClient | null = null;
let clientFactory: (configuration: RemoteClientConfiguration) => RemoteKdfClient = createRemoteKdfClient;
let now: () => number = Date.now;
let closed = true;
let configGeneration = 0;
let mutationEpoch = 0;
let nextRequestOrder = 0;
let lastAppliedOrder = 0;
let inFlightRevision: Promise<KdfRevisionResponse> | undefined;
const inFlightDerives = new Map<string, Promise<KdfDeriveResponse>>();
const inFlightSendPreparations = new Map<string, Promise<void>>();
const cooldowns = new Map<string, RemoteCooldown>();
let lastCode: RemoteKdfErrorCode | undefined;

function errorCode(error: unknown): RemoteKdfErrorCode {
    return error instanceof RemoteKdfError ? error.code : "REMOTE_UNAVAILABLE";
}

function remoteError(error: unknown): RemoteKdfError {
    return error instanceof RemoteKdfError ? error : new RemoteKdfError("REMOTE_UNAVAILABLE");
}

function rejected<T>(error: unknown): Promise<T> {
    return Promise.reject(remoteError(error));
}

function fail(code: RemoteKdfErrorCode): never {
    throw new RemoteKdfError(code);
}

function requireStore(): Settings {
    if (!store || closed) fail("REMOTE_NOT_CONFIGURED");
    return store;
}

function buildClient(): RemoteKdfClient | null {
    const current = requireStore();
    if (!current.remoteHost || !current.remoteAuthToken) return null;
    try {
        const origin = normalizeRemoteOrigin(current.remoteHost, current.remoteAllowInsecureLocalhost);
        const token = normalizeRemoteToken(current.remoteAuthToken);
        return clientFactory({ origin, token });
    } catch (error) {
        lastCode = errorCode(error);
        return null;
    }
}

function activeClient(): RemoteKdfClient {
    requireStore();
    if (!client) fail("REMOTE_NOT_CONFIGURED");
    if (!client.capabilities().supported) fail("REMOTE_UNSUPPORTED");
    return client;
}

function invalidatePending(): void {
    client?.abortAll();
    inFlightRevision = undefined;
    inFlightDerives.clear();
    inFlightSendPreparations.clear();
    cooldowns.clear();
}

function applyLocalMutation(): void {
    const order = ++nextRequestOrder;
    lastAppliedOrder = order;
    mutationEpoch += 1;
}

function stale(): never {
    fail("REMOTE_STALE");
}

function operationKey(channelId: string): string {
    return `${configGeneration}|${getRemoteAuthoritativeRevision() ?? "unknown"}|${channelId}`;
}

function sendPreparationKey(channelId: string, slot: number): string {
    return `${operationKey(channelId)}|${slot}`;
}

function pruneCooldowns(timestamp = now()): void {
    const entries = Array.from(cooldowns.entries());
    for (let i = 0; i < entries.length; i++) {
        if (entries[i][1].until <= timestamp) cooldowns.delete(entries[i][0]);
    }
}

function shouldCooldown(code: RemoteKdfErrorCode): boolean {
    switch (code) {
        case "INVALID_REQUEST":
        case "UNAUTHORIZED":
        case "CLOUD_SETTINGS_MISSING":
        case "PASSWORDS_NOT_SYNCED":
        case "CLOUD_DECRYPT_FAILED":
        case "KDF_BUSY":
        case "KDF_FAILED":
        case "REMOTE_TIMEOUT":
        case "REMOTE_UNAVAILABLE":
        case "REMOTE_PROTOCOL_ERROR":
            return true;
        default:
            return false;
    }
}

function generationActive(generation: number): boolean {
    return !closed && generation === configGeneration;
}

function requireGeneration(generation: number): void {
    if (!generationActive(generation)) stale();
}

export function initRemoteKdf(persisted: Settings, dependencies: RemoteKdfDependencies = {}): void {
    invalidatePending();
    clearRemoteSession();
    store = persisted;
    initRemoteKeyCache(persisted);
    clientFactory = dependencies.clientFactory ?? createRemoteKdfClient;
    now = dependencies.now ?? Date.now;
    closed = false;
    configGeneration += 1;
    mutationEpoch = 0;
    nextRequestOrder = 0;
    lastAppliedOrder = 0;
    lastCode = undefined;
    client = buildClient();
}

export function saveRemoteConfiguration(host: string, token: string, allowInsecureLocalhost: boolean): void {
    const current = requireStore();
    const origin = normalizeRemoteOrigin(host, allowInsecureLocalhost);
    const normalizedToken = normalizeRemoteToken(token);
    if (
        current.remoteHost === origin
        && current.remoteAuthToken === normalizedToken
        && current.remoteAllowInsecureLocalhost === allowInsecureLocalhost
    ) {
        return;
    }

    invalidatePending();
    clearRemoteSession();
    clearRemoteKeyCache();
    configGeneration += 1;
    applyLocalMutation();
    current.remoteHost = origin;
    current.remoteAuthToken = normalizedToken;
    current.remoteAllowInsecureLocalhost = allowInsecureLocalhost;
    client = clientFactory({ origin, token: normalizedToken });
    lastCode = client.capabilities().supported ? undefined : "REMOTE_UNSUPPORTED";
}

export function forgetRemoteConfiguration(): void {
    const current = requireStore();
    invalidatePending();
    clearRemoteSession();
    clearRemoteKeyCache();
    configGeneration += 1;
    applyLocalMutation();
    current.remoteHost = "";
    current.remoteAuthToken = "";
    current.remoteAllowInsecureLocalhost = false;
    client = null;
    lastCode = "REMOTE_NOT_CONFIGURED";
}

export function setRemoteSessionKey(value: string): void {
    requireStore();
    invalidatePending();
    clearRemoteSession();
    configGeneration += 1;
    applyLocalMutation();
    setRemoteCloudKey(value);
    lastCode = undefined;
}

export function clearRemoteSessionKey(): void {
    requireStore();
    invalidatePending();
    clearRemoteSession();
    configGeneration += 1;
    applyLocalMutation();
}

/**
 * Cancel mode-owned work without deleting either persistent cache, credentials,
 * or the memory-only cloud key. Generation/order gates reject every late result.
 */
export function invalidateRemoteOperations(): void {
    requireStore();
    invalidatePending();
    configGeneration += 1;
    applyLocalMutation();
    clearRemoteVerification();
    lastCode = undefined;
}

export function refreshRemoteRevision(force = true): Promise<KdfRevisionResponse> {
    let remote: RemoteKdfClient;
    try {
        remote = activeClient();
    } catch (error) {
        return rejected(error);
    }
    const currentRevision = getRemoteAuthoritativeRevision();
    const checkedAt = getRemoteRevisionCheckedAt();
    const timestamp = now();
    const age = checkedAt === undefined ? undefined : timestamp - checkedAt;
    if (
        !force
        && currentRevision
        && age !== undefined
        && age >= 0
        && age < REMOTE_REVISION_TTL_MS
    ) {
        return Promise.resolve({ version: 1, settingsRevision: currentRevision });
    }
    if (inFlightRevision) return inFlightRevision;

    const generation = configGeneration;
    const order = ++nextRequestOrder;
    const pending = (async () => {
        try {
            const response = await remote.revision();
            if (!generationActive(generation) || order <= lastAppliedOrder) stale();
            const applied = applyRemoteRevision(response, now());
            if (!applied.ok) fail("REMOTE_PROTOCOL_ERROR");
            lastAppliedOrder = order;
            mutationEpoch += 1;
            if (applied.changed) clearRemoteVerification();
            lastCode = undefined;
            return response;
        } catch (error) {
            const normalized = remoteError(error);
            if (generationActive(generation)) lastCode = normalized.code;
            throw normalized;
        }
    })();
    inFlightRevision = pending;
    const clearPendingRevision = () => {
        if (inFlightRevision === pending) inFlightRevision = undefined;
    };
    void pending.then(clearPendingRevision, clearPendingRevision);
    return pending;
}

export function ensureRemoteRevisionFresh(): Promise<KdfRevisionResponse> {
    return refreshRemoteRevision(false);
}

export function refreshRemoteRevisionOnLoad(): void {
    if (!store?.remoteHost || !store.remoteAuthToken || closed) return;
    void refreshRemoteRevision(true).catch(() => undefined);
}

/** Explicit setup refresh: bypass cooldown but join the identical active derive. */
export function refreshRemoteChannel(channelId: string): Promise<KdfDeriveResponse> {
    let remote: RemoteKdfClient;
    try {
        remote = activeClient();
    } catch (error) {
        return rejected(error);
    }
    const cloudKey = remoteCloudKey();
    if (!cloudKey) return Promise.reject(new RemoteKdfError("REMOTE_KEY_REQUIRED"));
    const request = createDeriveRequest(channelId, cloudKey);
    if (!request.ok) return Promise.reject(new RemoteKdfError("REMOTE_PROTOCOL_ERROR"));

    const key = operationKey(channelId);
    const existing = inFlightDerives.get(key);
    if (existing) return existing;
    const generation = configGeneration;
    const epoch = mutationEpoch;
    const startingRevision = getRemoteAuthoritativeRevision();
    const order = ++nextRequestOrder;
    const pending = (async () => {
        try {
            const response = await remote.derive(channelId, cloudKey);
            if (
                !generationActive(generation)
                || epoch !== mutationEpoch
                || startingRevision !== getRemoteAuthoritativeRevision()
                || order <= lastAppliedOrder
            ) {
                stale();
            }
            if (!storeRemoteDerivedKeys(channelId, response, now())) fail("REMOTE_PROTOCOL_ERROR");
            lastAppliedOrder = order;
            mutationEpoch += 1;
            markRemoteVerified(response.settingsRevision, generation);
            cooldowns.delete(key);
            lastCode = undefined;
            return response;
        } catch (error) {
            const normalized = remoteError(error);
            // Do not let an older completion erase proof installed by a newer
            // mutation or recreate cooldown state after mode/config invalidation.
            if (
                generationActive(generation)
                && epoch === mutationEpoch
                && startingRevision === getRemoteAuthoritativeRevision()
                && order > lastAppliedOrder
            ) {
                clearRemoteVerification();
                if (shouldCooldown(normalized.code)) {
                    cooldowns.set(key, { until: now() + REMOTE_FAILURE_COOLDOWN_MS, code: normalized.code });
                }
                lastCode = normalized.code;
            }
            throw normalized;
        }
    })();
    inFlightDerives.set(key, pending);
    const clearPendingDerive = () => {
        if (inFlightDerives.get(key) === pending) inFlightDerives.delete(key);
    };
    void pending.then(clearPendingDerive, clearPendingDerive);
    return pending;
}

/** Cold-path derive with per-generation/revision/channel failure cooldown. */
export function ensureRemoteChannelKeys(channelId: string): Promise<KdfDeriveResponse> {
    try {
        requireStore();
        const key = operationKey(channelId);
        const existing = inFlightDerives.get(key);
        if (existing) return existing;
        const timestamp = now();
        pruneCooldowns(timestamp);
        const cooldown = cooldowns.get(key);
        if (cooldown && cooldown.until > timestamp) {
            lastCode = "REMOTE_COOLDOWN";
            return Promise.reject(new RemoteKdfError("REMOTE_COOLDOWN"));
        }
        return refreshRemoteChannel(channelId);
    } catch (error) {
        return rejected(error);
    }
}

/** Synchronous current-selected key lookup under the conservative revision TTL. */
export function getFreshRemoteSendKey(channelId: string, slot: number): Uint8Array | null {
    if (!store || closed || !client || !store.remoteHost || !store.remoteAuthToken) return null;
    if (!client.capabilities().supported) return null;
    const revision = getRemoteAuthoritativeRevision();
    const checkedAt = getRemoteRevisionCheckedAt();
    const age = checkedAt === undefined ? undefined : now() - checkedAt;
    if (!revision || age === undefined || age < 0 || age >= REMOTE_REVISION_TTL_MS) return null;
    return getRemoteSendKey(channelId, slot);
}

/** Revision-first scalar-only preparation shared by rapid send attempts. */
export function prepareRemoteSend(channelId: string, slot: number): Promise<void> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 8) {
        return Promise.reject(new RemoteKdfError("REMOTE_SLOT_UNAVAILABLE"));
    }
    try {
        requireStore();
    } catch (error) {
        return rejected(error);
    }
    const key = sendPreparationKey(channelId, slot);
    const existing = inFlightSendPreparations.get(key);
    if (existing) return existing;
    const generation = configGeneration;
    const pending = ensureRemoteRevisionFresh()
        .then(() => {
            requireGeneration(generation);
            if (getFreshRemoteSendKey(channelId, slot)) return undefined;
            return ensureRemoteChannelKeys(channelId).then(() => {
                requireGeneration(generation);
                if (!getFreshRemoteSendKey(channelId, slot)) fail("REMOTE_SLOT_UNAVAILABLE");
            });
        })
        .catch((error) => {
            const normalized = remoteError(error);
            if (generationActive(generation)) lastCode = normalized.code;
            throw normalized;
        });
    inFlightSendPreparations.set(key, pending);
    const clearPendingSend = () => {
        if (inFlightSendPreparations.get(key) === pending) inFlightSendPreparations.delete(key);
    };
    void pending.then(clearPendingSend, clearPendingSend);
    return pending;
}

export function clearRemoteCache(): void {
    requireStore();
    invalidatePending();
    clearRemoteKeyCache();
    clearRemoteVerification();
    applyLocalMutation();
}

export function remoteKdfStatus(): RemoteKdfStatus {
    pruneCooldowns();
    const session = remoteSessionState();
    const revision = store ? getRemoteAuthoritativeRevision() : undefined;
    const checkedAt = store ? getRemoteRevisionCheckedAt() : undefined;
    const revisionAge = checkedAt === undefined ? undefined : now() - checkedAt;
    const counts = store ? remoteKeyCacheCounts() : { channels: 0, sets: 0 };
    const capability = client?.capabilities() ?? probeRemoteTransport();
    const configured = !!store?.remoteHost && !!store.remoteAuthToken;
    return {
        configured,
        supported: capability.supported,
        boundingMode: capability.boundingMode,
        keyPresent: session.keyPresent,
        ready: configured && capability.supported && isRemoteVerified(revision, configGeneration),
        revisionKnown: revision !== undefined,
        revisionFresh: revisionAge !== undefined && revisionAge >= 0 && revisionAge < REMOTE_REVISION_TTL_MS,
        cachedChannels: counts.channels,
        cachedSets: counts.sets,
        pendingOperations: inFlightDerives.size + inFlightSendPreparations.size + (inFlightRevision ? 1 : 0),
        cooldowns: cooldowns.size,
        retention: MAX_REMOTE_REVISIONS_PER_CHANNEL,
        ttlMs: REMOTE_REVISION_TTL_MS,
        ...(lastCode ? { lastCode } : {}),
    };
}

export function formatRemoteKdfStatus(): string {
    const status = remoteKdfStatus();
    return [
        `configured ${status.configured ? "yes" : "no"}`,
        `transport ${status.supported ? status.boundingMode : "unsupported"}`,
        `session-key ${status.keyPresent ? "present" : "missing"}`,
        `ready ${status.ready ? "yes" : "no"}`,
        `revision ${status.revisionKnown ? (status.revisionFresh ? "fresh" : "stale") : "unknown"}`,
        `cache ${status.cachedChannels} channel(s)/${status.cachedSets} set(s)`,
        `pending ${status.pendingOperations}`,
        `cooldowns ${status.cooldowns}`,
        `retention ${status.retention}`,
        `ttl ${status.ttlMs}ms`,
        `last ${status.lastCode ?? "ok"}`,
    ].join(" · ");
}

export function remoteErrorMessage(error: unknown): string {
    const code = errorCode(error);
    const messages: Record<RemoteKdfErrorCode, string> = {
        INVALID_REQUEST: "remote request rejected",
        UNAUTHORIZED: "cloud token is invalid or expired",
        CLOUD_SETTINGS_MISSING: "no GoofCord cloud settings are stored",
        PASSWORDS_NOT_SYNCED: "save encrypted GoofCord settings containing passwords",
        CLOUD_DECRYPT_FAILED: "cloud encryption key is incorrect or settings are unreadable",
        KDF_BUSY: "remote KDF is busy; try again shortly",
        KDF_FAILED: "remote derivation failed",
        REMOTE_NOT_CONFIGURED: "remote KDF is not configured",
        REMOTE_KEY_REQUIRED: "enter the session cloud encryption key",
        REMOTE_TIMEOUT: "remote KDF timed out",
        REMOTE_UNAVAILABLE: "remote KDF is unavailable",
        REMOTE_PROTOCOL_ERROR: "remote KDF returned an invalid response",
        REMOTE_UNSUPPORTED: "this Kettu build lacks the required bounded network APIs",
        REMOTE_STALE: "remote state changed; refresh again",
        REMOTE_COOLDOWN: "remote KDF is cooling down; try again shortly",
        REMOTE_SLOT_UNAVAILABLE: "selected remote password slot is unavailable",
        REMOTE_SEND_REJECTED: "message not sent; text kept",
    };
    return messages[code];
}

export function shutdownRemoteKdf(): void {
    if (closed) return;
    closed = true;
    configGeneration += 1;
    mutationEpoch += 1;
    invalidatePending();
    clearRemoteSession();
    client = null;
}
