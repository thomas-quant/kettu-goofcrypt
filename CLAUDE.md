<!-- GSD:project-start source:PROJECT.md -->
## Project

**GoofCrypt (mobile)**

GoofCrypt is a Kettu/Vendetta plugin for **Discord mobile** (Android/iOS, Hermes engine) that transparently encrypts outgoing messages and decrypts incoming ones, hiding the ciphertext inside zero-width characters so messages look like normal text. It is **byte-compatible with stegcloak-rs / GoofCord** (the desktop client), so a message encrypted on one client reads correctly on the other.

This milestone is about **speed**: the first-time-per-channel Argon2id key derivation currently freezes the UI for ~10 seconds. The goal is to run that *same* derivation at native (or near-native) speed — without breaking GoofCord compatibility.

**Core Value:** A message encrypted on GoofCord desktop must decrypt on GoofCrypt mobile and vice-versa — **byte-exact interop is non-negotiable**. Speed work must never sacrifice it. When speed and compatibility conflict, compatibility wins.

### Constraints

- **Tech stack**: Discord mobile / Hermes JS engine; Kettu (Vendetta-compatible) plugin loaded via `eval`. No native module install, no WASM, no `TextEncoder`/`Buffer`, no `class` syntax in built output.
- **Compatibility**: byte-exact interop with stegcloak-rs/GoofCord is a hard gate — the CI test harness must stay green.
- **Delivery**: fully static (GitHub Pages); no server, no database, no API keys.
- **Security**: encryption gated on secure RNG; pre-shared-password "casual privacy" model.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 — all plugin source under `src/` and tests under `tests/`
- JavaScript (ESM) — build scripts (`scripts/build.mjs`, `scripts/test.mjs`) and developer tool (`tools/derive-keys.mjs`)
## Runtime
- Target runtime: Discord for Android/iOS running the **Hermes** JavaScript engine (React Native)
- Development/test runtime: Node.js 24 (CI pinned); minimum Node 18 for tooling
- npm 11 (lockfile v3 present at `package-lock.json`)
- Lockfile: present (`package-lock.json`)
## Frameworks
- No framework — plain TypeScript modules. UI uses React/ReactNative accessed via `vendetta.metro.common.React` and `vendetta.metro.common.ReactNative` (host-injected globals, not bundled)
- Custom Node.js test runner — `scripts/test.mjs` esbuild-bundles `tests/harness.ts` with the `.wasm` asset loader, then runs the bundle under Node. No Jest/Vitest.
- esbuild 0.24.2 — bundles `src/index.ts` as an IIFE targeting ES2017 browser (`scripts/build.mjs`)
- @swc/core 1.15.40 — post-processes the esbuild bundle to ES5 so no `class` syntax survives into Hermes `eval`
- tsx 4.22.3 — TypeScript execution for the `tools/derive-keys.mjs` desktop key-derivation tool
- typescript 5.9.3 — type-checking only (`noEmit: true` in `tsconfig.json`)
## Key Dependencies
- `@noble/ciphers` 1.3.0 — XChaCha20-Poly1305 AEAD encryption (`src/crypto/aead.ts`); implements the wire-compatible cipher matching stegcloak-rs/GoofCord
- `@noble/hashes` 1.8.0 — Argon2id key derivation (`src/crypto/argon.ts`); pure JS, 64 MiB memory cost; also provides SHA-256 for password ID hashing (`src/core/keycache.ts`)
- `fflate` 0.8.3 — raw DEFLATE compression/decompression (`src/crypto/deflate.ts`); also supplies `strToU8`/`strFromU8` for UTF-8 encoding (replacing `TextEncoder` which is absent in Hermes)
- `stegcloak-rs` (github:Milkshiift/stegcloak-rs) — WASM reference implementation used only in the test harness (`tests/harness.ts`) to cross-check byte-for-byte compatibility; not shipped in the plugin bundle
- `@swc/core` 1.15.40 — ES5 transpilation step in `scripts/build.mjs`; critical for Hermes compatibility (`class` elimination, `iterableIsArray` assumption to eliminate iterator-protocol `for...of` lowering)
- `esbuild` 0.24.2 — bundler; applies a custom plugin (`noble-macrotask-yield`) to patch `@noble/hashes` `nextTick` from microtask to `setTimeout` so Argon2 derivation yields the UI thread
## Configuration
- `tsconfig.json`: `target: ES2020`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react`, `jsxFactory: React.createElement`, strict mode on, `noEmit: true`
- No path aliases configured
- `scripts/build.mjs` — esbuild → swc ES5 pipeline; output written to `site/index.js` and `site/manifest.json`
- Build validates output with two guards: `new Function()` parse check (Kettu eval compatibility) and regex checks blocking any surviving `class`/generator/`_iteratorNormalCompletion` syntax
- No `.env` files — the plugin has no server-side component and no API keys
- Settings persisted via `vendetta.plugin.storage` (Kettu's reactive proxy), keys stored as base64 JSON in the same storage object
## Platform Requirements
- Node.js >=18 (CI uses Node 24)
- npm (lockfile v3)
- `--experimental-wasm-stringref` flag required by `scripts/test.mjs` for the stegcloak-rs WASM module
- Deployed as a static GitHub Pages site (`site/` directory)
- Plugin installer URL points to `site/manifest.json`; Kettu fetches and evaluates `site/index.js`
- No server, no database, no API keys — fully static delivery
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Lowercase camelCase for modules: `keycache.ts`, `stegcloak.ts`, `deflate.ts`, `base64.ts`
- PascalCase for React components: `Settings.tsx`
- Kebab-case does not appear; all filenames use camelCase or lowercase single words
- Test harness is lowercase: `harness.ts`
- camelCase for all exported and internal functions: `deriveKey`, `getCachedKey`, `encryptWithKey`, `decryptWithCachedKeys`, `initKeyCache`, `orderPasswords`, `rememberWinner`
- Boolean-returning functions use is/has/can prefix: `isCloaked`, `isCached`, `isReady`, `secureRngAvailable`, `canEnable`, `isMarked`, `isWhitespace`
- Side-effect init functions use `init` prefix: `initSettings`, `initKeyCache`
- Cleanup/teardown functions use `clear` prefix: `clearMemory`
- Patch/unpatch pairs share prefix: `patchSend`/`unpatchSend`, `patchFlux`/`unpatchFlux`
- Register/unregister pairs: `registerCommands`/`unregisterCommands`
- camelCase throughout; no Hungarian notation
- Module-level mutable singletons use short names: `store`, `mem`, `pending`, `winners`, `rngFn`, `dispose`, `unpatch`, `disposers`
- Constants use UPPER_SNAKE_CASE: `DISCORD_CONTENT_LIMIT`, `DEFAULTS`, `OPTS`, `ASYNC_OPTS`, `KEY_LENGTH`, `VERSION_1`, `NONCE_LENGTH`, `TAG_LENGTH`, `ZWC`, `IDX`, `CHARS`, `LOOKUP`, `CHANNEL`
- Intermediate variables in closures use short conventional names: `n`, `k`, `p`, `b`, `t`, `v`, `acc`, `out`
- PascalCase for interfaces and type aliases: `Settings`, `KeyCacheStore`, `DecryptResult`, `RandomBytes`, `Case`
- Error classes are PascalCase with `Error` suffix: `PayloadNotFoundError`, `DecryptionError`, `IntegrityError`, `MessageTooLongError`, `RngUnavailableError`, `PayloadError`
- `type` used for simple function-shaped aliases (`RandomBytes`), `interface` for object shapes (`Settings`, `KeyCacheStore`, `DecryptResult`)
- PascalCase for component functions: `Label`, `Input`, `Toggle`, `SettingsComponent`
- Props interfaces are inline (no separate named type): `props: { text: string; hint?: string }`
## Code Style
- 4-space indentation (consistent throughout all `.ts`/`.tsx` files)
- No trailing semicolons omitted — semicolons used everywhere
- Double quotes for import paths (enforced by TypeScript/esbuild)
- Template literals used for string interpolation
- No explicit `prettier` or `biome` config file found — style is enforced by convention and TypeScript compilation
- No `.eslintrc` or `eslint.config.*` present — no automated lint step
- TypeScript `strict: true` in `tsconfig.json` is the primary static gate
- `noUnusedLocals: false` — unused locals are tolerated
- `skipLibCheck: true` — only the project's own files are strictly type-checked
## Import Organization
- Relative paths only for internal imports: `"../crypto/argon"`, `"./keycache"`, `"../stego/zwc"`
- No path aliases (`@/`, `~`, etc.) — `tsconfig.json` has no `paths` mapping
- `node:` protocol prefix used for Node built-ins in scripts and test harness
- Used when importing only a type, not a value: `import type { RandomBytes } from "./stegcloak"`, `import type { KeyCacheStore } from "./core/keycache"`
## Error Handling
- Custom `Error` subclasses with `name` property set to the class name in the constructor
- Each error class lives in the module it belongs to (not a shared errors file)
- Error classes are exported from their declaring module: `PayloadNotFoundError`, `DecryptionError`, `IntegrityError` from `src/core/stegcloak.ts`; `MessageTooLongError` from `src/core/encrypt.ts`; `PayloadError` from `src/core/payload.ts`; `RngUnavailableError` from `src/crypto/random.ts`
- Catch-and-rethrow converts low-level errors into domain errors:
- Unknown `catch` parameters are cast inline: `(e as Error).message ?? String(e)` or `(e as Error)?.message`
- Used deliberately on hot-path teardown calls and vendetta API calls that can never be observed:
- Also used in `index.ts` for vendetta logger calls where logging failure must not block the plugin
- Side-effect functions that swallow errors in dispatch-hook paths call `noteError(kind, e)` from `src/core/health.ts` instead of throwing, so counters accumulate and are visible via `/encrypt status`
- Functions called synchronously from a Flux dispatch hook (`decryptWithCachedKeys`, `getCachedKey`) return `null` on miss rather than throwing, because throwing inside a Flux hook has unpredictable side effects
## Logging
- `vendetta.logger.log/error` for plugin-level structured logs
- `vendetta.ui.toasts.showToast` for user-visible feedback
- No `console.log` in `src/` — all user feedback goes through toasts
- `console.log`/`console.error` used only in `tests/harness.ts` for test output
- `showToast` wrapper defined in `src/discord/metro.ts` silently swallows vendetta API failures; `src/ui/Settings.tsx` has its own local copy for the same reason
- Errors visible to the user are shown as toasts with a `"GoofCrypt: "` prefix
- Errors visible to developers are logged with `vendetta.logger.error`
- Silent errors in hot paths accumulate via `noteError` in `src/core/health.ts`
## Comments
- Every source file begins with a `/** ... */` block describing purpose, wire-format alignment, and any caveats
- These blocks are the primary documentation; no separate README per module
- Format: concise prose, no `@param`/`@returns` tags except in specific complex functions
- Used liberally to explain protocol choices, format constraints, and non-obvious guard conditions
- Single-line `//` style; no block `/* */` for inline use
- Comments often reference the upstream Rust source (`stegcloak-rs src/encrypt.rs`) to explain byte-format requirements
- Security limitations are documented inline in the relevant module (e.g. `src/core/keycache.ts` documents that persisted keys are plaintext JSON)
## Function Design
- Functions are short (typically 5–20 lines); no function exceeds ~30 lines
- Complex orchestration functions (`onLoad`, `execute`, `backgroundDecrypt`) remain readable through descriptive local variable names and comments
- Explicit typed parameters; no `options` objects used
- Boolean flags avoided in public APIs (prefer separate functions or caller control)
- `rng: RandomBytes` injected as a parameter in pure pipeline functions to keep them testable without side effects
- Functions return `T | null` rather than throwing when a miss is expected (`getCachedKey`, `decryptWithCachedKeys`, `selfTest`)
- Async functions return `Promise<T>` explicitly; async/await used throughout (no raw `.then` chains except `finally` cleanup)
## Module Design
- Named exports only; no barrel `index.ts` re-exports
- Only `src/index.ts` uses `export default` (the plugin entry object)
- Re-export used once: `export { isCloaked }` in `src/core/stegcloak.ts` to give consumers a single import point
- Mutable state initialized lazily and exported only via accessor functions: `settings()`, `getCachedKey()`, `secureRngAvailable()`
- Raw singleton variables (`store`, `mem`, `rngFn`) are `let` at module scope, not exported
- `const` for all constants, imports, and computed values
- `let` only for module-level mutable state singletons or loop accumulators
- `as const` applied to literal objects that must not be widened: `OPTS`, `ASYNC_OPTS`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| Plugin entry | Lifecycle (onLoad/onUnload), safe-subsystem init, debug hook | `src/index.ts` |
| Settings | Typed settings proxy, password list parsing, chosen-password selection | `src/settings.ts` |
| Flux hook | Inbound message intercept, sync decrypt, async key-derive-and-redispatch | `src/discord/flux.ts` |
| Send patch | Outbound message intercept, encrypt-or-reject pattern | `src/discord/send.ts` |
| Commands | `/encrypt` slash command: toggle, cycle, status, bench, set, import | `src/discord/commands.ts` |
| Metro | Lazy-resolved vendetta metro module references, toast helper | `src/discord/metro.ts` |
| Key cache | Two-level key store (in-memory Map + persisted base64), async derive, winner hint | `src/core/keycache.ts` |
| Decrypt (core) | Sync decryption using cached keys only; never derives | `src/core/decrypt.ts` |
| Encrypt (core) | Synchronous encryption given an already-derived key | `src/core/encrypt.ts` |
| Payload | Binary framing: `[0x01][24B nonce][ct+tag]` — matches stegcloak-rs wire format | `src/core/payload.ts` |
| StegCloak compat | Pure single-password pipeline mirroring stegcloak-rs; used by test harness | `src/core/stegcloak.ts` |
| Health | Lightweight in-memory error counters surfaced by `/encrypt status` | `src/core/health.ts` |
| AEAD | XChaCha20-Poly1305 via @noble/ciphers; AAD = version byte | `src/crypto/aead.ts` |
| Argon2 KDF | Argon2id(m=64MiB,t=3,p=1) via @noble/hashes; sync + async variants | `src/crypto/argon.ts` |
| Deflate | Raw-DEFLATE compress/decompress + UTF-8 encode/decode via fflate | `src/crypto/deflate.ts` |
| Random | CSPRNG probe chain (Web Crypto → Metro → Math.random fallback) | `src/crypto/random.ts` |
| ZWC stego | Base-8 zero-width-character encode/decode; cover-whitespace distribution | `src/stego/zwc.ts` |
| Base64 | Dependency-free Uint8Array↔base64 (no Buffer/atob/btoa assumption) | `src/util/base64.ts` |
| UI | React Native settings screen: passwords, cover, mark, key import | `src/ui/Settings.tsx` |
| Self-test | On-load Hermes regression checks (no Argon2; tests iterator/stego/base64) | `src/selfTest.ts` |
## Pattern Overview
- All subsystems are isolated inside a `safe()` wrapper in `onLoad`; one failure cannot prevent the others from initialising
- The critical path for decryption (flux hook) is always synchronous and uses only already-cached keys; it never blocks the Hermes event loop
- Expensive work (Argon2id key derivation) is always deferred to an async background task and performed at most once per `(channelId, password)` pair
- The encryption algorithm is byte-compatible with stegcloak-rs (the Rust/WASM lib GoofCord desktop ships); interop is enforced by the CI test harness
## Layers
- Purpose: Intercept Discord's internal send/receive mechanisms via vendetta patcher
- Location: `src/discord/`
- Contains: Flux patch, send patch, slash command, metro module resolution
- Depends on: core layer, settings, crypto/random
- Used by: plugin entry point (`src/index.ts`)
- Purpose: Multi-password, key-caching encrypt/decrypt logic; no UI or Discord specifics
- Location: `src/core/`
- Contains: decrypt.ts, encrypt.ts, keycache.ts, payload.ts, stegcloak.ts, health.ts
- Depends on: crypto layer, stego layer, util/base64
- Used by: discord layer, selfTest.ts, test harness
- Purpose: Primitive implementations — AEAD cipher, KDF, compression, randomness
- Location: `src/crypto/`
- Contains: aead.ts (XChaCha20-Poly1305), argon.ts (Argon2id), deflate.ts (raw-DEFLATE), random.ts (CSPRNG probe)
- Depends on: `@noble/ciphers`, `@noble/hashes`, `fflate`
- Used by: core layer
- Purpose: Zero-width-character hiding/extraction; port of stegcloak-rs message.rs
- Location: `src/stego/`
- Contains: zwc.ts
- Depends on: nothing (pure string arithmetic)
- Used by: core layer
- Purpose: Typed proxy over `vendetta.plugin.storage`; password list utilities
- Location: `src/settings.ts`
- Contains: Settings interface, defaults, password parse/cycle/mask helpers
- Depends on: `src/core/keycache` (KeyCacheStore extends into Settings)
- Used by: all layers (settings is a singleton accessor)
- Purpose: React Native settings screen registered as the plugin's `settings` export
- Location: `src/ui/Settings.tsx`
- Contains: SettingsComponent (passwords, cover, mark fields, key-import field)
- Depends on: settings, crypto/random, core/keycache, util/base64, crypto/deflate
- Used by: `src/index.ts` (registered as `settings:` in the plugin export)
## Data Flow
### Outgoing Message (Encrypt)
### Incoming Message (Decrypt)
### Key Derivation (async, one-time per channel+password)
### Key Sync (desktop → mobile, skip Argon2)
- All persistent state lives in `vendetta.plugin.storage` (a reactive JSON proxy), accessed via the typed `Settings` wrapper in `src/settings.ts`
- In-memory volatile state: key Map (`mem`), pending derivation Map (`pending`), winner hint Map (`winners`), decryptedIds Set, deriving Set — all module-level singletons cleared in `onUnload`
## Key Abstractions
- Purpose: Avoid repeating the expensive 64MiB Argon2id derivation per message
- Files: `src/core/keycache.ts`
- Pattern: mem Map (hot path) backed by `plugin.storage.keys` (persisted base64); `passwordId()` hashes passwords to stable identifiers safe for storage
- Purpose: Byte-exact interoperability with the GoofCord desktop Rust implementation
- Files: `src/core/payload.ts`, `src/stego/zwc.ts`, `src/crypto/aead.ts`, `src/crypto/argon.ts`, `src/crypto/deflate.ts`
- Pattern: Each primitive is a direct port of the corresponding stegcloak-rs source; test harness cross-checks both directions
- Purpose: Keep the synchronous Flux dispatch hook non-blocking while still deriving keys on demand
- Files: `src/discord/flux.ts`, `src/core/decrypt.ts`, `src/core/keycache.ts`
- Pattern: Hot path uses only `getCachedKey` (sync, returns null on miss); cold path fires background async derivation then re-dispatches
## Entry Points
- Location: `src/index.ts` — `export default { onLoad, onUnload, settings }`
- Triggers: Kettu evaluates the bundle and calls `onLoad()` on plugin activation
- Responsibilities: Detect RNG, init settings, init key cache, run self-test, patch Flux, patch send, register commands, expose `__goofcrypt` debug hook
- Location: `src/index.ts` — `onUnload()`
- Triggers: Plugin deactivation
- Responsibilities: Unpatch send, unpatch Flux, unregister commands, clear in-memory key/winner state
- Location: `src/index.ts` — `settings: SettingsScreen` / `src/ui/Settings.tsx`
- Triggers: User opens plugin settings in Kettu
- Responsibilities: Render password/cover/mark fields, key import field, insecure-RNG toggle
## Architectural Constraints
- **Threading:** Hermes is single-threaded. All Flux/send patches are synchronous (no blocking I/O). Argon2id is deferred via `argon2idAsync` with `asyncTick:50ms` to yield macrotasks to the render loop.
- **Global state:** Module-level singletons in `src/core/keycache.ts` (`mem`, `pending`, `winners`), `src/discord/flux.ts` (`deriving`, `decryptedIds`), `src/discord/send.ts` (`disposers`), `src/discord/commands.ts` (`dispose`), `src/crypto/random.ts` (`rngFn`, `secure`), `src/settings.ts` (`store`). All are reset on `onUnload`.
- **No TextEncoder/TextDecoder:** Hermes does not guarantee these globals. All UTF-8 and base64 handling uses fflate's `strToU8/strFromU8` and the hand-rolled `src/util/base64.ts`.
- **No `class` syntax in output:** Hermes `eval` rejects class syntax at parse time. The build pipeline down-levels to ES5 via swc with `iterableIsArray:true` to avoid iterator-protocol for...of lowering (which drops the first element under Discord's Hermes).
- **No circular imports:** Import graph is strictly layered: `discord` → `core` → `crypto/stego/util`.
- **Encryption gated on secure RNG:** The send patch only encrypts if `secureRngAvailable()` is true (or `allowInsecureRng` is explicitly opted in). Decryption is never gated.
## Anti-Patterns
### Calling `deriveKey` (sync) on the hot path
### Accessing `vendetta.plugin.storage` directly
## Error Handling
- `safe(label, fn)` in `onLoad` (`src/index.ts:29`) — wraps each subsystem init so one failure cannot cascade
- `try { unpatch() } catch {}` pattern on all dispose/unpatch calls — unpatching on unload is best-effort
- `noteError(kind, e)` (`src/core/health.ts:12`) — increments counters for silent failures visible via `/encrypt status`
- `getCachedKey` returns `null` on miss (never throws) — lets the Flux hook proceed without try/catch on every message
- `aeadDecrypt` throws on authentication failure — intentional, used as the wrong-password signal in `src/core/decrypt.ts:36`
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
