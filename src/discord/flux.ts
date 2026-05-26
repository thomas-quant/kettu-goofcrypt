/**
 * Incoming-message decryption by patching FluxDispatcher.dispatch.
 *
 * The dispatch hook is synchronous, so it only decrypts with ALREADY-cached
 * keys (instant). On a cache miss it derives the key asynchronously in the
 * background, then re-dispatches the message with decrypted content — so the UI
 * never freezes on the expensive Argon2 step.
 */
import { decryptWithCachedKeys } from "../core/decrypt";
import { getCachedKey, deriveKey } from "../core/keycache";
import { getPasswordList, settings } from "../settings";
import { noteError } from "../core/health";
import { isCloaked } from "../stego/zwc";
import { FluxDispatcher, showToast } from "./metro";

let unpatch: (() => void) | null = null;
const deriving = new Set<string>(); // messageId guard against duplicate background work
const decryptedIds = new Set<string>(); // mark-independent re-entrancy guard

function isMarked(content: string): boolean {
    const mark = settings().mark;
    return !!mark && content.startsWith(mark);
}

function decryptInPlace(message: any, channelId: string | undefined): void {
    if (!message?.content || !channelId) return;
    const id = String(message.id ?? "");
    if (id && decryptedIds.has(id)) return; // already handled (robust even if mark is empty)
    if (isMarked(message.content) || !isCloaked(message.content)) return;
    const res = decryptWithCachedKeys(message.content, channelId, getPasswordList());
    if (res) {
        message.content = settings().mark + res.text;
        if (id) decryptedIds.add(id);
    } else {
        backgroundDecrypt(message, channelId);
    }
}

/** Derive any missing keys async, then re-dispatch the decrypted message. */
function backgroundDecrypt(message: any, channelId: string): void {
    const id = String(message?.id ?? "");
    const passwords = getPasswordList();
    if (!id || passwords.length === 0 || deriving.has(id)) return;
    // Only bother if at least one password's key isn't cached yet.
    if (passwords.every((p) => getCachedKey(channelId, p))) return;
    deriving.add(id);
    showToast("GoofCrypt: deriving key to decrypt (one-time for this chat)…");

    (async () => {
        for (const pw of passwords) {
            if (getCachedKey(channelId, pw)) continue;
            try {
                await deriveKey(channelId, pw);
            } catch (e) {
                noteError("deriveFails", e);
            }
        }
        const res = decryptWithCachedKeys(message.content, channelId, passwords);
        if (res) {
            if (id) decryptedIds.add(id);
            try {
                FluxDispatcher().dispatch({
                    type: "MESSAGE_UPDATE",
                    channelId, // include so the handler can resolve the channel
                    message: { ...message, content: settings().mark + res.text },
                });
            } catch (e) {
                vendetta.logger.error("GoofCrypt re-dispatch failed", e);
            }
        }
    })().finally(() => deriving.delete(id));
}

function handle(payload: any): void {
    switch (payload?.type) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            decryptInPlace(payload.message, payload.channelId ?? payload.message?.channel_id);
            break;
        case "LOAD_MESSAGES_SUCCESS":
            if (Array.isArray(payload.messages)) {
                for (const m of payload.messages) decryptInPlace(m, m?.channel_id ?? payload.channelId);
            }
            break;
        case "MESSAGE_START_EDIT": {
            const mark = settings().mark;
            if (mark && typeof payload.content === "string" && payload.content.startsWith(mark)) {
                payload.content = payload.content.slice(mark.length);
            }
            break;
        }
    }
}

export function patchFlux(): void {
    if (unpatch) return;
    unpatch = vendetta.patcher.before("dispatch", FluxDispatcher(), (args: any[]) => {
        try {
            handle(args[0]);
        } catch (e) {
            vendetta.logger.error("GoofCrypt flux decrypt error", e);
        }
    });
}

export function unpatchFlux(): void {
    if (unpatch) {
        try {
            unpatch();
        } catch {
            /* ignore */
        }
        unpatch = null;
    }
}
