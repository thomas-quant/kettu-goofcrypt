/**
 * Shared remote-KDF cold-path coordination. Incoming state is bounded to exact
 * three-string snapshots; outgoing preparation never accepts or retains text.
 */
import { sha256 } from "@noble/hashes/sha2";
import { RemoteKdfError } from "../cloud/client";
import { utf8Encode } from "../crypto/deflate";
import { toBase64 } from "../util/base64";
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
    observeMessage(messageId: string, content: string | undefined): void;
    hasCompleted(messageId: string, content: string): boolean;
    rememberCompleted(messageId: string, content: string): void;
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
    const completed = new Map<string, string>();
    let generation = 0;
    let closed = false;

    function active(operationGeneration: number): boolean {
        return !closed && operationGeneration === generation && dependencies.mode() === "remote";
    }

    function contentId(content: string): string {
        return toBase64(sha256(utf8Encode(content)));
    }

    function rememberCompleted(messageId: string, content: string): void {
        if (!messageId) return;
        completed.delete(messageId);
        completed.set(messageId, contentId(content));
        if (completed.size <= MAX_REMOTE_COMPLETED_MESSAGES) return;
        const ids = Array.from(completed.keys());
        completed.delete(ids[0]);
    }

    function observeMessage(messageId: string, content: string | undefined): void {
        const operations = Array.from(incoming.values());
        for (let i = 0; i < operations.length; i++) {
            const snapshot = operations[i].waiting.get(messageId);
            if (snapshot && snapshot.ciphertext !== content) operations[i].waiting.delete(messageId);
        }
        if (content === undefined) completed.delete(messageId);
    }

    function settleIncoming(promise: Promise<unknown>, success: boolean): void {
        const operation = incoming.get(promise);
        if (!operation) return;
        try {
            if (!success || !active(operation.generation)) return;
            const snapshots = Array.from(operation.waiting.values());
            for (let i = 0; i < snapshots.length; i++) {
                const snapshot = snapshots[i];
                if (operation.waiting.get(snapshot.messageId) !== snapshot) continue;
                let plaintext: string | null = null;
                try {
                    plaintext = dependencies.decrypt(snapshot);
                } catch {
                    plaintext = null;
                }
                if (
                    plaintext === null
                    || !active(operation.generation)
                    || operation.waiting.get(snapshot.messageId) !== snapshot
                ) continue;
                const content = dependencies.mark() + plaintext;
                operation.waiting.delete(snapshot.messageId);
                rememberCompleted(snapshot.messageId, content);
                try {
                    dependencies.dispatch({
                        type: "MESSAGE_UPDATE",
                        channelId: snapshot.channelId,
                        message: {
                            id: snapshot.messageId,
                            channel_id: snapshot.channelId,
                            content,
                        },
                    });
                } catch {
                    /* Dispatch failure must not expose caught host values. */
                }
            }
        } finally {
            operation.waiting.clear();
            if (incoming.get(promise) === operation) incoming.delete(promise);
        }
    }

    function queueIncoming(snapshot: RemoteMessageSnapshot): "started" | "joined" | "overflow" | "ignored" {
        if (closed || dependencies.mode() !== "remote" || !validSnapshot(snapshot)) return "ignored";
        observeMessage(snapshot.messageId, snapshot.ciphertext);
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
        observeMessage,
        hasCompleted: (messageId, content) => {
            const fingerprint = completed.get(messageId);
            return fingerprint !== undefined && fingerprint === contentId(content);
        },
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

export function observeRemoteMessage(messageId: string, content: string | undefined): void {
    production?.observeMessage(messageId, content);
}

export function isRemoteMessageCompleted(messageId: string, content: string): boolean {
    return production?.hasCompleted(messageId, content) ?? false;
}

export function rememberRemoteMessageCompleted(messageId: string, content: string): void {
    production?.rememberCompleted(messageId, content);
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
