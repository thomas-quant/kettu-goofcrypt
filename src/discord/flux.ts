/**
 * Incoming Discord message handling. Manual mode retains its local cache/warm
 * path; remote mode uses only strict remote cached keys and shared cold work.
 */
import {
    decryptWithCachedKeys,
    decryptWithRemoteKeys,
    parseCloakedPayload,
    type DecryptResult,
    type ParsedCloakedPayload,
    type RemoteDecryptResult,
} from "../core/decrypt";
import { getCachedKey, deriveKey } from "../core/keycache";
import { getRemoteDecryptKeySets } from "../core/remoteKeycache";
import { getPasswordList, keySource, settings, type KeySource } from "../settings";
import { noteError } from "../core/health";
import { isCloaked } from "../stego/zwc";
import {
    isRemoteMessageCompleted,
    queueRemoteDecrypt,
    rememberRemoteMessageCompleted,
    type RemoteMessageSnapshot,
} from "./remoteColdPath";
import { FluxDispatcher, showToast } from "./metro";

const MAX_COMPLETED_MESSAGE_IDS = 1000;

export interface FluxHandlerDependencies {
    mode(): KeySource | null;
    mark(): string;
    isCloaked(content: string): boolean;
    manualDecrypt(content: string, channelId: string): DecryptResult | null;
    startManual(message: any, channelId: string): void;
    parseRemote(content: string): ParsedCloakedPayload | null;
    remoteDecrypt(parsed: ParsedCloakedPayload, channelId: string): RemoteDecryptResult | null;
    queueRemote(snapshot: RemoteMessageSnapshot): void;
    hasCompleted(messageId: string): boolean;
    rememberCompleted(messageId: string): void;
}

let unpatch: (() => void) | null = null;
let productionHandler: ((payload: any) => void) | null = null;
let fluxGeneration = 0;
const deriving = new Set<string>();
const decryptedIds = new Set<string>();
let activeDerivations = 0;
let peakDerivations = 0;

function rememberManualCompleted(messageId: string): void {
    if (!messageId) return;
    decryptedIds.delete(messageId);
    decryptedIds.add(messageId);
    if (decryptedIds.size <= MAX_COMPLETED_MESSAGE_IDS) return;
    const ids = Array.from(decryptedIds);
    decryptedIds.delete(ids[0]);
}

function rememberCompleted(messageId: string): void {
    rememberManualCompleted(messageId);
    rememberRemoteMessageCompleted(messageId);
}

/** Derive missing manual keys, then re-dispatch the original manual message. */
function backgroundManualDecrypt(message: any, channelId: string): void {
    const id = String(message?.id ?? "");
    const passwords = getPasswordList();
    if (!id || passwords.length === 0 || deriving.has(id)) return;
    if (passwords.every((password) => getCachedKey(channelId, password))) return;
    deriving.add(id);
    const generation = fluxGeneration;
    const debug = settings().debugInstrument;
    if (debug) {
        activeDerivations++;
        if (activeDerivations > peakDerivations) peakDerivations = activeDerivations;
        try {
            vendetta.logger.log(`GoofCrypt[diag] backgroundDecrypt launch: active=${activeDerivations} peak=${peakDerivations}`);
        } catch {}
    }
    showToast("GoofCrypt: deriving key to decrypt (one-time for this chat)…");

    (async () => {
        for (let i = 0; i < passwords.length; i++) {
            const password = passwords[i];
            if (getCachedKey(channelId, password)) continue;
            try {
                await deriveKey(channelId, password);
            } catch (error) {
                noteError("deriveFails", error);
            }
        }
        if (generation !== fluxGeneration) return;
        const result = decryptWithCachedKeys(message.content, channelId, passwords);
        if (!result || generation !== fluxGeneration) return;
        rememberCompleted(id);
        try {
            FluxDispatcher().dispatch({
                type: "MESSAGE_UPDATE",
                channelId,
                message: { ...message, content: settings().mark + result.text },
            });
        } catch {
            try {
                vendetta.logger.error("GoofCrypt manual re-dispatch failed");
            } catch {}
        }
    })().finally(() => {
        deriving.delete(id);
        if (debug && activeDerivations > 0) activeDerivations--;
    });
}

export function createFluxHandler(dependencies: FluxHandlerDependencies): (payload: any) => void {
    function handleMessage(message: any, channelId: string | undefined): void {
        if (!message?.content || !channelId) return;
        const id = String(message.id ?? "");
        if (id && dependencies.hasCompleted(id)) return;
        const mark = dependencies.mark();
        if (mark && message.content.startsWith(mark)) return;

        const mode = dependencies.mode();
        if (mode === "manual") {
            if (!dependencies.isCloaked(message.content)) return;
            const result = dependencies.manualDecrypt(message.content, channelId);
            if (result) {
                message.content = mark + result.text;
                if (id) dependencies.rememberCompleted(id);
            } else {
                dependencies.startManual(message, channelId);
            }
            return;
        }
        if (mode !== "remote") return;

        const parsed = dependencies.parseRemote(message.content);
        if (!parsed) return;
        const result = dependencies.remoteDecrypt(parsed, channelId);
        if (result) {
            message.content = mark + result.text;
            if (id) dependencies.rememberCompleted(id);
            return;
        }
        if (!id) return;
        dependencies.queueRemote({
            messageId: id,
            channelId,
            ciphertext: message.content,
        });
    }

    return (payload: any): void => {
        switch (payload?.type) {
            case "MESSAGE_CREATE":
            case "MESSAGE_UPDATE":
                handleMessage(payload.message, payload.channelId ?? payload.message?.channel_id);
                break;
            case "LOAD_MESSAGES_SUCCESS":
                if (Array.isArray(payload.messages)) {
                    for (let i = 0; i < payload.messages.length; i++) {
                        const message = payload.messages[i];
                        handleMessage(message, payload.channelId ?? message?.channel_id);
                    }
                }
                break;
            case "MESSAGE_START_EDIT": {
                const mark = dependencies.mark();
                if (mark && typeof payload.content === "string" && payload.content.startsWith(mark)) {
                    payload.content = payload.content.slice(mark.length);
                }
                break;
            }
        }
    };
}

function createProductionHandler(): (payload: any) => void {
    return createFluxHandler({
        mode: keySource,
        mark: () => settings().mark,
        isCloaked,
        manualDecrypt: (content, channelId) => decryptWithCachedKeys(content, channelId, getPasswordList()),
        startManual: backgroundManualDecrypt,
        parseRemote: parseCloakedPayload,
        remoteDecrypt: (parsed, channelId) => decryptWithRemoteKeys(parsed, getRemoteDecryptKeySets(channelId)),
        queueRemote: queueRemoteDecrypt,
        hasCompleted: (id) => decryptedIds.has(id) || isRemoteMessageCompleted(id),
        rememberCompleted,
    });
}

export function patchFlux(): void {
    if (unpatch) return;
    productionHandler = createProductionHandler();
    unpatch = vendetta.patcher.before("dispatch", FluxDispatcher(), (args: any[]) => {
        try {
            productionHandler?.(args[0]);
        } catch {
            try {
                vendetta.logger.error("GoofCrypt flux decrypt error");
            } catch {}
        }
    });
}

export function unpatchFlux(): void {
    fluxGeneration += 1;
    deriving.clear();
    decryptedIds.clear();
    activeDerivations = 0;
    peakDerivations = 0;
    productionHandler = null;
    if (!unpatch) return;
    try {
        unpatch();
    } catch {}
    unpatch = null;
}
