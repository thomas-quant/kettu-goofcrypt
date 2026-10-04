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
    observeRemoteMessage,
    queueRemoteDecrypt,
    rememberRemoteMessageCompleted,
    type RemoteMessageSnapshot,
} from "./remoteColdPath";
import { FluxDispatcher, showToast } from "./metro";

export interface FluxHandlerDependencies {
    mode(): KeySource | null;
    mark(): string;
    isCloaked(content: string): boolean;
    manualDecrypt(content: string, channelId: string): DecryptResult | null;
    startManual(message: any, channelId: string): void;
    parseRemote(content: string): ParsedCloakedPayload | null;
    remoteDecrypt(parsed: ParsedCloakedPayload, channelId: string): RemoteDecryptResult | null;
    queueRemote(snapshot: RemoteMessageSnapshot): void;
    observeMessage(messageId: string, content: string | undefined): void;
    hasCompleted(messageId: string, content: string): boolean;
    rememberCompleted(messageId: string, content: string): void;
}

let unpatch: (() => void) | null = null;
let productionHandler: ((payload: any) => void) | null = null;
let fluxGeneration = 0;
const deriving = new Map<string, { id: string; channel_id: string; content: string }>();
let activeDerivations = 0;
let peakDerivations = 0;

function observeMessage(messageId: string, content: string | undefined): void {
    const snapshot = deriving.get(messageId);
    if (snapshot && snapshot.content !== content) deriving.delete(messageId);
    observeRemoteMessage(messageId, content);
}

/** Derive missing manual keys, then re-dispatch the original manual message. */
function backgroundManualDecrypt(message: any, channelId: string): void {
    const id = String(message?.id ?? "");
    const passwords = getPasswordList();
    if (!id || passwords.length === 0 || deriving.has(id)) return;
    if (passwords.every((password) => getCachedKey(channelId, password))) return;
    const snapshot = { id, channel_id: channelId, content: message.content };
    deriving.set(id, snapshot);
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
            if (generation !== fluxGeneration || deriving.get(id) !== snapshot || keySource() !== "manual") return;
            const password = passwords[i];
            if (getCachedKey(channelId, password)) continue;
            try {
                await deriveKey(channelId, password);
            } catch (error) {
                noteError("deriveFails", error);
            }
        }
        if (generation !== fluxGeneration || deriving.get(id) !== snapshot || keySource() !== "manual") return;
        const result = decryptWithCachedKeys(snapshot.content, channelId, passwords);
        if (!result || generation !== fluxGeneration || deriving.get(id) !== snapshot) return;
        const content = settings().mark + result.text;
        rememberRemoteMessageCompleted(id, content);
        try {
            FluxDispatcher().dispatch({
                type: "MESSAGE_UPDATE",
                channelId,
                message: { ...snapshot, content },
            });
        } catch {
            try {
                vendetta.logger.error("GoofCrypt manual re-dispatch failed");
            } catch {}
        }
    })().catch((error) => noteError("deriveFails", error)).finally(() => {
        if (deriving.get(id) === snapshot) deriving.delete(id);
        if (debug && activeDerivations > 0) activeDerivations--;
    });
}

export function createFluxHandler(dependencies: FluxHandlerDependencies): (payload: any) => void {
    function handleMessage(message: any, channelId: string | undefined): void {
        if (!message || !channelId || typeof message.content !== "string") return;
        const id = String(message.id ?? "");
        if (id) dependencies.observeMessage(id, message.content);
        if (!message.content || (id && dependencies.hasCompleted(id, message.content))) return;
        const mark = dependencies.mark();

        const mode = dependencies.mode();
        if (mode === "manual") {
            if (!dependencies.isCloaked(message.content)) return;
            const result = dependencies.manualDecrypt(message.content, channelId);
            if (result) {
                message.content = mark + result.text;
                if (id) dependencies.rememberCompleted(id, message.content);
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
            if (id) dependencies.rememberCompleted(id, message.content);
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
            case "MESSAGE_DELETE": {
                const id = String(payload.id ?? payload.message?.id ?? "");
                if (id) dependencies.observeMessage(id, undefined);
                break;
            }
            case "MESSAGE_DELETE_BULK":
                if (Array.isArray(payload.ids)) {
                    for (let i = 0; i < payload.ids.length; i++) {
                        dependencies.observeMessage(String(payload.ids[i]), undefined);
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
        observeMessage,
        hasCompleted: isRemoteMessageCompleted,
        rememberCompleted: rememberRemoteMessageCompleted,
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
    activeDerivations = 0;
    peakDerivations = 0;
    productionHandler = null;
    if (!unpatch) return;
    try {
        unpatch();
    } catch {}
    unpatch = null;
}
