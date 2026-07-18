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
import { runProbe, reconcileArmedFlag } from "./discord/nativeProbe";
import { showToast } from "./discord/metro";
import { selfTest } from "./selfTest";
import { SettingsComponent } from "./ui/Settings";
import { initRemoteKdf, refreshRemoteRevisionOnLoad, shutdownRemoteKdf } from "./cloud/remoteKdf";

/**
 * On-load native-crypto probe wiring (enumeration-only, stale-gated). Runs after
 * settings/keycache init so settings() is ready.
 *   - First reconciles a still-set armed flag (D-05): a candidate that crashed
 *     the app last run is marked crashed/unsafe.
 *   - Then re-runs enumeration ONLY when the stored report is missing OR its
 *     buildTag differs from the currently-detected one (D-02 staleness trigger).
 * It NEVER invokes native crypto on load (D-03) — candidate tests run solely via
 * the manual /encrypt diag --test verb.
 */
function maybeRunProbe(): void {
    const existing = settings().nativeProbe;
    if (existing) reconcileArmedFlag(existing);
    const currentTag = enumerateBuildTag();
    const stale = !existing || existing.buildTag !== currentTag;
    if (stale) runProbe();
}

/**
 * Cheap build-tag read mirroring nativeProbe's detector, used only for the
 * staleness comparison (D-02). Kept local + guarded; if no tag is reachable it
 * returns null and the stored report's null buildTag makes the probe re-run only
 * when the report is missing (A5 manual-only re-probe fallback).
 */
function enumerateBuildTag(): string | null {
    try {
        const v: any = (globalThis as any).vendetta;
        const ci = v?.metro?.common?.constants?.ClientInfoModule || v?.metro?.findByProps?.("Build", "Version");
        const tag = ci?.Build || ci?.Version || ci?.OTABuild;
        if (tag) return String(tag);
    } catch {}
    return null;
}

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
            initRemoteKdf(store);

            // Debug hook for on-device inspection via /eval. Non-secret only
            // (no raw passwords / storage ref).
            (globalThis as any).__goofcrypt = {
                // v2: diag() now surfaces the persisted native-crypto ProbeReport
                // (non-secret only — module names + booleans + timing; NO key
                // bytes, NO passwords, per the non-secret rule above).
                version: 2,
                diag: () => ({
                    enabled: settings().enabled,
                    passwords: getPasswordList().length,
                    rng: secureRngAvailable() ? rngSource() : "none",
                    selfTest: selfTest(),
                    nativeProbe: settings().nativeProbe ?? null,
                }),
                selfTest,
            };
            if (settings().enabled && !secureRngAvailable() && !settings().allowInsecureRng) {
                settings().enabled = false;
                showToast("GoofCrypt: no secure RNG found — encryption disabled");
            }
        });

        // Enumeration-only native-crypto probe (D-03), wired AFTER settings/keycache
        // init so settings() is ready. Stale-gated (D-02) + armed-flag reconcile
        // (D-05); never invokes native crypto on load. Isolated in safe() so a
        // probe failure cannot break plugin init.
        safe("native-probe", maybeRunProbe);
        safe("remote-kdf", refreshRemoteRevisionOnLoad);

        safe("decrypt-hook", patchFlux);
        safe("send-patch", patchSend);
        safe("command", registerCommands);

        try {
            vendetta.logger.log(`GoofCrypt ready (RNG: ${secureRngAvailable() ? rngSource() : "none"})`);
        } catch {}
    },

    onUnload() {
        shutdownRemoteKdf();
        unpatchSend();
        unpatchFlux();
        unregisterCommands();
        clearMemory();
    },

    settings: SettingsScreen,
};
