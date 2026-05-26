/**
 * Outgoing-message patches. When sending is enabled, rewrite message.content to
 * its encrypted form before it is sent. Key derivation is async (never freezes):
 * if the channel's key is already cached we encrypt synchronously, otherwise we
 * return a promise that derives the key first (UI stays responsive).
 */
import { encryptWithKey, MessageTooLongError } from "../core/encrypt";
import { getCachedKey, deriveKey } from "../core/keycache";
import { getRandomBytes } from "../crypto/random";
import { isCloaked } from "../stego/zwc";
import { settings, chosenPassword } from "../settings";
import { MessageActions, showToast } from "./metro";

let disposers: Array<() => void> = [];

function rng(n: number) {
    return getRandomBytes(n, settings().allowInsecureRng);
}

function abort(e: unknown): Promise<undefined> {
    if (e instanceof MessageTooLongError) showToast("GoofCrypt: message too long to encrypt — not sent");
    else {
        vendetta.logger.error("GoofCrypt encrypt failed", e);
        showToast("GoofCrypt: encryption failed — not sent");
    }
    return Promise.resolve(undefined);
}

function patchOne(name: "sendMessage" | "editMessage", messageArgIndex: number): void {
    const MA = MessageActions();
    disposers.push(
        vendetta.patcher.instead(name, MA, function (this: any, args: any[], orig: Function) {
            if (!settings().enabled) return orig.apply(this, args);

            const channelId: string = args[0];
            const message: any = args[messageArgIndex];
            if (!message?.content || isCloaked(message.content)) return orig.apply(this, args);

            const pw = chosenPassword();
            if (!pw) {
                showToast("GoofCrypt: no password set — sent unencrypted");
                return orig.apply(this, args);
            }

            const cached = getCachedKey(channelId, pw);
            if (cached) {
                try {
                    message.content = encryptWithKey(message.content, cached, settings().cover, rng);
                } catch (e) {
                    return abort(e);
                }
                return orig.apply(this, args);
            }

            // Cold: derive key async, then send. UI stays responsive (argon2idAsync yields).
            const self = this;
            return (async () => {
                showToast("GoofCrypt: deriving key (first message in this chat)…");
                let key: Uint8Array;
                try {
                    key = await deriveKey(channelId, pw);
                } catch (e) {
                    vendetta.logger.error("GoofCrypt key derive failed", e);
                    showToast("GoofCrypt: key derivation failed — not sent");
                    return undefined;
                }
                try {
                    message.content = encryptWithKey(message.content, key, settings().cover, rng);
                } catch (e) {
                    return abort(e).then(() => undefined);
                }
                return orig.apply(self, args);
            })();
        }),
    );
}

export function patchSend(): void {
    const MA = MessageActions();
    if (!MA?.sendMessage) {
        showToast("GoofCrypt: sendMessage module not found — sending disabled");
        return;
    }
    patchOne("sendMessage", 1); // sendMessage(channelId, message, ...)
    if (MA.editMessage) patchOne("editMessage", 2); // editMessage(channelId, messageId, message)
}

export function unpatchSend(): void {
    for (const d of disposers) {
        try {
            d?.();
        } catch {
            /* ignore */
        }
    }
    disposers = [];
}
