/**
 * Plugin settings UI. Text fields use local state + an explicit Save button so
 * the write to storage happens on a definite event (the per-keystroke write was
 * unreliable on-device — the same value set via `/encrypt set` works, so Save
 * mirrors that exact code path).
 */
import {
    keySource,
    remoteSendSlot,
    setRemoteSendSlot,
    settings,
} from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { importKeys } from "../core/keycache";
import { fromBase64 } from "../util/base64";
import { utf8Decode } from "../crypto/deflate";
import {
    clearRemoteCache,
    clearRemoteSessionKey,
    forgetRemoteConfiguration,
    formatRemoteKdfStatus,
    refreshRemoteChannel,
    refreshRemoteRevision,
    remoteErrorMessage,
    saveRemoteConfiguration,
    setRemoteSessionKey,
} from "../cloud/remoteKdf";
import { getCurrentChannelId } from "../discord/metro";
import {
    changeKeySource,
    resetRemoteColdPath,
} from "../discord/remoteColdPath";

const React: any = vendetta.metro.common.React;
const RN: any = vendetta.metro.common.ReactNative;

function showToast(t: string) {
    try {
        vendetta.ui.toasts.showToast(t);
    } catch {
        /* ignore */
    }
}

function Label(props: { text: string; hint?: string }) {
    return (
        <RN.View style={{ marginBottom: 6 }}>
            <RN.Text style={{ fontWeight: "600", fontSize: 15, color: "#fff" }}>{props.text}</RN.Text>
            {props.hint ? <RN.Text style={{ opacity: 0.6, fontSize: 12, color: "#fff" }}>{props.hint}</RN.Text> : null}
        </RN.View>
    );
}

function Input(props: {
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    placeholder?: string;
    secureTextEntry?: boolean;
}) {
    return (
        <RN.TextInput
            style={{
                borderWidth: 1,
                borderColor: "#888",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                color: "#fff",
                minHeight: props.multiline ? 56 : undefined,
            }}
            value={props.value}
            multiline={props.multiline}
            placeholder={props.placeholder}
            placeholderTextColor="#888"
            secureTextEntry={props.secureTextEntry}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={props.onChange}
        />
    );
}

function Toggle(props: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
    const [on, setOn] = React.useState(props.value);
    return (
        <RN.View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
            <RN.View style={{ flex: 1, paddingRight: 12 }}>
                <Label text={props.label} hint={props.hint} />
            </RN.View>
            <RN.Switch
                value={on}
                onValueChange={(v: boolean) => {
                    setOn(v);
                    props.onChange(v);
                }}
            />
        </RN.View>
    );
}

export function SettingsComponent() {
    const s = settings();
    const [passwords, setPasswords] = React.useState(s.passwords ?? "");
    const [cover, setCover] = React.useState(s.cover ?? "");
    const [mark, setMark] = React.useState(s.mark ?? "");
    const [bundle, setBundle] = React.useState("");
    const [remoteHost, setRemoteHost] = React.useState(s.remoteHost ?? "");
    const [remoteToken, setRemoteToken] = React.useState("");
    const [remoteCloudKey, setRemoteCloudKey] = React.useState("");
    const [allowRemoteHttp, setAllowRemoteHttp] = React.useState(s.remoteAllowInsecureLocalhost ?? false);
    const [messageMode, setMessageMode] = React.useState(keySource());
    const [sendSlot, setSendSlot] = React.useState(remoteSendSlot()?.toString() ?? "");
    const [remoteStatus, setRemoteStatus] = React.useState(formatRemoteKdfStatus());
    const rng = secureRngAvailable() ? rngSource() : "NONE — sending unavailable";

    const updateRemoteStatus = () => setRemoteStatus(formatRemoteKdfStatus());

    const remoteFailure = (error: unknown) => {
        updateRemoteStatus();
        showToast(`GoofCrypt: ${remoteErrorMessage(error)}`);
    };

    const saveRemote = () => {
        const token = remoteToken.trim() || s.remoteAuthToken;
        try {
            resetRemoteColdPath();
            saveRemoteConfiguration(remoteHost, token, allowRemoteHttp);
            showToast("GoofCrypt: remote configuration saved; session key cleared if configuration changed");
        } catch (error) {
            remoteFailure(error);
        }
        setRemoteToken("");
        updateRemoteStatus();
    };

    const setSessionKey = () => {
        try {
            resetRemoteColdPath();
            setRemoteSessionKey(remoteCloudKey);
            showToast("GoofCrypt: session cloud key set; verify the current channel next");
        } catch (error) {
            remoteFailure(error);
        }
        setRemoteCloudKey("");
        updateRemoteStatus();
    };

    const verifyCurrentChannel = () => {
        const channelId = getCurrentChannelId();
        if (!channelId) {
            showToast("GoofCrypt: no current channel to refresh");
            return;
        }
        refreshRemoteChannel(channelId)
            .then(() => {
                updateRemoteStatus();
                showToast("GoofCrypt: current channel verified and remote keys refreshed");
            })
            .catch(remoteFailure);
    };

    const checkRemoteRevision = () => {
        refreshRemoteRevision(true)
            .then(() => {
                updateRemoteStatus();
                showToast("GoofCrypt: remote revision checked");
            })
            .catch(remoteFailure);
    };

    const save = () => {
        s.passwords = passwords;
        s.cover = cover;
        s.mark = mark;
        showToast("GoofCrypt: settings saved");
    };

    const changeMode = (value: "manual" | "remote") => {
        try {
            if (!changeKeySource(value)) throw new Error("invalid mode");
            setMessageMode(value);
            updateRemoteStatus();
            showToast(`GoofCrypt: message mode set to ${value}; sources never fall back`);
        } catch {
            showToast("GoofCrypt: could not change message mode safely");
        }
    };

    const saveSendSlot = () => {
        const raw = sendSlot.trim();
        const value = Number(raw);
        if (!raw || !setRemoteSendSlot(value)) {
            showToast("GoofCrypt: remote send slot must be an integer from 0 to 7");
            return;
        }
        setSendSlot(String(value));
        showToast(`GoofCrypt: remote send slot set to ${value}`);
    };

    const doImport = () => {
        try {
            const obj = JSON.parse(utf8Decode(fromBase64(bundle.trim())));
            const n = importKeys(obj?.keys ?? obj);
            setBundle("");
            showToast(`GoofCrypt: imported ${n} key(s)`);
        } catch {
            showToast("GoofCrypt: invalid key bundle");
        }
    };

    return (
        <RN.ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Toggle
                label="Encrypt outgoing messages"
                hint="Also toggle with /encrypt"
                value={s.enabled}
                onChange={(v) => (s.enabled = v)}
            />

            <Label
                text="Message key source"
                hint="Manual is the migration default. Remote never falls back to manual passwords or plaintext when setup fails."
            />
            <RN.Text style={{ opacity: 0.75, fontSize: 12, color: "#fff", marginBottom: 8 }}>
                Current mode: {messageMode ?? "INVALID — choose a mode"}
            </RN.Text>
            <RN.View style={{ flexDirection: "row", marginBottom: 8 }}>
                <RN.View style={{ flex: 1, marginRight: 4 }}>
                    <RN.Button title="Use manual mode" onPress={() => changeMode("manual")} />
                </RN.View>
                <RN.View style={{ flex: 1, marginLeft: 4 }}>
                    <RN.Button title="Use remote mode" onPress={() => changeMode("remote")} />
                </RN.View>
            </RN.View>
            <Label
                text="Remote send slot"
                hint="Exact GoofCord password position 0–7. Incoming remote messages try every current and retained old slot."
            />
            <Input value={sendSlot} onChange={setSendSlot} placeholder="0" />
            <RN.View style={{ height: 8 }} />
            <RN.Button title="Save remote send slot" onPress={saveSendSlot} />

            <Label text="Passwords" hint="Comma-separated. Share out-of-band; same as GoofCord." />
            <Input value={passwords} onChange={setPasswords} multiline />
            <RN.View style={{ height: 12 }} />
            <Label text="Cover message" hint="Visible text the secret hides inside. Empty = invisible message." />
            <Input value={cover} onChange={setCover} multiline />
            <RN.View style={{ height: 12 }} />
            <Label text="Decryption mark" hint="Prefix shown on decrypted messages." />
            <Input value={mark} onChange={setMark} />
            <RN.View style={{ height: 12 }} />
            <RN.Button title="Save settings" onPress={save} />

            <RN.View style={{ height: 28 }} />
            <Label text="Import keys (key-sync)" hint="Paste a bundle from the desktop derive-keys tool to skip on-device Argon2." />
            <Input value={bundle} onChange={setBundle} multiline />
            <RN.View style={{ height: 8 }} />
            <RN.Button title="Import keys" onPress={doImport} />

            <RN.View style={{ height: 28 }} />
            <Label
                text="Remote KDF (Stage 4 opt-in)"
                hint="Cached keys work synchronously. Cold sends are rejected with text kept; wait for the ready notice, then send again yourself."
            />
            <Label text="Remote HTTPS origin" hint="An origin only, with no path. Direct HTTP is development-only for exact loopback hosts." />
            <Input value={remoteHost} onChange={setRemoteHost} placeholder="https://cloud.example.com" />
            <RN.View style={{ height: 12 }} />
            <Label
                text="Existing cloud token"
                hint="Stored in plaintext Kettu storage. Leave blank to retain the configured token."
            />
            <Input
                value={remoteToken}
                onChange={setRemoteToken}
                placeholder={s.remoteAuthToken ? "Token configured" : "32-character lowercase token"}
                secureTextEntry
            />
            <Toggle
                label="Allow direct loopback HTTP"
                hint="Development only: exact localhost, 127.0.0.1, or [::1]."
                value={allowRemoteHttp}
                onChange={setAllowRemoteHttp}
            />
            <RN.Button title="Save remote origin and token" onPress={saveRemote} />

            <RN.View style={{ height: 18 }} />
            <Label
                text="Session cloud encryption key"
                hint="Memory-only and needed only for a new derive. Cached channel keys can still work after restart; this key clears on restart, unload, replacement, or configuration change."
            />
            <Input
                value={remoteCloudKey}
                onChange={setRemoteCloudKey}
                placeholder="Re-enter for each plugin session"
                secureTextEntry
            />
            <RN.View style={{ height: 8 }} />
            <RN.Button title="Set session cloud key" onPress={setSessionKey} />
            <RN.View style={{ height: 8 }} />
            <RN.Button
                title="Clear session cloud key"
                onPress={() => {
                    resetRemoteColdPath();
                    clearRemoteSessionKey();
                    setRemoteCloudKey("");
                    updateRemoteStatus();
                    showToast("GoofCrypt: session cloud key cleared");
                }}
            />

            <RN.View style={{ height: 18 }} />
            <RN.Button title="Verify and refresh current channel" onPress={verifyCurrentChannel} />
            <RN.View style={{ height: 8 }} />
            <RN.Button title="Check remote revision" onPress={checkRemoteRevision} />
            <RN.View style={{ height: 12 }} />
            <RN.Text style={{ opacity: 0.75, fontSize: 12, color: "#fff" }}>
                Message mode {messageMode ?? "INVALID"} · remote send slot {remoteSendSlot() ?? "INVALID"}
            </RN.Text>
            <RN.Text style={{ opacity: 0.75, fontSize: 12, color: "#fff" }}>{remoteStatus}</RN.Text>

            <RN.View style={{ height: 18 }} />
            <RN.Button
                title="Clear remote channel-key cache (manual keys kept)"
                onPress={() => {
                    resetRemoteColdPath();
                    clearRemoteCache();
                    updateRemoteStatus();
                    showToast("GoofCrypt: remote cache cleared; manual passwords and keys kept");
                }}
            />
            <RN.View style={{ height: 8 }} />
            <RN.Button
                title="Forget remote origin and token (manual settings kept)"
                onPress={() => {
                    resetRemoteColdPath();
                    forgetRemoteConfiguration();
                    setRemoteHost("");
                    setRemoteToken("");
                    setRemoteCloudKey("");
                    setAllowRemoteHttp(false);
                    updateRemoteStatus();
                    showToast("GoofCrypt: remote configuration, session key, and remote cache cleared; manual settings kept");
                }}
            />

            <Toggle
                label="Allow insecure RNG"
                hint="Only if no secure RNG is found. Uses Math.random — weaker. Off by default."
                value={s.allowInsecureRng}
                onChange={(v) => (s.allowInsecureRng = v)}
            />
            <RN.Text style={{ opacity: 0.6, fontSize: 12, marginTop: 8, color: "#fff" }}>Secure RNG: {rng}</RN.Text>
        </RN.ScrollView>
    );
}
