# GoofCrypt

GoofCord-compatible **message encryption for Kettu** (Discord mobile). Encrypt and
decrypt messages on your phone that interoperate byte-for-byte with
[GoofCord](https://github.com/Milkshiift/GoofCord)'s StegCloak encryption on desktop.

It is a pure-JavaScript reimplementation of GoofCord's
[`stegcloak-rs`](https://github.com/Milkshiift/stegcloak-rs) wire format
(Argon2id → Deflate → XChaCha20-Poly1305 → base-8 zero-width-char steganography),
because Kettu runs in React Native's Hermes engine which has no WebAssembly.

## Install

It's a Vendetta-format plugin.

1. In Kettu: **Settings → Plugins → (＋) install from URL** and paste:

   ```
   https://thomas-quant.github.io/kettu-goofcrypt/
   ```

   (Kettu will warn that it's an unproxied external source — tap **Continue**.)
2. Open the plugin's settings and enter the **same password(s)** you use in
   GoofCord (comma-separated for multiple), and optionally a cover message.

## Usage

- **Receiving** is always on: any message encrypted with one of your passwords is
  decrypted in place and shown with a 🔒 prefix.
- **Sending**: turn encryption on with the `/encrypt` command (or the settings
  toggle), then send normally. Your message is hidden inside the cover text.
  - `/encrypt on` · `off` · `toggle` · `mode-manual` · `mode-remote` · `status`

Passwords, cover, and the displayed mark are configured in the plugin's settings
page. The salt is the Discord channel ID (same as GoofCord), so a key is derived
once per conversation and cached.

## Key-sync (skip the on-device Argon2 wait)

Argon2id (64 MiB) is fixed by GoofCord's format and takes ~10s the first time per
chat on mobile (then cached forever). To avoid that wait, derive keys on your
**desktop** at native speed and import them — mobile then runs **zero Argon2**
for those chats:

```bash
# on desktop, in this repo:
npm run derive -- --passwords "yourPassword" --channels "<channelId1>,<channelId2>"
```
(Get a channel ID: Discord Developer Mode → right-click a DM/channel → Copy Channel
ID.) It prints a base64 bundle. On mobile, paste it via **`/encrypt import:<bundle>`**
or the "Import keys" field in the plugin settings.

Without key-sync it still works — the first message in each chat just shows a
"deriving key…" toast and takes ~10s once.

## Remote KDF mode (Stage 4 opt-in)

Manual mode remains the default for existing and new installations. Remote mode
is an explicit separate key source selected in settings or with
`/encrypt mode-remote`; it never silently falls back to manual passwords, local
Argon2, a different remote slot, or plaintext. `/encrypt mode-manual` switches
back deliberately. The remote send slot is the exact 0-based GoofCord password
position and can be set in settings or advanced with `remote-slot-next` after a
current channel cache exists.

On receive, GoofCrypt first verifies that zero-width content decodes to a
complete supported frame. Only then may a cache miss start remote work. Current
and at most two retained old revisions are tried locally, newest first and in
stable server slot order; old revisions are decrypt-only. Multiple cold messages
for one channel/revision share one request and a bounded waiting set. Successful
messages are retried locally and updated; failures remain ciphertext. Actual
derive failures enter a 30-second client cooldown so history loads cannot hammer
the worker.

On send, only the selected slot from the current send-capable revision is valid,
and the authoritative revision check must be less than five minutes old. A hot
key encrypts synchronously. A cold, missing, or stale key starts/joins preparation
but **rejects that send immediately**, keeping the composer text unchanged. Wait
for the ready notice and send again yourself. GoofCrypt never queues or
automatically replays plaintext, preventing duplicates, reordering, and sends
after intent changed.

To prepare remote state, enter an HTTPS origin and your existing GoofCord raw
32-character lowercase cloud token in the masked settings fields. Origins may
not contain credentials, paths, queries, or fragments. Direct HTTP is rejected
unless the development option is enabled and the host is exactly `localhost`,
`127.0.0.1`, or `[::1]`. The mobile client calls only the read-only derivation
surface at `/v2/kdf/derive` and `/v2/kdf/revision`; it never writes or reads the
server-owned blob through `/v1/save`, `/v1/load`, or `/v1/delete`.

The revocable token and bounded channel-key cache are stored in plaintext Kettu
plugin storage. The cloud encryption key is different: it stays only in memory,
must be re-entered after restart, and is cleared on replacement, remote
configuration changes, forgetting credentials, and plugin unload. After setting
it, use **Verify and refresh current channel** to prove the server can decrypt a
password-bearing settings blob and populate that channel's ordered keys. A
restart does not delete cached channel keys: cached incoming keys and a
current/fresh selected send key can still work without the session cloud key;
the key is requested again only when a new remote derive is needed.

Remote status, channel refresh, revision check, and remote-cache clear are also
available as `/encrypt` actions. Secret token/key values are deliberately
settings-only because slash-command arguments and bot replies are copyable. The
remote cache keeps the current revision and at most two older decrypt-only
revisions per channel. Clearing it preserves remote credentials and every manual
password/imported key; forgetting remote configuration removes the origin,
token, session key, and remote cache while still preserving manual settings.

Missing configuration/session key, invalid or expired token, missing/passwordless
cloud settings, wrong cloud key, busy worker, timeout, unavailable service,
malformed response, cooldown, stale state, and unavailable slot all reject
explicitly without a source or plaintext downgrade. If Kettu lacks the bounded
fetch, abort, URL, or response-reading APIs, status reports
`REMOTE_UNSUPPORTED`. Real-device redirect and abort semantics remain an
explicit Stage 5 verification gate; see
[`docs/REMOTE_KDF_MOBILE_TRANSPORT.md`](docs/REMOTE_KDF_MOBILE_TRANSPORT.md).

## `/encrypt` command

`on` · `off` · `toggle` · `cycle` (next password) · `status` · `bench` (time Argon2) ·
`set:<passwords>` (set comma-separated passwords) · `import:<bundle>` (key-sync) ·
`mode-manual` · `mode-remote` · `remote-slot-next` · `remote-status` ·
`remote-refresh` · `remote-check` · `remote-clear`.

## Security notes

- This is **pre-shared-password** crypto for casual privacy — not a secure enclave.
- Passwords and the derived-key cache are stored in **plaintext** in Kettu's plugin
  storage (mobile has no OS keychain). Anyone with file/backup access to your device
  can read them.
- A configured remote cloud token and remote channel-key cache are likewise
  plaintext. The universal cloud encryption key is session-only and is never
  persisted, but JavaScript managed strings cannot be reliably overwritten in
  place; clearing removes references controlled by the plugin.
- Sending requires a secure random source for nonces. If none is found, sending is
  disabled (decryption still works). You can opt into an insecure `Math.random`
  fallback in settings, but it's off by default and not recommended.
- In manual mode, Argon2id (64 MiB) runs once per (channel, password) on first use
  and is cached. Remote mode never calls the local Argon path on a message miss.

## Compatibility

Wire-compatible with GoofCord's current `stegcloak-rs` (`VERSION_1`):
Argon2id (v0x13, m=65536 KiB, t=3, p=1, 32-byte key, salt=channelId) · raw Deflate ·
XChaCha20-Poly1305 (24-byte nonce, AAD `[0x01]`) · payload `[0x01]+nonce+ct+tag` ·
base-8 over `U+200B U+200C U+200D U+2060 U+2061 U+2062 U+2063 U+2064`, distributed
across the cover's whitespace runs.

The CI runs a byte-compatibility harness that cross-checks both directions against
the real `stegcloak-rs` WASM library on every push.

## Develop

All builds and tests run in **GitHub Actions** (`.github/workflows/ci.yml`):

- `npm test` — esbuild-bundles `tests/harness.ts` (with the `stegcloak-rs` wasm) and
  runs the byte-compat cross-check.
- `npm run build` — produces the Pages site `site/` (`manifest.json` + `index.js`),
  which is deployed to GitHub Pages.
