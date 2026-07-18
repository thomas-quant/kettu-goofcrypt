/**
 * Outgoing send/edit interception. The production boundary remains an instead
 * patch so cold remote sends can be rejected synchronously without calling orig.
 */
import { RemoteKdfError } from "../cloud/client";
import { getFreshRemoteSendKey } from "../cloud/remoteKdf";
import { encryptWithKey, MessageTooLongError } from "../core/encrypt";
import { getCachedKey, deriveKey } from "../core/keycache";
import { noteError } from "../core/health";
import { getRandomBytes } from "../crypto/random";
import { isCloaked } from "../stego/zwc";
import {
    chosenPassword,
    keySource,
    remoteSendSlot,
    settings,
    type KeySource,
} from "../settings";
import { queueRemoteSendPreparation } from "./remoteColdPath";
import { MessageActions, showToast } from "./metro";

export interface SendPatchDependencies {
    enabled(): boolean;
    mode(): KeySource | null;
    remoteSlot(): number | null;
    cover(): string;
    isCloaked(content: string): boolean;
    manualPassword(): string | undefined;
    manualKey(channelId: string, password: string): Uint8Array | null;
    warmManual(channelId: string, password: string): void;
    remoteKey(channelId: string, slot: number): Uint8Array | null;
    queueRemote(channelId: string, slot: number): void;
    encrypt(content: string, key: Uint8Array, cover: string): string;
    toast(text: string): void;
    noteAbort(error?: unknown): void;
}

export interface InsteadPatcher {
    instead(name: string, parent: any, callback: (this: any, args: any[], orig: Function) => unknown): () => void;
}

let disposers: Array<() => void> = [];

function rejectSend(dependencies: SendPatchDependencies, message: string, error: Error): Promise<never> {
    dependencies.noteAbort(error);
    dependencies.toast(message);
    return Promise.reject(error);
}

function remoteRejection(dependencies: SendPatchDependencies, message: string): Promise<never> {
    return rejectSend(dependencies, message, new RemoteKdfError("REMOTE_SEND_REJECTED"));
}

function createSendInterceptor(
    messageArgIndex: number,
    dependencies: SendPatchDependencies,
): (this: any, args: any[], orig: Function) => unknown {
    return function (this: any, args: any[], orig: Function): unknown {
        if (!dependencies.enabled()) return orig.apply(this, args);

        // Validate persisted branch state before any password/cache/remote call.
        const mode = dependencies.mode();
        const slot = dependencies.remoteSlot();
        if ((mode !== "manual" && mode !== "remote") || slot === null) {
            return remoteRejection(
                dependencies,
                "GoofCrypt: invalid message mode or remote slot — not sent (text kept)",
            );
        }

        const channelId = typeof args[0] === "string" ? args[0] : "";
        const message = args[messageArgIndex];
        if (!message?.content || dependencies.isCloaked(message.content)) return orig.apply(this, args);

        if (mode === "manual") {
            const password = dependencies.manualPassword();
            if (!password) {
                dependencies.toast("GoofCrypt: no password set — sent unencrypted");
                return orig.apply(this, args);
            }
            const key = dependencies.manualKey(channelId, password);
            if (!key) {
                dependencies.warmManual(channelId, password);
                return rejectSend(
                    dependencies,
                    "GoofCrypt: preparing manual key (~10s). Text kept — send again shortly.",
                    new Error("manual key preparing"),
                );
            }
            try {
                const encrypted = dependencies.encrypt(message.content, key, dependencies.cover());
                message.content = encrypted;
            } catch (error) {
                if (error instanceof MessageTooLongError) {
                    return rejectSend(
                        dependencies,
                        "GoofCrypt: message too long to encrypt — not sent (text kept)",
                        error,
                    );
                }
                return rejectSend(
                    dependencies,
                    "GoofCrypt: encryption failed — not sent (text kept)",
                    error instanceof Error ? error : new Error("encryption failed"),
                );
            }
            return orig.apply(this, args);
        }

        const key = dependencies.remoteKey(channelId, slot);
        if (key) {
            try {
                const encrypted = dependencies.encrypt(message.content, key, dependencies.cover());
                message.content = encrypted;
            } catch (error) {
                if (error instanceof MessageTooLongError) {
                    return rejectSend(
                        dependencies,
                        "GoofCrypt: message too long to encrypt — not sent (text kept)",
                        error,
                    );
                }
                return rejectSend(
                    dependencies,
                    "GoofCrypt: encryption failed — not sent (text kept)",
                    error instanceof Error ? error : new Error("encryption failed"),
                );
            }
            return orig.apply(this, args);
        }

        // Scalar-only fire-and-forget coordination owns/catches preparation.
        dependencies.queueRemote(channelId, slot);
        return remoteRejection(
            dependencies,
            "GoofCrypt: preparing remote key. Text kept — send again after the ready notice.",
        );
    };
}

/** Testable production registration seam; it deliberately exposes no before API. */
export function registerSendPatches(
    patcher: InsteadPatcher,
    messageActions: any,
    dependencies: SendPatchDependencies,
): Array<() => void> {
    const out: Array<() => void> = [];
    if (messageActions?.sendMessage) {
        out.push(patcher.instead("sendMessage", messageActions, createSendInterceptor(1, dependencies)));
    }
    if (messageActions?.editMessage) {
        out.push(patcher.instead("editMessage", messageActions, createSendInterceptor(2, dependencies)));
    }
    return out;
}

function rng(n: number): Uint8Array {
    return getRandomBytes(n, settings().allowInsecureRng);
}

function warmManual(channelId: string, password: string): void {
    const debug = settings().debugInstrument;
    const startedAt = debug ? Date.now() : 0;
    deriveKey(channelId, password)
        .then(() => {
            if (debug) {
                try {
                    vendetta.logger.log(`GoofCrypt[diag] cold-path first-key-ready: ${Date.now() - startedAt}ms`);
                } catch {}
            }
            showToast("GoofCrypt: manual key ready — send again");
        })
        .catch((error) => noteError("deriveFails", error));
}

function productionDependencies(): SendPatchDependencies {
    return {
        enabled: () => settings().enabled,
        mode: keySource,
        remoteSlot: remoteSendSlot,
        cover: () => settings().cover,
        isCloaked,
        manualPassword: chosenPassword,
        manualKey: getCachedKey,
        warmManual,
        remoteKey: getFreshRemoteSendKey,
        queueRemote: queueRemoteSendPreparation,
        encrypt: (content, key, cover) => encryptWithKey(content, key, cover, rng),
        toast: showToast,
        noteAbort: (error) => noteError("sendAborts", error),
    };
}

export function patchSend(): void {
    if (disposers.length > 0) return;
    const messageActions = MessageActions();
    if (!messageActions?.sendMessage) {
        showToast("GoofCrypt: sendMessage module not found — sending disabled");
        return;
    }
    const registered = registerSendPatches(vendetta.patcher, messageActions, productionDependencies());
    for (let i = 0; i < registered.length; i++) disposers.push(registered[i]);
}

export function unpatchSend(): void {
    for (let i = 0; i < disposers.length; i++) {
        try {
            disposers[i]?.();
        } catch {}
    }
    disposers = [];
}
