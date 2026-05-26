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
  - `/encrypt on` · `off` · `toggle` · `cycle` (next password) · `status`

Passwords, cover, and the displayed mark are configured in the plugin's settings
page. The salt is the Discord channel ID (same as GoofCord), so a key is derived
once per conversation and cached.

## Security notes

- This is **pre-shared-password** crypto for casual privacy — not a secure enclave.
- Passwords and the derived-key cache are stored in **plaintext** in Kettu's plugin
  storage (mobile has no OS keychain). Anyone with file/backup access to your device
  can read them.
- Sending requires a secure random source for nonces. If none is found, sending is
  disabled (decryption still works). You can opt into an insecure `Math.random`
  fallback in settings, but it's off by default and not recommended.
- Argon2id (64 MiB) runs once per (channel, password) on first use and is cached;
  expect a brief one-time pause when first opening/encrypting a new conversation.

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
