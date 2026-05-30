# Codebase Structure

**Analysis Date:** 2026-05-30

## Directory Layout

```
kettu-goofcrypt/
├── src/                    # All plugin source code (TypeScript)
│   ├── index.ts            # Plugin entry point (onLoad/onUnload/settings)
│   ├── manifest.ts         # Plugin ID and metadata constants
│   ├── settings.ts         # Typed settings proxy + password helpers
│   ├── selfTest.ts         # On-device regression checks (no Argon2)
│   ├── global.d.ts         # `vendetta` global type declaration
│   ├── core/               # Multi-password orchestration layer
│   │   ├── decrypt.ts      # Sync decrypt using cached keys only
│   │   ├── encrypt.ts      # Sync encrypt given a pre-derived key
│   │   ├── health.ts       # In-memory error counters
│   │   ├── keycache.ts     # Two-level key store (mem + persisted)
│   │   ├── payload.ts      # Binary frame/unframe (nonce + ct wire format)
│   │   └── stegcloak.ts    # Pure single-password pipeline (harness compat)
│   ├── crypto/             # Cryptographic primitives
│   │   ├── aead.ts         # XChaCha20-Poly1305 encrypt/decrypt
│   │   ├── argon.ts        # Argon2id key derivation (sync + async)
│   │   ├── deflate.ts      # Raw-DEFLATE compress/decompress + UTF-8
│   │   └── random.ts       # CSPRNG probe chain + getRandomBytes
│   ├── discord/            # Discord / Vendetta integration layer
│   │   ├── commands.ts     # /encrypt slash command
│   │   ├── flux.ts         # FluxDispatcher patch (inbound decrypt)
│   │   ├── metro.ts        # Lazy metro module resolution + toast
│   │   └── send.ts         # MessageActions patch (outbound encrypt)
│   ├── stego/              # Steganography
│   │   └── zwc.ts          # Zero-width-character encode/decode/embed
│   ├── ui/                 # React Native UI
│   │   └── Settings.tsx    # Plugin settings screen component
│   └── util/               # Shared utilities
│       └── base64.ts       # Uint8Array ↔ base64 (no Buffer/atob dependency)
├── tests/
│   └── harness.ts          # Byte-compat gate vs. stegcloak-rs WASM (Node)
├── tools/
│   └── derive-keys.mjs     # Desktop key-derivation tool (key-sync workflow)
├── scripts/
│   ├── build.mjs           # esbuild + swc pipeline → site/index.js
│   └── test.mjs            # Bundle harness + run under Node
├── site/                   # Build output (gitignored); Kettu installs from here
│   ├── index.js            # Built plugin bundle (ES5, expression form)
│   └── manifest.json       # Plugin manifest with SHA-256 hash
├── .github/
│   └── workflows/
│       └── ci.yml          # CI pipeline
├── package.json
├── tsconfig.json
└── README.md
```

## Directory Purposes

**`src/core/`:**
- Purpose: Business logic — multi-password, key-cached encrypt/decrypt; format framing; error telemetry
- Contains: Orchestration that sits above raw crypto primitives but below Discord-specific patches
- Key files: `src/core/keycache.ts` (most complex module), `src/core/decrypt.ts`, `src/core/encrypt.ts`

**`src/crypto/`:**
- Purpose: Cryptographic primitives — each file wraps one algorithm/concern
- Contains: Thin wrappers over `@noble/ciphers`, `@noble/hashes`, and `fflate`; no Discord or plugin logic
- Key files: `src/crypto/argon.ts` (defines KDF parameters), `src/crypto/aead.ts` (defines AEAD constants)

**`src/discord/`:**
- Purpose: All Vendetta API surface — patcher calls, metro module lookups, command registration
- Contains: Everything that touches `vendetta.*` directly (except `global.d.ts`)
- Key files: `src/discord/flux.ts` (inbound), `src/discord/send.ts` (outbound)

**`src/stego/`:**
- Purpose: Zero-width-character steganography port of stegcloak-rs
- Contains: A single file with pure string arithmetic; no external dependencies

**`src/ui/`:**
- Purpose: React Native settings screen; rendered via the plugin's `settings:` export
- Contains: Functional components using `vendetta.metro.common.React` and `ReactNative`

**`src/util/`:**
- Purpose: Shared helpers with zero runtime dependencies (Hermes-safe)
- Contains: `base64.ts` — no Buffer, no atob/btoa assumption

**`tests/`:**
- Purpose: Device-free byte-compatibility harness run in CI via Node
- Contains: `harness.ts` — cross-checks our pipeline against the real `stegcloak-rs` WASM in both directions

**`tools/`:**
- Purpose: Developer-only utilities run on desktop, not part of the plugin bundle
- Contains: `derive-keys.mjs` — pre-derives Argon2id keys on desktop for import to mobile (key-sync workflow)

**`scripts/`:**
- Purpose: Build and test runner scripts
- Contains: `build.mjs` (esbuild → swc pipeline), `test.mjs` (bundle + execute harness)

**`site/`:**
- Purpose: Build artefact directory; Kettu plugin manager fetches from here (GitHub Pages)
- Generated: Yes
- Committed: No (gitignored during development; deployed by CI)

## Key File Locations

**Entry Points:**
- `src/index.ts`: Plugin lifecycle — `onLoad`, `onUnload`, `settings` export
- `src/manifest.ts`: Plugin ID (`uk.digigrow.goofcrypt`) and display metadata

**Configuration:**
- `tsconfig.json`: TypeScript compiler config (ES2020 target, `jsx: "react"`, `jsxFactory: "React.createElement"`, no emit)
- `package.json`: Dependencies (`@noble/ciphers`, `@noble/hashes`, `fflate`) and build scripts
- `scripts/build.mjs`: Build pipeline config (esbuild options, swc ES5 lowering, validation guards)

**Core Logic:**
- `src/core/keycache.ts`: Key lifecycle — most central module; all derivation and persistence
- `src/core/decrypt.ts`: Sync decrypt entrypoint called from the Flux hot path
- `src/core/encrypt.ts`: Sync encrypt entrypoint called from the send patch
- `src/stego/zwc.ts`: Wire-format steganography; byte-exact with stegcloak-rs

**Testing:**
- `tests/harness.ts`: Integration / compatibility test — the only test file
- `scripts/test.mjs`: Test runner (esbuild-bundles the harness then executes under Node)

**Desktop Tools:**
- `tools/derive-keys.mjs`: Key-sync derivation tool; run with `npx tsx tools/derive-keys.mjs`

## Naming Conventions

**Files:**
- `camelCase.ts` for all TypeScript source files (e.g., `keycache.ts`, `deflate.ts`)
- `PascalCase.tsx` for React Native UI components (e.g., `Settings.tsx`)
- `camelCase.mjs` for build/tool scripts (e.g., `build.mjs`, `derive-keys.mjs`)
- `kebab-case` for script names that appear in `package.json`

**Directories:**
- Lowercase, single-word: `core/`, `crypto/`, `discord/`, `stego/`, `ui/`, `util/`

**Exported functions:**
- camelCase verbs: `encryptWithKey`, `decryptWithCachedKeys`, `deriveKeyAsync`, `getCachedKey`, `isCloaked`
- Boolean predicates prefixed with `is`/`can`: `isReady`, `isCloaked`, `isCached`, `canEnable`, `secureRngAvailable`
- Init functions: `init` prefix — `initSettings`, `initKeyCache`
- Patch/unpatch pairs: `patchFlux`/`unpatchFlux`, `patchSend`/`unpatchSend`
- Register/unregister pairs: `registerCommands`/`unregisterCommands`

**Exported classes/errors:**
- PascalCase, `Error` suffix: `MessageTooLongError`, `PayloadError`, `RngUnavailableError`, `DecryptionError`, `IntegrityError`

**Exported interfaces:**
- PascalCase: `Settings`, `KeyCacheStore`, `DecryptResult`

**Constants:**
- SCREAMING_SNAKE_CASE: `DISCORD_CONTENT_LIMIT`, `VERSION_1`, `NONCE_LENGTH`, `TAG_LENGTH`, `KEY_LENGTH`, `DEFAULTS`, `PLUGIN_ID`

## Where to Add New Code

**New crypto primitive (algorithm, codec):**
- Implementation: `src/crypto/<algorithm>.ts`
- Must be Hermes-safe (no TextEncoder/TextDecoder/Buffer unless polyfilled; no class syntax in built output)
- Export pure functions only; no module-level I/O

**New core operation (e.g., signing, format v2):**
- Implementation: `src/core/<operation>.ts`
- May import from `src/crypto/` and `src/stego/` but not from `src/discord/`
- Wire-format changes require updating `src/core/payload.ts` and adding harness test cases to `tests/harness.ts`

**New Discord command or subcommand:**
- Location: `src/discord/commands.ts` — add to the `execute` switch or add a new `options` entry
- Test manually via `/encrypt <action>` on device; no automated coverage for commands

**New Flux event handler:**
- Location: `src/discord/flux.ts` — add a `case` to the `handle()` switch
- The handler must remain synchronous; schedule any async work via fire-and-forget async IIFE

**New setting field:**
- Add to the `Settings` interface in `src/settings.ts`
- Add a default in `DEFAULTS` in `src/settings.ts`
- Add UI control to `src/ui/Settings.tsx`

**New utility (no external deps, Hermes-safe):**
- Location: `src/util/<name>.ts`

**New test case for stegcloak-rs compat:**
- Location: `tests/harness.ts` — add to `CASES` array for automatic cross-check in all 6 test sections

## Special Directories

**`site/` (build output):**
- Purpose: Contains `index.js` (the ES5 plugin bundle) and `manifest.json` with SHA-256 hash
- Generated: Yes — by `npm run build` (`scripts/build.mjs`)
- Committed: Only in CI/deployment; not tracked during development

**`tests/dist/` (test bundle):**
- Purpose: Temporary esbuild output of the harness (`tests/dist/harness.mjs`)
- Generated: Yes — by `npm test` (`scripts/test.mjs`)
- Committed: No

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents consumed by planning and execution agents
- Generated: Yes — by GSD map-codebase commands
- Committed: Yes

---

*Structure analysis: 2026-05-30*
