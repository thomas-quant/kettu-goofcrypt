/**
 * Shared remote-KDF cold-path coordination. Incoming state is bounded to exact
 * three-string snapshots; outgoing preparation never accepts or retains text.
 */
import { RemoteKdfError } from "../cloud/client";
import {
    ensureRemoteChannelKeys,
    invalidateRemoteOperations,
    prepareRemoteSend,
    remoteErrorMessage,
} from "../cloud/remoteKdf";
import { decryptWithRemoteKeys, parseCloakedPayload } from "../core/decrypt";
import { getRemoteDecryptKeySets } from "../core/remoteKeycache";
import {
    keySource,
    setKeySource,
    settings,
    type KeySource,
} from "../settings";
import { FluxDispatcher, showToast } from "./metro";

export const MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION = 200;
const MAX_REMOTE_COMPLETED_MESSAGES = 1000;

export interface RemoteMessageSnapshot {
    messageId: string;
    channelId: string;
    ciphertext: string;
}

export interface RemoteMessageUpdate {
    type: "MESSAGE_UPDATE";
    channelId: string;
    message: {
        id: string;
        channel_id: string;
        content: string;
    };
}

export interface RemoteColdPathStatus {
    incomingOperations: number;
    sendPreparations: number;
    waitingMessages: number;
    completedMessages: number;
}

export interface RemoteColdPathDependencies {
    ensureKeys(channelId: string): Promise<unknown>;
    prepareSend(channelId: string, slot: number): Promise<unknown>;
    decrypt(snapshot: RemoteMessageSnapshot): string | null;
    mark(): string;
    dispatch(action: RemoteMessageUpdate): void;
    toast(text: string): void;
    mode(): KeySource | null;
}

export interface RemoteColdPath {
    queueIncoming(snapshot: RemoteMessageSnapshot): "started" | "joined" | "overflow" | "ignored";
    queueSend(channelId: string, slot: number): "started" | "joined" | "ignored";
    hasCompleted(messageId: string): boolean;
    rememberCompleted(messageId: string): void;
    reset(): void;
    shutdown(): void;
    status(): RemoteColdPathStatus;
}

interface IncomingOperation {
    generation: number;
    waiting: Map<string, RemoteMessageSnapshot>;
}

interface SendOperation {
    generation: number;
    promise: Promise<unknown>;
}

function safeRemoteError(error: unknown): RemoteKdfError {
    return error instanceof RemoteKdfError ? error : new RemoteKdfError("REMOTE_UNAVAILABLE");
}

function validSnapshot(snapshot: RemoteMessageSnapshot): boolean {
    return !!snapshot
        && typeof snapshot.messageId === "string"
        && snapshot.messageId.length > 0
        && typeof snapshot.channelId === "string"
        && snapshot.channelId.length > 0
        && typeof snapshot.ciphertext === "string"
        && snapshot.ciphertext.length > 0;
}

export function createRemoteColdPath(dependencies: RemoteColdPathDependencies): RemoteColdPath {
    const incoming = new Map<Promise<unknown>, IncomingOperation>();
    const sends = new Map<string, SendOperation>();
    const completed = new Set<string>();
    let generation = 0;
    let closed = false;

    function active(operationGeneration: number): boolean {
        return !closed && operationGeneration === generation && dependencies.mode() === "remote";
    }

    function rememberCompleted(messageId: string): void {
        if (!messageId) return;
        completed.delete(messageId);
        completed.add(messageId);
        if (completed.size <= MAX_REMOTE_COMPLETED_MESSAGES) return;
        const ids = Array.from(completed);
        completed.delete(ids[0]);
    }

    function settleIncoming(promise: Promise<unknown>, success: boolean): void {
        const operation = incoming.get(promise);
        if (!operation) return;
        incoming.delete(promise);
        const canDispatch = success && active(operation.generation);
        const snapshots = canDispatch ? Array.from(operation.waiting.values()) : [];
        operation.waiting.clear();
        if (!canDispatch) return;
        for (let i = 0; i < snapshots.length; i++) {
            const snapshot = snapshots[i];
            let plaintext: string | null = null;
            try {
                plaintext = dependencies.decrypt(snapshot);
            } catch {
                plaintext = null;
            }
            if (plaintext === null || !active(operation.generation)) continue;
            rememberCompleted(snapshot.messageId);
            try {
                dependencies.dispatch({
                    type: "MESSAGE_UPDATE",
                    channelId: snapshot.channelId,
                    message: {
                        id: snapshot.messageId,
                        channel_id: snapshot.channelId,
                        content: dependencies.mark() + plaintext,
                    },
                });
            } catch {
                /* Dispatch failure must not expose caught host values. */
            }
        }
    }

    function queueIncoming(snapshot: RemoteMessageSnapshot): "started" | "joined" | "overflow" | "ignored" {
        if (closed || dependencies.mode() !== "remote" || !validSnapshot(snapshot)) return "ignored";
        let promise: Promise<unknown>;
        try {
            promise = dependencies.ensureKeys(snapshot.channelId);
        } catch (error) {
            promise = Promise.reject(safeRemoteError(error));
        }
        let operation = incoming.get(promise);
        const result = operation ? "joined" : "started";
        if (!operation) {
            operation = { generation, waiting: new Map() };
            incoming.set(promise, operation);
            void promise.then(
                () => settleIncoming(promise, true),
                () => settleIncoming(promise, false),
            );
        }
        if (operation.waiting.has(snapshot.messageId)) {
            operation.waiting.set(snapshot.messageId, {
                messageId: snapshot.messageId,
                channelId: snapshot.channelId,
                ciphertext: snapshot.ciphertext,
            });
            return result;
        }
        if (operation.waiting.size >= MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION) return "overflow";
        operation.waiting.set(snapshot.messageId, {
            messageId: snapshot.messageId,
            channelId: snapshot.channelId,
            ciphertext: snapshot.ciphertext,
        });
        return result;
    }

    function settleSend(key: string, operation: SendOperation, error?: unknown): void {
        if (sends.get(key) !== operation) return;
        sends.delete(key);
        if (!active(operation.generation)) return;
        if (error === undefined) {
            dependencies.toast("GoofCrypt: remote key ready — send again");
            return;
        }
        dependencies.toast(`GoofCrypt: ${remoteErrorMessage(safeRemoteError(error))}`);
    }

    function queueSend(channelId: string, slot: number): "started" | "joined" | "ignored" {
        if (
            closed
            || dependencies.mode() !== "remote"
            || typeof channelId !== "string"
            || !channelId
            || !Number.isInteger(slot)
            || slot < 0
            || slot >= 8
        ) {
            return "ignored";
        }
        const key = `${channelId}|${slot}`;
        if (sends.has(key)) return "joined";
        let promise: Promise<unknown>;
        try {
            promise = dependencies.prepareSend(channelId, slot);
        } catch (error) {
            promise = Promise.reject(safeRemoteError(error));
        }
        const operation = { generation, promise };
        sends.set(key, operation);
        void promise.then(
            () => settleSend(key, operation),
            (error) => settleSend(key, operation, error),
        );
        return "started";
    }

    function reset(): void {
        generation += 1;
        incoming.clear();
        sends.clear();
        completed.clear();
    }

    function shutdown(): void {
        if (closed) return;
        closed = true;
        reset();
    }

    function status(): RemoteColdPathStatus {
        const operations = Array.from(incoming.values());
        let waitingMessages = 0;
        for (let i = 0; i < operations.length; i++) waitingMessages += operations[i].waiting.size;
        return {
            incomingOperations: incoming.size,
            sendPreparations: sends.size,
            waitingMessages,
            completedMessages: completed.size,
        };
    }

    return {
        queueIncoming,
        queueSend,
        hasCompleted: (messageId) => completed.has(messageId),
        rememberCompleted,
        reset,
        shutdown,
        status,
    };
}

let production: RemoteColdPath | null = null;

export function initRemoteColdPath(): void {
    production?.shutdown();
    production = createRemoteColdPath({
        ensureKeys: ensureRemoteChannelKeys,
        prepareSend: prepareRemoteSend,
        decrypt(snapshot) {
            const parsed = parseCloakedPayload(snapshot.ciphertext);
            if (!parsed) return null;
            return decryptWithRemoteKeys(parsed, getRemoteDecryptKeySets(snapshot.channelId))?.text ?? null;
        },
        mark: () => settings().mark,
        dispatch: (action) => FluxDispatcher().dispatch(action),
        toast: showToast,
        mode: keySource,
    });
}

export function queueRemoteDecrypt(snapshot: RemoteMessageSnapshot): "started" | "joined" | "overflow" | "ignored" {
    return production?.queueIncoming(snapshot) ?? "ignored";
}

export function queueRemoteSendPreparation(channelId: string, slot: number): "started" | "joined" | "ignored" {
    return production?.queueSend(channelId, slot) ?? "ignored";
}

export function isRemoteMessageCompleted(messageId: string): boolean {
    return production?.hasCompleted(messageId) ?? false;
}

export function rememberRemoteMessageCompleted(messageId: string): void {
    production?.rememberCompleted(messageId);
}

export function resetRemoteColdPath(): void {
    production?.reset();
}

export function shutdownRemoteColdPath(): void {
    production?.shutdown();
    production = null;
}

export function remoteColdPathStatus(): RemoteColdPathStatus {
    return production?.status() ?? {
        incomingOperations: 0,
        sendPreparations: 0,
        waitingMessages: 0,
        completedMessages: 0,
    };
}

/** Official mode transition used by both settings UI and commands. */
export function changeKeySource(value: unknown): boolean {
    if (value !== "manual" && value !== "remote") return false;
    const before = keySource();
    if (before === value) return true;
    if (!setKeySource(value)) return false;
    resetRemoteColdPath();
    invalidateRemoteOperations();
    return true;
}
