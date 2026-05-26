/**
 * `/encrypt` slash command: toggle sending, cycle password, show status, or
 * benchmark Argon2. Feedback via toast. Key warming is fire-and-forget async
 * (never blocks the UI).
 */
import { settings, chosenPassword, cyclePassword, maskPassword, getPasswordList } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { deriveKey, isCached } from "../core/keycache";
import { benchOnce } from "../crypto/argon";
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
        ],
        applicationId: "-1",
        inputType: 1,
        type: 1,
        execute(args: Array<{ name: string; value: string }>, ctx: any) {
            const action = (args.find((a) => a.name === "action")?.value ?? "toggle").toLowerCase();
            const channelId: string | undefined = ctx?.channel?.id;

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
                        `GoofCrypt: ${settings().enabled ? "ON" : "OFF"} · ${getPasswordList().length} pw · ` +
                            `pw ${maskPassword(chosenPassword())} · RNG ${secureRngAvailable() ? rngSource() : "none"}`,
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
