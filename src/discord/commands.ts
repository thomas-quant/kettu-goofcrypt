/**
 * `/encrypt` slash command: toggle sending, cycle password, show status, or
 * benchmark Argon2. Feedback via toast. Key warming is fire-and-forget async
 * (never blocks the UI).
 */
import { settings, chosenPassword, cyclePassword, maskPassword, getPasswordList } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { deriveKey, isCached, importKeys } from "../core/keycache";
import { benchOnce } from "../crypto/argon";
import { healthSummary } from "../core/health";
import { fromBase64 } from "../util/base64";
import { utf8Decode } from "../crypto/deflate";
import { showToast } from "./metro";

const STRING = 3; // ApplicationCommandOptionType.STRING

let dispose: (() => void) | null = null;

function canEnable(): boolean {
    return secureRngAvailable() || settings().allowInsecureRng;
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
        description: "GoofCrypt: on | off | toggle | cycle | status | bench",
        displayDescription: "GoofCrypt: on | off | toggle | cycle | status | bench",
        options: [
            {
                name: "action",
                displayName: "action",
                description: "on | off | toggle | cycle | status | bench",
                displayDescription: "on | off | toggle | cycle | status | bench",
                type: STRING,
                required: false,
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
                return void showToast(`GoofCrypt: saved ${getPasswordList().length} password(s)`);
            }

            // Import a desktop-derived key bundle (base64 of { v, keys }).
            const importArg = args.find((a) => a.name === "import")?.value;
            if (importArg !== undefined) {
                try {
                    const obj = JSON.parse(utf8Decode(fromBase64(importArg.trim())));
                    const n = importKeys(obj?.keys ?? obj);
                    return void showToast(`GoofCrypt: imported ${n} key(s) — no Argon2 needed for those chats`);
                } catch (e) {
                    return void showToast("GoofCrypt: invalid key bundle");
                }
            }

            const action = (args.find((a) => a.name === "action")?.value ?? "toggle").toLowerCase();

            switch (action) {
                case "bench":
                    showToast("GoofCrypt: timing Argon2 (this is the per-chat cost)…");
                    benchOnce()
                        .then((ms) => showToast(`GoofCrypt: Argon2 took ${ms} ms`))
                        .catch((e) => showToast("GoofCrypt bench error: " + (e?.message ?? e)));
                    break;
                case "on":
                case "enable":
                    if (getPasswordList().length === 0) return void showToast("GoofCrypt: set a password in plugin settings first");
                    if (!canEnable()) return void showToast("GoofCrypt: no secure RNG — cannot enable");
                    settings().enabled = true;
                    warm(channelId);
                    showToast(`GoofCrypt ON — password ${maskPassword(chosenPassword())}`);
                    break;
                case "off":
                case "disable":
                    settings().enabled = false;
                    showToast("GoofCrypt OFF");
                    break;
                case "cycle": {
                    const next = cyclePassword();
                    if (!next) return void showToast("GoofCrypt: no passwords configured");
                    warm(channelId);
                    showToast(`GoofCrypt password → ${maskPassword(next)}`);
                    break;
                }
                case "status":
                    showToast(
                        `GoofCrypt: ${settings().enabled ? "ON" : "OFF"} · ${getPasswordList().length} pw ` +
                            `(raw ${settings().passwords.length} chars) · pw ${maskPassword(chosenPassword())} · ` +
                            `RNG ${secureRngAvailable() ? rngSource() : "none"}` +
                            healthSummary(),
                    );
                    break;
                default: // toggle
                    if (!settings().enabled && !canEnable()) return void showToast("GoofCrypt: no secure RNG — cannot enable");
                    if (!settings().enabled && getPasswordList().length === 0) return void showToast("GoofCrypt: set a password first");
                    settings().enabled = !settings().enabled;
                    if (settings().enabled) warm(channelId);
                    showToast(`GoofCrypt ${settings().enabled ? "ON" : "OFF"}`);
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
