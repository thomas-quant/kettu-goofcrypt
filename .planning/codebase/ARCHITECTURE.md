# Architecture

**Analysis Date:** 2026-07-18

## Pattern Overview

**Overall:** Layered, event-driven mobile plugin with a pure cryptographic core and host-adapter edge.

**Key Characteristics:**
- Single static bundle evaluated by Kettu/Vendetta inside Discord mobile's Hermes runtime.
- Synchronous hot-path interception with asynchronous, deduplicated Argon2id warming on cache misses.
- Pure-JS stegcloak-rs-compatible protocol implementation; compatibility is verified against the Rust/WASM reference.
- Host state is persisted through `vendetta.plugin.storage`; no server, database, or API is involved.
- Build-time ES5 lowering and structural guards enforce Hermes `eval` constraints.

## Layers

**Host integration layer:**
- Purpose: Attach to Discord mobile internals and expose plugin lifecycle/UI.
- Contains: Flux dispatch and message-action patches, Metro resolution, slash commands, native probing, plugin entry, settings screen.
- Location: `src/discord/`, `src/ui/`, `src/index.ts`.
- Depends on: Core services, settings, randomness, Vendetta globals.
- Used by: Kettu/Vendetta plugin loader and Discord runtime.

**Core orchestration layer:**
- Purpose: Coordinate multi-password encryption/decryption, channel scoping, cache lookup, payload errors, and health counters.
- Contains: `src/core/encrypt.ts`, `src/core/decrypt.ts`, `src/core/keycache.ts`, `src/core/payload.ts`, `src/core/stegcloak.ts`, `src/core/health.ts`.
- Depends on: Crypto, steganography, base64, and typed settings storage.
- Used by: Discord adapters, UI, self-test, and desktop key tooling.

**Primitive layer:**
- Purpose: Implement wire-format primitives independently of Discord.
- Contains: XChaCha20-Poly1305 in `src/crypto/aead.ts`, Argon2id in `src/crypto/argon.ts`, compression/UTF-8 in `src/crypto/deflate.ts`, RNG selection in `src/crypto/random.ts`, and zero-width encoding in `src/stego/zwc.ts`.
- Depends on: `@noble/ciphers`, `@noble/hashes`, `fflate`, or no dependency for pure arithmetic modules.
- Used by: Core protocol and tests.

**Persistence/configuration layer:**
- Purpose: Provide typed access to Kettu's reactive storage and normalize user settings.
- Contains: `src/settings.ts` and the `KeyCacheStore` shape.
- Depends on: Host-provided storage proxy.
- Used by: Every stateful subsystem and the settings UI.

## Data Flow

**Outgoing message encryption:**

1. Discord invokes `sendMessage`/`editMessage` through the patched actions in `src/discord/send.ts`.
2. The patch bypasses disabled, empty, already-cloaked, or passwordless messages.
3. `getCachedKey()` performs a non-blocking lookup for `(channelId, password)`.
4. On a hit, `src/core/encrypt.ts` compresses UTF-8 text, frames nonce/ciphertext, hides it in cover text, and the original action sends the rewritten content.
5. On a miss, `deriveKey()` runs `argon2idAsync` in the background, rejects the current send while retaining composer text, and asks the user to resend.

**Incoming message decryption:**

1. `src/discord/flux.ts` observes `MESSAGE_CREATE`, `MESSAGE_UPDATE`, and `LOAD_MESSAGES_SUCCESS`.
2. Cloaked and already-marked messages are skipped; cached passwords are tried synchronously by `src/core/decrypt.ts`.
3. A successful result replaces content and records a message re-entrancy guard.
4. On a cache miss, background derivation warms missing channel/password keys, then dispatches a `MESSAGE_UPDATE` with decrypted content.
5. Edit events strip the configured display mark before Discord editing.

**Build and delivery:**

1. `scripts/build.mjs` bundles `src/index.ts` with esbuild.
2. The noble Argon2 yield is patched from a microtask to `setTimeout` macrotasks.
3. SWC lowers the bundle to ES5 and guards against classes, generators, iterator lowering, and invalid Kettu expressions.
4. The wrapped expression and manifest are written to `site/index.js` and `site/manifest.json` for static GitHub Pages installation.

**State Management:**
- Persistent settings and base64 key cache live in the reactive object initialized by `initSettings()` and `initKeyCache()`.
- Hot keys, pending derivation promises, winner hints, and Flux guards are module-level in-memory collections.
- `clearMemory()` and patch teardown run from `onUnload()`; persisted keys remain across restarts.

## Key Abstractions

**Compatible protocol pipeline:**
- Purpose: Preserve byte-level GoofCord/stegcloak-rs interoperability.
- Examples: `hide()`/`reveal()` in `src/core/stegcloak.ts`, `frame()`/`unframe()` in `src/core/payload.ts`, `conceal()`/`extract()` in `src/stego/zwc.ts`.
- Pattern: Pure functions with injected RNG and explicit domain errors.

**Two-level derived-key cache:**
- Purpose: Remove repeated 64 MiB Argon2id work and support imported desktop keys.
- Examples: `getCachedKey()`, `deriveKey()`, `importKeys()` in `src/core/keycache.ts`.
- Pattern: In-memory Map plus persisted base64 records, with a pending-promise map for concurrency deduplication.

**Host patch lifecycle:**
- Purpose: Safely install and remove Discord hooks.
- Examples: `patchFlux()`/`unpatchFlux()`, `patchSend()`/`unpatchSend()`, command registration in `src/discord/commands.ts`.
- Pattern: Module singleton disposer, idempotent patching, best-effort teardown.

## Entry Points

**Plugin lifecycle:**
- Location: `src/index.ts` default export.
- Triggers: Kettu evaluates the bundle and invokes `onLoad`, `onUnload`, or `settings`.
- Responsibilities: Isolated subsystem initialization, RNG gate, self-test, native probe, patch installation, debug diagnostics, and cleanup.

**Build entry:**
- Location: `scripts/build.mjs`.
- Triggers: `npm run build`.
- Responsibilities: Bundle, transform, validate, and publish the static plugin assets.

**Compatibility test entry:**
- Location: `scripts/test.mjs` → `tests/harness.ts`.
- Triggers: `npm test`.
- Responsibilities: Bundle the WASM reference harness and run cross-direction protocol checks.

## Error Handling

**Strategy:** Domain errors are explicit in the core; host callbacks catch failures so Discord hooks and plugin initialization remain resilient.

**Patterns:**
- `PayloadNotFoundError`, `DecryptionError`, `IntegrityError`, and `MessageTooLongError` distinguish expected protocol/user failures.
- `src/index.ts` wraps initialization subsystems with `safe()` and reports failures through Vendetta logs/toasts.
- Flux/send hook failures are caught; silent operational failures increment counters through `noteError()` in `src/core/health.ts`.
- Cache misses return `null` synchronously rather than throwing or deriving on the dispatch thread.

## Cross-Cutting Concerns

**Compatibility:** `tests/harness.ts` checks both our→reference and reference→ours behavior, including Unicode, whitespace, long messages, wrong passwords, and stego identity.

**Runtime safety:** No `TextEncoder`/`Buffer` assumption in shipped code; UTF-8/base64 use `fflate` and `src/util/base64.ts`. No native module or WASM is shipped.

**Security:** Outgoing encryption is gated on secure RNG unless `allowInsecureRng` is explicitly enabled. Persisted passwords/keys are plaintext storage and are documented as casual-privacy protection, not keychain-grade storage.

**Observability:** Vendetta logging, toasts, `/encrypt status`, `__goofcrypt.diag`, and optional Argon2 instrumentation expose non-secret health/timing state.

*Architecture analysis: 2026-07-18*
*Update when major patterns change*
