# External Integrations

**Analysis Date:** 2026-07-18

## APIs & External Services

**Discord mobile / Kettu host:**
- Provides the runtime for the plugin and the Discord message lifecycle; integration is through injected `vendetta` APIs in `src/index.ts`, `src/discord/metro.ts`, `src/discord/send.ts`, `src/discord/flux.ts`, and `src/discord/commands.ts`.
  - Integration method: Kettu evaluates `site/index.js`; the plugin patches message send/edit methods and Flux dispatch, registers `/encrypt`, and renders a React Native settings screen.
  - Auth: Discord/Kettu host session; GoofCrypt does not handle tokens or credentials.
  - Host surfaces: `vendetta.plugin.storage`, `vendetta.patcher`, `vendetta.metro`, `vendetta.commands`, `vendetta.ui.toasts`, and `vendetta.logger`.

**Discord/GoofCord message format:**
- GoofCord desktop and `stegcloak-rs` - External interoperability target, not a network API.
  - Integration method: deterministic Argon2id key derivation using the Discord channel ID as salt, raw DEFLATE, XChaCha20-Poly1305, and zero-width-character steganography.
  - Compatibility oracle: `stegcloak-rs` is imported only by `tests/harness.ts` and is excluded from the production bundle.
  - Data boundary: ciphertext is sent through normal Discord message content; cover text remains visible while encrypted payload bytes are encoded into zero-width characters.

## Data Storage

**Plugin storage:**
- Kettu's reactive `vendetta.plugin.storage` proxy - Persists settings, comma-separated passwords, imported/derived key cache, and non-secret native-probe diagnostics.
  - Connection: host-injected storage object initialized in `src/index.ts` and wrapped by `src/settings.ts` / `src/core/keycache.ts`.
  - Format: JSON-compatible objects; derived keys are base64 strings indexed by channel ID and hashed password ID.
  - Security boundary: passwords and derived keys are plaintext in device storage/backups; there is no OS keychain integration.

**Databases and file storage:**
- None in the application. There is no database, server-side file store, cache service, or remote data API.

## Authentication & Identity

**Auth Provider:**
- None implemented by GoofCrypt. Discord authentication remains entirely inside Discord mobile/Kettu.

**OAuth Integrations:**
- None.

## Monitoring & Observability

**Error Tracking:**
- None. Errors are surfaced through `vendetta.ui.toasts.showToast` and `vendetta.logger`; hot-path failures are counted in `src/core/health.ts`.

**Analytics:**
- None. No telemetry or event export is present.

**Logs:**
- Kettu/Vendetta logger - Plugin lifecycle, diagnostics, and failures via `vendetta.logger.log` / `vendetta.logger.error`.
- On-device diagnostics - `globalThis.__goofcrypt.diag()` and `/encrypt status` expose non-secret state; native crypto probing stores only module names, booleans, timings, and verdicts.

## CI/CD & Deployment

**Hosting:**
- GitHub Pages - Static distribution of `site/manifest.json` and `site/index.js`; the installer URL is documented in `README.md`.
  - Deployment: `.github/workflows/ci.yml` builds Pages artifacts after the compatibility test job succeeds.
  - Environment vars/secrets: No application secrets or API keys are required; Pages deployment uses GitHub's workflow token permissions.

**CI Pipeline:**
- GitHub Actions - `.github/workflows/ci.yml` checks out the repository, uses Node.js 24, installs npm dependencies, runs `npm test`, then builds and deploys `site/` to Pages.
  - External actions: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, and `actions/deploy-pages@v4`.

## Environment Configuration

**Development:**
- Required environment variables: none.
- Local state: npm dependencies, generated test output under `tests/dist/`, and generated Pages output under `site/`.
- Device state: Kettu plugin storage contains user settings and the key cache.

**Staging:**
- No staging environment or staging services; local/device testing uses the same static bundle model.

**Production:**
- Static GitHub Pages artifact only; no runtime secrets management, failover service, database replication, or server process.

## Webhooks & Callbacks

**Incoming:**
- None. Discord dispatch is intercepted locally through the host Flux dispatcher rather than an HTTP webhook.

**Outgoing:**
- None from GoofCrypt. Encrypted content is submitted through Discord's existing mobile client send/edit functions.

---

*Integration audit: 2026-07-18*
*Update when adding/removing external services*
