/**
 * `/encrypt` slash command: toggle sending, cycle password, or report status.
 * Feedback is delivered via toast (returning { content } would post a real
 * message to the channel).
 */
import { settings, chosenPassword, cyclePassword, maskPassword, getPasswordList } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { getKey, isCached } from "../core/keycache";
import { showToast } from "./metro";

const STRING = 3; // ApplicationCommandOptionType.STRING

let dispose: (() => void) | null = null;

function canEnable(): boolean {
    return secureRngAvailable() || settings().allowInsecureRng;
}

/** Warm the Argon2 key for this channel+password so the first send isn't laggy. */
function warm(channelId: string | undefined): void {
    const pw = chosenPassword();
    if (!pw || !channelId || isCached(channelId, pw)) return;
    try {
        getKey(channelId, pw); // synchronous, one-time
    } catch {
        /* ignore */
    }
}

export function registerCommands(): void {
    if (dispose) return;
    dispose = bunny.api.commands.registerCommand({
        name: "encrypt",
        description: "Toggle GoofCrypt message encryption, cycle password, or show status",
        options: [
            {
                name: "action",
                description: "on | off | toggle | cycle | status",
                type: STRING,
                required: false,
            },
        ],
        execute(args: Array<{ name: string; value: string }>, ctx: any) {
            const action = (args.find((a) => a.name === "action")?.value ?? "toggle").toLowerCase();
            const channelId: string | undefined = ctx?.channel?.id;

            switch (action) {
                case "on":
                case "enable": {
                    if (getPasswordList().length === 0) {
                        showToast("GoofCrypt: set a password in plugin settings first");
                        break;
                    }
                    if (!canEnable()) {
                        showToast("GoofCrypt: no secure RNG — cannot enable encryption");
                        break;
                    }
                    settings().enabled = true;
                    warm(channelId);
                    showToast(`GoofCrypt ON — password ${maskPassword(chosenPassword())}`);
                    break;
                }
                case "off":
                case "disable":
                    settings().enabled = false;
                    showToast("GoofCrypt OFF");
                    break;
                case "cycle": {
                    const next = cyclePassword();
                    if (!next) showToast("GoofCrypt: no passwords configured");
                    else {
                        warm(channelId);
                        showToast(`GoofCrypt password → ${maskPassword(next)}`);
                    }
                    break;
                }
                case "status":
                    showToast(
                        `GoofCrypt: ${settings().enabled ? "ON" : "OFF"} · ` +
                            `${getPasswordList().length} pw · ` +
                            `pw ${maskPassword(chosenPassword())} · ` +
                            `RNG ${secureRngAvailable() ? rngSource() : "none"}`,
                    );
                    break;
                case "toggle":
                default: {
                    if (!settings().enabled && !canEnable()) {
                        showToast("GoofCrypt: no secure RNG — cannot enable encryption");
                        break;
                    }
                    if (!settings().enabled && getPasswordList().length === 0) {
                        showToast("GoofCrypt: set a password in plugin settings first");
                        break;
                    }
                    settings().enabled = !settings().enabled;
                    if (settings().enabled) warm(channelId);
                    showToast(`GoofCrypt ${settings().enabled ? "ON" : "OFF"}`);
                    break;
                }
            }
            // No return value -> nothing is posted to the channel.
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
