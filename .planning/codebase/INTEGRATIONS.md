# External Integrations

**Analysis Date:** 2026-05-30

## APIs & External Services

**Discord (via Vendetta/Kettu plugin API):**
- The plugin integrates with Discord exclusively through the `vendetta` global injected by the Kettu loader — not via HTTP calls or a REST client
- Message send interception: `vendetta.patcher.instead("sendMessage", ...)` and `vendetta.patcher.instead("editMessage", ...)` via `src/discord/send.ts`
- Message receive interception: `vendetta.patcher.before("dispatch", FluxDispatcher(), ...)` to hook `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `LOAD_MESSAGES_SUCCESS`, `MESSAGE_START_EDIT` events — `src/discord/flux.ts`
- Slash command registration: `vendetta.commands.registerCommand(...)` — `src/discord/commands.ts`
- Module resolution: `vendetta.metro.findByProps(...)` and `vendetta.metro.common.*` for `FluxDispatcher`, `React`, `ReactNative`, channel utilities — `src/discord/metro.ts`
- Toast notifications: `vendetta.ui.toasts.showToast(...)` — `src/discord/metro.ts`
- Persistent storage: `vendetta.plugin.storage` (reactive proxy object, no explicit API key) — `src/index.ts`, `src/settings.ts`, `src/core/keycache.ts`
- Logging: `vendetta.logger.log`, `vendetta.logger.error` — `src/index.ts`

**stegcloak-rs (WASM, test-only):**
- GitHub package: `github:Milkshiift/stegcloak-rs`
- Used exclusively in `tests/harness.ts` as a reference implementation for cross-compatibility verification
- Loaded via esbuild's `.wasm` file loader during `npm test`; never included in the production plugin bundle
- No network calls; pure local WASM computation

## Data Storage

**Databases:**
- None — no external database

**Plugin storage:**
- Provider: Kettu/Vendetta `vendetta.plugin.storage` reactive proxy
- Stores: settings (enabled flag, passwords string, cover text, mark prefix, chosenIndex, allowInsecureRng flag) and key cache (`keys: Record<channelId, Record<passwordId, base64Key>>`)
- Access: synchronous reads/writes via the proxy object; persists across plugin reloads
- Key material stored in plaintext JSON on device storage — intentional design trade-off documented in `src/core/keycache.ts`

**File Storage:**
- None (plugin context) — build artifacts written to `site/` directory locally and on GitHub Pages

**Caching:**
- In-process memory cache: `Map<string, Uint8Array>` in `src/core/keycache.ts` for hot-path key lookups (no TTL, cleared on `onUnload`)
- Persisted key cache: same keys serialised as base64 into `vendetta.plugin.storage.keys`

## Authentication & Identity

**Auth Provider:**
- None — the plugin has no user authentication of its own
- Encryption is pre-shared-password based; passwords stored in `vendetta.plugin.storage.passwords` as a user-managed comma-separated string
- Password identity hashing: SHA-256 via `@noble/hashes/sha2` (128-bit truncated prefix) used as a stable, non-reversible storage key for the persisted key cache — `src/core/keycache.ts`

## Monitoring & Observability

**Error Tracking:**
- None (no external service)
- In-process counters only: `health.deriveFails`, `health.decryptCorrupt`, `health.sendAborts`, `health.lastError` in `src/core/health.ts`
- Surfaced on demand via `/encrypt status` command toast

**Logs:**
- `vendetta.logger.log` / `vendetta.logger.error` for debug output visible in Kettu's log view
- Toast notifications (`vendetta.ui.toasts.showToast`) for user-facing messages
- `console.log` / `console.error` in build scripts and test harness only (not in plugin bundle)

## CI/CD & Deployment

**Hosting:**
- GitHub Pages — `site/` directory (containing `manifest.json` + `index.js`) deployed on every push to `main`
- Deployment URL provided by the `github-pages` environment output (`${{ steps.deploy.outputs.page_url }}`)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml`)
- Two jobs: `test` (byte-compat harness vs stegcloak-rs) then `build-deploy` (esbuild + swc + GitHub Pages upload)
- Node.js 24 on `ubuntu-latest`
- Deploy requires `pages: write` and `id-token: write` permissions on the `build-deploy` job

## Environment Configuration

**Required env vars:**
- None — the plugin and build pipeline require no environment variables or secrets
- GitHub Pages deployment uses the built-in `GITHUB_TOKEN` with `pages: write` permission (granted in workflow YAML)

**Secrets location:**
- No application secrets; GitHub's automated `GITHUB_TOKEN` handles Pages deployment

## Webhooks & Callbacks

**Incoming:**
- None — the plugin is purely client-side

**Outgoing:**
- None — all Discord communication happens through the patched in-process `sendMessage`/`editMessage`/`FluxDispatcher` methods, not direct HTTP

---

*Integration audit: 2026-05-30*
