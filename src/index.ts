import { manifest } from "./manifest";
import { initSettings, settings, isReady } from "./settings";
import { initKeyCache, clearMemory } from "./core/keycache";
import { detectRng, secureRngAvailable, rngSource } from "./crypto/random";
import { patchSend, unpatchSend } from "./discord/send";
import { patchFlux, unpatchFlux } from "./discord/flux";
import { registerCommands, unregisterCommands } from "./discord/commands";
import { showToast } from "./discord/metro";
import { SettingsComponent } from "./ui/Settings";

const STORAGE_PROMISE = Symbol.for("bunny.storage.promise");

let active = false;

export default definePlugin({
    manifest,

    start() {
        active = true;
        detectRng();

        const storage = bunny.plugin.createStorage<any>();
        Promise.resolve((storage as any)[STORAGE_PROMISE])
            .then(() => {
                if (!active) return; // stopped before storage finished loading
                initSettings(storage);
                initKeyCache(storage);

                // Invariant: encryption can only be ON when a usable RNG exists.
                if (settings().enabled && !secureRngAvailable() && !settings().allowInsecureRng) {
                    settings().enabled = false;
                    showToast("GoofCrypt: no secure RNG found — encryption disabled");
                }

                patchSend();
                patchFlux();
                registerCommands();
                bunny.plugin.logger.log(`GoofCrypt ready (RNG: ${secureRngAvailable() ? rngSource() : "none"})`);
            })
            .catch((e) => bunny.plugin.logger.error("GoofCrypt init failed", e));
    },

    stop() {
        active = false;
        unpatchSend();
        unpatchFlux();
        unregisterCommands();
        clearMemory();
    },

    SettingsComponent() {
        if (!isReady()) {
            const React: any = bunny.metro.findByProps("createElement");
            const RN: any = bunny.metro.findByProps("View", "Text");
            return React.createElement(RN.Text, { style: { padding: 16 } }, "Loading…");
        }
        return SettingsComponent();
    },
});
