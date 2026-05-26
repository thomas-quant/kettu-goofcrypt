/**
 * Plugin settings UI. Uses React + react-native primitives resolved from Metro
 * (external plugins can't import these directly). Built with the classic JSX
 * runtime (React.createElement), so `React` must be in scope.
 */
import { settings } from "../settings";
import { secureRngAvailable, rngSource } from "../crypto/random";

const React: any = vendetta.metro.common.React;
const RN: any = vendetta.metro.common.ReactNative;

function Field(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
    const [val, setVal] = React.useState(props.value ?? "");
    return (
        <RN.View style={{ marginBottom: 18 }}>
            <RN.Text style={{ fontWeight: "600", fontSize: 15, marginBottom: 6 }}>{props.label}</RN.Text>
            {props.hint ? (
                <RN.Text style={{ opacity: 0.6, fontSize: 12, marginBottom: 6 }}>{props.hint}</RN.Text>
            ) : null}
            <RN.TextInput
                style={{
                    borderWidth: 1,
                    borderColor: "#888",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    color: "#fff",
                    minHeight: props.multiline ? 64 : undefined,
                }}
                value={val}
                multiline={props.multiline}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(v: string) => {
                    setVal(v);
                    props.onChange(v);
                }}
            />
        </RN.View>
    );
}

function Toggle(props: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
    const [on, setOn] = React.useState(props.value);
    return (
        <RN.View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
            <RN.View style={{ flex: 1, paddingRight: 12 }}>
                <RN.Text style={{ fontWeight: "600", fontSize: 15 }}>{props.label}</RN.Text>
                {props.hint ? <RN.Text style={{ opacity: 0.6, fontSize: 12 }}>{props.hint}</RN.Text> : null}
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
    const rng = secureRngAvailable() ? rngSource() : "NONE — sending unavailable";

    return (
        <RN.ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Toggle
                label="Encrypt outgoing messages"
                hint="Also toggle quickly with /encrypt"
                value={s.enabled}
                onChange={(v) => (s.enabled = v)}
            />
            <Field
                label="Passwords"
                hint="Comma-separated. Share out-of-band with your recipient(s). Same as GoofCord."
                value={s.passwords}
                onChange={(v) => (s.passwords = v)}
                multiline
            />
            <Field
                label="Cover message"
                hint="Visible text the secret hides inside. Empty = invisible message."
                value={s.cover}
                onChange={(v) => (s.cover = v)}
                multiline
            />
            <Field label="Decryption mark" hint="Prefix shown on decrypted messages." value={s.mark} onChange={(v) => (s.mark = v)} />
            <Toggle
                label="Allow insecure RNG"
                hint="Only if no secure RNG is found. Uses Math.random for nonces — weaker. Off by default."
                value={s.allowInsecureRng}
                onChange={(v) => (s.allowInsecureRng = v)}
            />
            <RN.Text style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>Secure RNG: {rng}</RN.Text>
        </RN.ScrollView>
    );
}
