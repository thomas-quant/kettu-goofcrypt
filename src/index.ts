/**
 * Vendetta plugin entry. The loader evaluates the bundle and uses
 * `result.default` as the plugin instance: { onLoad, onUnload, settings }.
 *
 * `vendetta.plugin.storage` is already loaded by the time onLoad runs, so
 * settings/keycache can be initialised synchronously.
 */
import { initSettings, settings, isReady, getPasswordList } from "./settings";
import { initKeyCache, clearMemory } from "./core/keycache";
import { detectRng, secureRngAvailable, rngSource } from "./crypto/random";
import { patchSend, unpatchSend } from "./discord/send";
import { patchFlux, unpatchFlux } from "./discord/flux";
import { registerCommands, unregisterCommands } from "./discord/commands";
import { showToast } from "./discord/metro";
import { selfTest } from "./selfTest";
import { SettingsComponent } from "./ui/Settings";

function SettingsScreen() {
    const React: any = vendetta.metro.common.React;
    const RN: any = vendetta.metro.common.ReactNative;
    if (!isReady()) return React.createElement(RN.Text, { style: { padding: 16 } }, "Loading…");
    return SettingsComponent();
}

export default {
    onLoad() {
        // Each subsystem is isolated so one failure can't block the whole plugin
        // (and decryption keeps working even if the send patch or command fails).
        const safe = (label: string, fn: () => void) => {
            try {
                fn();
            } catch (e) {
                try {
                    vendetta.logger.error(`GoofCrypt: ${label} failed`, e);
                } catch {}
                showToast(`GoofCrypt: ${label} failed — ${(e as Error)?.message ?? e}`);
            }
        };

        safe("self-test", () => {
            const fail = selfTest();
            if (fail) {
                showToast("GoofCrypt SELF-TEST FAILED: " + fail);
                vendetta.logger.error("GoofCrypt self-test failed:", fail);
            }
        });

        safe("init", () => {
            detectRng();
            const store = vendetta.plugin.storage;
            initSettings(store);
            initKeyCache(store);

            // Debug hook for on-device inspection via /eval. Non-secret only
            // (no raw passwords / storage ref).
            (globalThis as any).__goofcrypt = {
                version: 1,
                diag: () => ({
                    enabled: settings().enabled,
                    passwords: getPasswordList().length,
                    rng: secureRngAvailable() ? rngSource() : "none",
                    selfTest: selfTest(),
                }),
                selfTest,
            };
            if (settings().enabled && !secureRngAvailable() && !settings().allowInsecureRng) {
                settings().enabled = false;
                showToast("GoofCrypt: no secure RNG found — encryption disabled");
            }
        });

        safe("decrypt-hook", patchFlux);
        safe("send-patch", patchSend);
        safe("command", registerCommands);

        try {
            vendetta.logger.log(`GoofCrypt ready (RNG: ${secureRngAvailable() ? rngSource() : "none"})`);
        } catch {}
    },

    onUnload() {
        unpatchSend();
        unpatchFlux();
        unregisterCommands();
        clearMemory();
    },

    settings: SettingsScreen,
};
