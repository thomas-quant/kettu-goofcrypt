/**
 * Incoming-message decryption by patching FluxDispatcher.dispatch (Vendetta
 * patcher `before`), so message content is decrypted in place before stores
 * process it. Mirrors GoofCord's dispatch hook. Always active regardless of the
 * send toggle.
 */
import { decryptMessage } from "../core/decrypt";
import { getPasswordList, settings } from "../settings";
import { FluxDispatcher } from "./metro";

let unpatch: (() => void) | null = null;

function decryptOne(message: any, channelId: string | undefined): void {
    if (!message?.content || !channelId) return;
    const mark = settings().mark;
    if (mark && message.content.startsWith(mark)) return; // already decrypted
    const res = decryptMessage(message.content, channelId, getPasswordList());
    if (res) message.content = mark + res.text;
}

function handle(payload: any): void {
    switch (payload?.type) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            decryptOne(payload.message, payload.channelId ?? payload.message?.channel_id);
            break;
        case "LOAD_MESSAGES_SUCCESS":
            if (Array.isArray(payload.messages)) {
                for (const m of payload.messages) decryptOne(m, m?.channel_id ?? payload.channelId);
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
        // no return -> args unchanged (we mutated payload in place)
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
