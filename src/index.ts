/**
 * Vendetta plugin entry. The loader evaluates the bundle and uses
 * `result.default` as the plugin instance: { onLoad, onUnload, settings }.
 *
 * `vendetta.plugin.storage` is already loaded by the time onLoad runs, so
 * settings/keycache can be initialised synchronously.
 */
import { initSettings, settings, isReady } from "./settings";
import { initKeyCache, clearMemory } from "./core/keycache";
import { detectRng, secureRngAvailable, rngSource } from "./crypto/random";
import { patchSend, unpatchSend } from "./discord/send";
import { patchFlux, unpatchFlux } from "./discord/flux";
import { registerCommands, unregisterCommands } from "./discord/commands";
import { showToast } from "./discord/metro";
import { SettingsComponent } from "./ui/Settings";

function SettingsScreen() {
    const React: any = vendetta.metro.common.React;
    const RN: any = vendetta.metro.common.ReactNative;
    if (!isReady()) return React.createElement(RN.Text, { style: { padding: 16 } }, "Loading…");
    return SettingsComponent();
}

export default {
    onLoad() {
        detectRng();

        const store = vendetta.plugin.storage;
        initSettings(store);
        initKeyCache(store);

        // Invariant: encryption can only be ON when a usable RNG exists.
        if (settings().enabled && !secureRngAvailable() && !settings().allowInsecureRng) {
            settings().enabled = false;
            showToast("GoofCrypt: no secure RNG found — encryption disabled");
        }

        patchSend();
        patchFlux();
        registerCommands();
        vendetta.logger.log(`GoofCrypt ready (RNG: ${secureRngAvailable() ? rngSource() : "none"})`);
    },

    onUnload() {
        unpatchSend();
        unpatchFlux();
        unregisterCommands();
        clearMemory();
    },

    settings: SettingsScreen,
};
