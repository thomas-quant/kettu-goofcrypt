/**
 * Outgoing-message patches. When sending is enabled, rewrite message.content to
 * its encrypted (cover + hidden) form before it leaves the device.
 *
 * Invariant established at start()/command time: `enabled` is only ever true
 * when a usable RNG exists (secure, or the user explicitly opted into insecure).
 * So this code never has to silently fall back to plaintext for RNG reasons.
 */
import { encryptMessage, MessageTooLongError } from "../core/encrypt";
import { getRandomBytes } from "../crypto/random";
import { isCloaked } from "../stego/zwc";
import { settings, chosenPassword } from "../settings";
import { MessageActions, showToast } from "./metro";

let disposers: Array<() => void> = [];

function encryptInto(message: any, channelId: string): "ok" | "plaintext" | "abort" {
    if (!message?.content || isCloaked(message.content)) return "ok";
    const pw = chosenPassword();
    if (!pw) {
        showToast("GoofCrypt: no password set — sent unencrypted");
        return "plaintext";
    }
    try {
        message.content = encryptMessage(
            message.content,
            channelId,
            pw,
            settings().cover,
            (n) => getRandomBytes(n, settings().allowInsecureRng),
        );
        return "ok";
    } catch (e) {
        if (e instanceof MessageTooLongError) {
            showToast("GoofCrypt: message too long to encrypt — not sent");
            return "abort";
        }
        bunny.plugin.logger.error("GoofCrypt encrypt failed", e);
        showToast("GoofCrypt: encryption failed — not sent");
        return "abort";
    }
}

export function patchSend(): void {
    const MA = MessageActions();

    // sendMessage(channelId, message, replyRef, options) — use `instead` so we
    // can abort the send on a hard failure (over-length / error).
    disposers.push(
        bunny.api.patcher.instead("sendMessage", MA, function (this: any, args: any[], orig: Function) {
            if (settings().enabled) {
                const result = encryptInto(args[1], args[0]);
                if (result === "abort") return Promise.resolve(undefined);
            }
            return orig.apply(this, args);
        }),
    );

    // editMessage(channelId, messageId, message) — best-effort; leave unmodified on failure.
    if (MA?.editMessage) {
        disposers.push(
            bunny.api.patcher.instead("editMessage", MA, function (this: any, args: any[], orig: Function) {
                if (settings().enabled) {
                    const result = encryptInto(args[2], args[0]);
                    if (result === "abort") return Promise.resolve(undefined);
                }
                return orig.apply(this, args);
            }),
        );
    }
}

export function unpatchSend(): void {
    for (const d of disposers) {
        try {
            d();
        } catch {
            /* ignore */
        }
    }
    disposers = [];
}
