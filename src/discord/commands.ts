/**
 * `/encrypt` slash command: toggle sending, cycle password, show status, or
 * benchmark Argon2. Feedback via toast. Key warming is fire-and-forget async
 * (never blocks the UI).
 */
import { settings, chosenPassword, cyclePassword, maskPassword, getPasswordList } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { deriveKey, isCached, importKeys } from "../core/keycache";
import { benchOnceDetailed } from "../crypto/argon";
import { runProbe, testCandidate, probeSummary, candidateAdapters } from "./nativeProbe";
import { healthSummary } from "../core/health";
import { fromBase64 } from "../util/base64";
import { utf8Decode } from "../crypto/deflate";
import { showToast, MessageActions } from "./metro";

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
        description: "GoofCrypt: on | off | toggle | cycle | status | bench | diag",
        displayDescription: "GoofCrypt: on | off | toggle | cycle | status | bench | diag",
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
                    { name: "cycle password", displayName: "cycle password", value: "cycle" },
                    { name: "bench (time Argon2)", displayName: "bench (time Argon2)", value: "bench" },
                    { name: "diag: probe (enumerate)", displayName: "diag: probe (enumerate)", value: "probe" },
                    { name: "diag: test candidates", displayName: "diag: test candidates", value: "test" },
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
                // probe: enumeration ONLY — MUST NOT invoke native crypto.
                runProbe();
                return void reply(channelId, "**GoofCrypt diag**" + probeSummary());
            }

            switch (action) {
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
                    if (getPasswordList().length === 0) return void reply(channelId, "GoofCrypt: set a password in plugin settings first");
                    if (!canEnable()) return void reply(channelId, "GoofCrypt: no secure RNG — cannot enable");
                    settings().enabled = true;
                    warm(channelId);
                    reply(channelId, `GoofCrypt ON — password ${maskPassword(chosenPassword())}`);
                    break;
                case "off":
                case "disable":
                    settings().enabled = false;
                    reply(channelId, "GoofCrypt OFF");
                    break;
                case "cycle": {
                    const next = cyclePassword();
                    if (!next) return void reply(channelId, "GoofCrypt: no passwords configured");
                    warm(channelId);
                    reply(channelId, `GoofCrypt password → ${maskPassword(next)}`);
                    break;
                }
                case "status":
                    reply(
                        channelId,
                        `**GoofCrypt status**\n` +
                            `• state: ${settings().enabled ? "ON" : "OFF"}\n` +
                            `• passwords: ${getPasswordList().length} (raw ${settings().passwords.length} chars)\n` +
                            `• chosen: ${maskPassword(chosenPassword())}\n` +
                            `• RNG: ${secureRngAvailable() ? rngSource() : "none"}\n` +
                            `• health:${healthSummary() || " ok"}\n` +
                            `• ${probeSummary().replace(/^ · /, "")}`,
                    );
                    break;
                default: // toggle
                    if (!settings().enabled && !canEnable()) return void reply(channelId, "GoofCrypt: no secure RNG — cannot enable");
                    if (!settings().enabled && getPasswordList().length === 0) return void reply(channelId, "GoofCrypt: set a password first");
                    settings().enabled = !settings().enabled;
                    if (settings().enabled) warm(channelId);
                    reply(channelId, `GoofCrypt ${settings().enabled ? "ON" : "OFF"}`);
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
