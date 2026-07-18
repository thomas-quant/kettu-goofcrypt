/**
 * Mobile remote-KDF coordinator: configuration, ordered mutation commits,
 * revision freshness, session readiness, and remote-only cache lifecycle.
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
    retention: number;
    ttlMs: number;
    lastCode?: RemoteKdfErrorCode;
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
let lastCode: RemoteKdfErrorCode | undefined;

function errorCode(error: unknown): RemoteKdfErrorCode {
    return error instanceof RemoteKdfError ? error.code : "REMOTE_UNAVAILABLE";
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
}

function applyLocalMutation(): void {
    const order = ++nextRequestOrder;
    lastAppliedOrder = order;
    mutationEpoch += 1;
}

function stale(): never {
    fail("REMOTE_STALE");
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

export function refreshRemoteRevision(force = true): Promise<KdfRevisionResponse> {
    const remote = activeClient();
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
            if (closed || generation !== configGeneration || order <= lastAppliedOrder) stale();
            const applied = applyRemoteRevision(response, now());
            if (!applied.ok) fail("REMOTE_PROTOCOL_ERROR");
            lastAppliedOrder = order;
            mutationEpoch += 1;
            if (applied.changed) clearRemoteVerification();
            lastCode = undefined;
            return response;
        } catch (error) {
            lastCode = errorCode(error);
            throw error instanceof RemoteKdfError ? error : new RemoteKdfError("REMOTE_UNAVAILABLE");
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

export function refreshRemoteChannel(channelId: string): Promise<KdfDeriveResponse> {
    const existing = inFlightDerives.get(channelId);
    if (existing) return existing;
    const remote = activeClient();
    const cloudKey = remoteCloudKey();
    if (!cloudKey) return Promise.reject(new RemoteKdfError("REMOTE_KEY_REQUIRED"));
    const request = createDeriveRequest(channelId, cloudKey);
    if (!request.ok) return Promise.reject(new RemoteKdfError("REMOTE_PROTOCOL_ERROR"));

    const generation = configGeneration;
    const epoch = mutationEpoch;
    const startingRevision = getRemoteAuthoritativeRevision();
    const order = ++nextRequestOrder;
    const pending = (async () => {
        try {
            const response = await remote.derive(channelId, cloudKey);
            if (
                closed
                || generation !== configGeneration
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
            lastCode = undefined;
            return response;
        } catch (error) {
            // A refresh that cannot strictly install its response is not proof
            // that the held cloud key still matches the authoritative blob.
            // Do not let an older stale completion erase proof installed by a
            // newer mutation; every intervening local/revision mutation already
            // performs its own appropriate invalidation.
            if (
                !closed
                && generation === configGeneration
                && epoch === mutationEpoch
                && startingRevision === getRemoteAuthoritativeRevision()
                && order > lastAppliedOrder
            ) {
                clearRemoteVerification();
            }
            lastCode = errorCode(error);
            throw error instanceof RemoteKdfError ? error : new RemoteKdfError("REMOTE_UNAVAILABLE");
        }
    })();
    inFlightDerives.set(channelId, pending);
    const clearPendingDerive = () => {
        if (inFlightDerives.get(channelId) === pending) inFlightDerives.delete(channelId);
    };
    void pending.then(clearPendingDerive, clearPendingDerive);
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
