/**
 * Plugin settings UI. Text fields use local state + an explicit Save button so
 * the write to storage happens on a definite event (the per-keystroke write was
 * unreliable on-device — the same value set via `/encrypt set` works, so Save
 * mirrors that exact code path).
 */
import { settings } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";
import { importKeys } from "../core/keycache";
import { fromBase64 } from "../util/base64";
import { utf8Decode } from "../crypto/deflate";

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

function Input(props: { value: string; onChange: (v: string) => void; multiline?: boolean }) {
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
    const rng = secureRngAvailable() ? rngSource() : "NONE — sending unavailable";

    const save = () => {
        s.passwords = passwords;
        s.cover = cover;
        s.mark = mark;
        showToast("GoofCrypt: settings saved");
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
