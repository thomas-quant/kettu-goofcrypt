/**
 * Outgoing-message patches. When sending is enabled, rewrite message.content to
 * its encrypted form before it is sent.
 *
 * Key handling is async and never blocks: if the channel's key is already
 * cached (derived or imported) we encrypt synchronously and send. On a cold
 * cache we do NOT make the user wait ~10s inside the send — instead we warm the
 * key in the background and REJECT the send (which keeps the typed text in the
 * composer), with a toast telling the user to resend once it's ready.
 */
import { encryptWithKey, MessageTooLongError } from "../core/encrypt";
import { getCachedKey, deriveKey } from "../core/keycache";
import { noteError } from "../core/health";
import { getRandomBytes } from "../crypto/random";
import { isCloaked } from "../stego/zwc";
import { settings, chosenPassword } from "../settings";
import { MessageActions, showToast } from "./metro";

let disposers: Array<() => void> = [];

function rng(n: number) {
    return getRandomBytes(n, settings().allowInsecureRng);
}

function fail(msg: string, e?: unknown): Promise<never> {
    noteError("sendAborts", e);
    showToast(msg);
    return Promise.reject(e instanceof Error ? e : new Error(msg));
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

            const key = getCachedKey(channelId, pw);
            if (key) {
                try {
                    message.content = encryptWithKey(message.content, key, settings().cover, rng);
                } catch (e) {
                    if (e instanceof MessageTooLongError) return fail("GoofCrypt: message too long to encrypt — not sent (text kept)");
                    return fail("GoofCrypt: encryption failed — not sent (text kept)", e);
                }
                return orig.apply(this, args);
            }

            // Cold cache: warm in the background, keep the text, ask to resend.
            // Debug-gated (settings().debugInstrument) cold-path observation: measure
            // first-key-ready latency — the user's reported "still freezes" send path.
            // Observe only; the reject-and-resend behavior is unchanged. The discord
            // layer MAY import settings (the up-graph rule only forbids crypto/core).
            const debug = settings().debugInstrument;
            const t0 = debug ? Date.now() : 0;
            deriveKey(channelId, pw)
                .then(() => {
                    if (debug) {
                        try {
                            vendetta.logger.log(`GoofCrypt[diag] cold-path first-key-ready: ${Date.now() - t0}ms`);
                        } catch {
                            /* logging must never break the send patch */
                        }
                    }
                    showToast("GoofCrypt: key ready — send again");
                })
                .catch((e) => noteError("deriveFails", e));
            return fail("GoofCrypt: preparing key (~10s). Text kept — send again shortly.");
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
