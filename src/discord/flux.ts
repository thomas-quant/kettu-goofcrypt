/**
 * Incoming-message decryption via Flux interception. Mutates message content in
 * place (return nothing = passthrough). Decryption is always active regardless
 * of the send toggle.
 */
import { decryptMessage } from "../core/decrypt";
import { getPasswordList, settings } from "../settings";

let dispose: (() => void) | null = null;

function decryptOne(message: any, channelId: string | undefined): void {
    if (!message?.content || !channelId) return;
    const mark = settings().mark;
    if (mark && message.content.startsWith(mark)) return; // already decrypted
    const res = decryptMessage(message.content, channelId, getPasswordList());
    if (res) message.content = mark + res.text;
}

export function patchFlux(): void {
    if (dispose) return;
    dispose = bunny.api.flux.intercept((payload) => {
        try {
            switch (payload.type) {
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
        } catch (e) {
            bunny.plugin.logger.error("GoofCrypt flux decrypt error", e);
        }
        // return nothing -> passthrough with our in-place mutations applied
    });
}

export function unpatchFlux(): void {
    if (dispose) {
        try {
            dispose();
        } catch {
            /* ignore */
        }
        dispose = null;
    }
}
