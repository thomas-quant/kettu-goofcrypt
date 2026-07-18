/**
 * `/encrypt` slash command: toggle sending, cycle password, show status, or
 * benchmark Argon2. Feedback via toast. Key warming is fire-and-forget async
 * (never blocks the UI).
 */
import {
    settings,
    chosenPassword,
    cyclePassword,
    maskPassword,
    getPasswordList,
    keySource,
    remoteSendSlot,
    setRemoteSendSlot,
} from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { deriveKey, isCached, importKeys } from "../core/keycache";
import { benchOnceDetailed } from "../crypto/argon";
import { runProbe, testCandidate, probeSummary, probeDigest, candidateAdapters } from "./nativeProbe";
import { healthSummary } from "../core/health";
import { fromBase64 } from "../util/base64";
import { utf8Decode } from "../crypto/deflate";
import { showToast, MessageActions } from "./metro";
import {
    clearRemoteCache,
    formatRemoteKdfStatus,
    refreshRemoteChannel,
    refreshRemoteRevision,
    remoteErrorMessage,
} from "../cloud/remoteKdf";
import { getRemoteSendKeys } from "../core/remoteKeycache";
import {
    changeKeySource,
    remoteColdPathStatus,
    resetRemoteColdPath,
} from "./remoteColdPath";

const STRING = 3; // ApplicationCommandOptionType.STRING

let dispose: (() => void) | null = null;

function canEnable(): boolean {
    return secureRngAvailable() || settings().allowInsecureRng;
}

/**
 * Post a COPYABLE, persistent Clyde (bot) message in the current channel — only
 * the user sees it, and unlike a toast it can be read at leisure and copy-pasted
 * (essential for the spike: the user pastes probe/status output back). Falls back
 * to a toast if sendBotMessage is unavailable on this client build.
 */
function reply(channelId: string | undefined, text: string): void {
    try {
        const ma = MessageActions();
        if (channelId && ma?.sendBotMessage) {
            ma.sendBotMessage(channelId, text);
            return;
        }
    } catch {
        /* fall through to toast */
    }
    showToast(text);
}

/** Pre-derive this channel's key in the background so the first message isn't slow. */
function warm(channelId: string | undefined): void {
    const pw = chosenPassword();
    if (!pw || !channelId || isCached(channelId, pw)) return;
    deriveKey(channelId, pw).catch(() => {});
}

export function registerCommands(): void {
    if (dispose) return;
    dispose = vendetta.commands.registerCommand({
        name: "encrypt",
        displayName: "encrypt",
        description: "GoofCrypt: manual controls, diagnostics, and remote setup status/refresh",
        displayDescription: "GoofCrypt: manual controls, diagnostics, and remote setup status/refresh",
        options: [
            {
                name: "action",
                displayName: "action",
                description: "Pick one (defaults to toggle)",
                displayDescription: "Pick one (defaults to toggle)",
                type: STRING,
                required: false,
                // A choices pick-list so the user taps an action instead of typing
                // free text into a bare string field. `probe`/`test` fold the old
                // separate `diag` arg into this single option.
                choices: [
                    { name: "status", displayName: "status", value: "status" },
                    { name: "toggle (on/off)", displayName: "toggle (on/off)", value: "toggle" },
                    { name: "on", displayName: "on", value: "on" },
                    { name: "off", displayName: "off", value: "off" },
                    { name: "mode: manual", displayName: "mode: manual", value: "mode-manual" },
                    { name: "mode: remote", displayName: "mode: remote", value: "mode-remote" },
                    { name: "remote: next send slot", displayName: "remote: next send slot", value: "remote-slot-next" },
                    { name: "cycle password", displayName: "cycle password", value: "cycle" },
                    { name: "bench (time Argon2)", displayName: "bench (time Argon2)", value: "bench" },
                    { name: "diag: probe (enumerate)", displayName: "diag: probe (enumerate)", value: "probe" },
                    { name: "diag: test candidates", displayName: "diag: test candidates", value: "test" },
                    { name: "remote: status", displayName: "remote: status", value: "remote-status" },
                    { name: "remote: refresh channel", displayName: "remote: refresh channel", value: "remote-refresh" },
                    { name: "remote: check revision", displayName: "remote: check revision", value: "remote-check" },
                    { name: "remote: clear cache", displayName: "remote: clear cache", value: "remote-clear" },
                ],
            },
            {
                name: "set",
                displayName: "set",
                description: "Set password(s) directly (comma-separated). Same as the settings field.",
                displayDescription: "Set password(s) directly (comma-separated). Same as the settings field.",
                type: STRING,
                required: false,
            },
            {
                name: "import",
                displayName: "import",
                description: "Import a key bundle from the desktop derive-keys tool (avoids on-device Argon2).",
                displayDescription: "Import a key bundle from the desktop derive-keys tool (avoids on-device Argon2).",
                type: STRING,
                required: false,
            },
        ],
        applicationId: "-1",
        inputType: 1,
        type: 1,
        execute(args: Array<{ name: string; value: string }>, ctx: any) {
            const channelId: string | undefined = ctx?.channel?.id;

            // Set password(s) directly from the command (writes the same store
            // the runtime reads — bypasses the settings UI entirely).
            const setArg = args.find((a) => a.name === "set")?.value;
            if (setArg !== undefined) {
                settings().passwords = setArg;
                return void reply(channelId, `GoofCrypt: saved ${getPasswordList().length} password(s)`);
            }

            // Import a desktop-derived key bundle (base64 of { v, keys }).
            const importArg = args.find((a) => a.name === "import")?.value;
            if (importArg !== undefined) {
                try {
                    const obj = JSON.parse(utf8Decode(fromBase64(importArg.trim())));
                    const n = importKeys(obj?.keys ?? obj);
                    return void reply(channelId, `GoofCrypt: imported ${n} key(s) — no Argon2 needed for those chats`);
                } catch (e) {
                    return void reply(channelId, "GoofCrypt: invalid key bundle");
                }
            }

            const action = (args.find((a) => a.name === "action")?.value ?? "toggle").toLowerCase();

            // Native-crypto diagnostics (SPIKE-01/02). `probe` = enumeration only;
            // `test` = run native candidates (manual only). Output goes to a COPYABLE
            // bot message so the user can paste it back for the spike verdict.
            if (action === "probe" || action === "test") {
                if (action === "test") {
                    // The ONLY caller of testCandidate (D-05). Enumerate-or-reuse
                    // the persisted report, then run each reachable candidate
                    // under the armed-flag protection. Fire-and-forget so the UI
                    // never blocks; reply per-candidate results.
                    reply(channelId, "GoofCrypt: testing native candidates (manual probe)…");
                    const report = settings().nativeProbe ?? runProbe();
                    const adapters = candidateAdapters(report);
                    if (adapters.length === 0) {
                        return void reply(channelId, "GoofCrypt: none reachable — no native Argon2 candidate to test");
                    }
                    // Sequential per-candidate test via a fire-and-forget .then
                    // chain (NOT a for+await async IIFE — that lowers to a
                    // regenerator generator under swc es5, which Hermes eval
                    // rejects). Each step replies its result, then schedules next.
                    const runNext = (i: number): void => {
                        if (i >= adapters.length) return;
                        testCandidate(adapters[i].name, adapters[i].fn)
                            .then((r) =>
                                reply(
                                    channelId,
                                    `GoofCrypt ${r.name}: reach ${r.reachable} salt ${r.saltAccepted} ` +
                                        `out ${r.outputKind} match ${r.byteMatch} crash ${r.crashed}` +
                                        (r.timingMs != null ? ` ${r.timingMs}ms` : "") +
                                        (r.error ? ` err ${r.error}` : ""),
                                ),
                            )
                            .catch((e) => reply(channelId, `GoofCrypt ${adapters[i].name}: test error ${e?.message ?? e}`))
                            .then(() => runNext(i + 1));
                    };
                    runNext(0);
                    return;
                }
                // probe: enumeration ONLY — MUST NOT invoke native crypto. Posts the
                // FULL copyable enumeration digest (SPIKE-01 evidence), not just the
                // one-line summary.
                runProbe();
                return void reply(channelId, "**GoofCrypt probe**\n" + probeDigest());
            }

            switch (action) {
                case "remote-status":
                    reply(
                        channelId,
                        `**GoofCrypt remote KDF**\nmode ${keySource() ?? "invalid"} · send-slot ${remoteSendSlot() ?? "invalid"}\n${formatRemoteKdfStatus()}`,
                    );
                    break;
                case "remote-refresh":
                    if (!channelId) return void reply(channelId, "GoofCrypt: no current channel to refresh");
                    refreshRemoteChannel(channelId)
                        .then(() => reply(channelId, "GoofCrypt: current channel verified and remote keys refreshed"))
                        .catch((error) => reply(channelId, `GoofCrypt: ${remoteErrorMessage(error)}`));
                    break;
                case "remote-check":
                    refreshRemoteRevision(true)
                        .then(() => reply(channelId, "GoofCrypt: remote revision checked"))
                        .catch((error) => reply(channelId, `GoofCrypt: ${remoteErrorMessage(error)}`));
                    break;
                case "remote-clear":
                    resetRemoteColdPath();
                    clearRemoteCache();
                    reply(channelId, "GoofCrypt: remote cache cleared; manual passwords, keys, and remote credentials kept");
                    break;
                case "mode-manual":
                case "mode-remote": {
                    const nextMode = action === "mode-manual" ? "manual" : "remote";
                    try {
                        if (!changeKeySource(nextMode)) return void reply(channelId, "GoofCrypt: invalid message mode");
                        reply(channelId, `GoofCrypt message mode → ${nextMode} (no fallback between sources)`);
                    } catch {
                        reply(channelId, "GoofCrypt: could not change message mode safely");
                    }
                    break;
                }
                case "remote-slot-next": {
                    if (keySource() !== "remote") return void reply(channelId, "GoofCrypt: select remote message mode first");
                    if (!channelId) return void reply(channelId, "GoofCrypt: no current channel for remote slots");
                    const current = remoteSendSlot();
                    if (current === null) return void reply(channelId, "GoofCrypt: remote send slot is invalid; repair it in settings");
                    const keys = getRemoteSendKeys(channelId);
                    if (!keys?.length) return void reply(channelId, "GoofCrypt: no current remote slots cached for this channel");
                    const next = (current + 1) % keys.length;
                    if (!setRemoteSendSlot(next)) return void reply(channelId, "GoofCrypt: remote send slot update rejected");
                    reply(channelId, `GoofCrypt remote send slot → ${next} of ${keys.length}`);
                    break;
                }
                case "bench":
                    reply(channelId, "GoofCrypt: timing Argon2 (this is the per-chat cost)…");
                    // Locked benchOnceDetailed contract (Plan 01-02 Task 2):
                    // { totalMs, firstYieldMs, longestBlockMs, yieldCount, ok, form }.
                    // yieldCount 0 across a multi-second derive ⇒ thread-starved.
                    benchOnceDetailed()
                        .then((r) =>
                            reply(
                                channelId,
                                `GoofCrypt Argon2: ${r.totalMs}ms total · first-tick ${r.firstYieldMs}ms · ` +
                                    `longest-block ${r.longestBlockMs}ms · ticks ${r.yieldCount}` +
                                    (r.yieldCount === 0 ? " (THREAD-STARVED)" : "") +
                                    ` · macrotask ${r.ok ? "ok" : "REGRESSED"}`,
                            ),
                        )
                        .catch((e) => reply(channelId, "GoofCrypt bench error: " + (e?.message ?? e)));
                    break;
                case "on":
                case "enable":
                    if (keySource() === null) return void reply(channelId, "GoofCrypt: repair the invalid message mode first");
                    if (remoteSendSlot() === null) return void reply(channelId, "GoofCrypt: repair the invalid remote send slot first");
                    if (keySource() === "manual" && getPasswordList().length === 0) {
                        return void reply(channelId, "GoofCrypt: set a password in plugin settings first");
                    }
                    if (!canEnable()) return void reply(channelId, "GoofCrypt: no secure RNG — cannot enable");
                    settings().enabled = true;
                    if (keySource() === "manual") warm(channelId);
                    reply(
                        channelId,
                        keySource() === "manual"
                            ? `GoofCrypt ON — manual password ${maskPassword(chosenPassword())}`
                            : `GoofCrypt ON — remote slot ${remoteSendSlot()} (cold sends are rejected until ready)`,
                    );
                    break;
                case "off":
                case "disable":
                    settings().enabled = false;
                    reply(channelId, "GoofCrypt OFF");
                    break;
                case "cycle": {
                    if (keySource() !== "manual") return void reply(channelId, "GoofCrypt: switch to manual mode to cycle passwords");
                    const next = cyclePassword();
                    if (!next) return void reply(channelId, "GoofCrypt: no passwords configured");
                    warm(channelId);
                    reply(channelId, `GoofCrypt password → ${maskPassword(next)}`);
                    break;
                }
                case "status":
                    const cold = remoteColdPathStatus();
                    reply(
                        channelId,
                        `**GoofCrypt status**\n` +
                            `• state: ${settings().enabled ? "ON" : "OFF"}\n` +
                            `• mode: ${keySource() ?? "INVALID"}\n` +
                            `• remote send slot: ${remoteSendSlot() ?? "INVALID"}\n` +
                            `• passwords: ${getPasswordList().length} (raw ${settings().passwords.length} chars)\n` +
                            `• chosen: ${maskPassword(chosenPassword())}\n` +
                            `• RNG: ${secureRngAvailable() ? rngSource() : "none"}\n` +
                            `• health:${healthSummary() || " ok"}\n` +
                            `• remote cold: ${cold.incomingOperations} receive/${cold.sendPreparations} send · waiting ${cold.waitingMessages}\n` +
                            `• remote: ${formatRemoteKdfStatus()}\n` +
                            `• ${probeSummary().replace(/^ · /, "")}`,
                    );
                    break;
                default: // toggle
                    if (!settings().enabled && !canEnable()) return void reply(channelId, "GoofCrypt: no secure RNG — cannot enable");
                    if (!settings().enabled && keySource() === null) return void reply(channelId, "GoofCrypt: repair the invalid message mode first");
                    if (!settings().enabled && remoteSendSlot() === null) return void reply(channelId, "GoofCrypt: repair the invalid remote send slot first");
                    if (!settings().enabled && keySource() === "manual" && getPasswordList().length === 0) {
                        return void reply(channelId, "GoofCrypt: set a password first");
                    }
                    settings().enabled = !settings().enabled;
                    if (settings().enabled && keySource() === "manual") warm(channelId);
                    reply(channelId, `GoofCrypt ${settings().enabled ? "ON" : "OFF"} · mode ${keySource()}`);
                    break;
            }
        },
    });
}

export function unregisterCommands(): void {
    if (dispose) {
        try {
            dispose();
        } catch {
            /* ignore */
        }
        dispose = null;
    }
}
