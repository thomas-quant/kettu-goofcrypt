# Technology Stack

**Analysis Date:** 2026-05-30

## Languages

**Primary:**
- TypeScript 5.9.3 — all plugin source under `src/` and tests under `tests/`

**Secondary:**
- JavaScript (ESM) — build scripts (`scripts/build.mjs`, `scripts/test.mjs`) and developer tool (`tools/derive-keys.mjs`)

## Runtime

**Environment:**
- Target runtime: Discord for Android/iOS running the **Hermes** JavaScript engine (React Native)
  - Hermes constraints: no `class` syntax in `eval`, no `TextEncoder`/`TextDecoder`, no guaranteed `crypto.getRandomValues`, no `Buffer`
  - Bundle is evaluated by the **Kettu** (Vendetta-compatible) plugin loader as a single expression: `vendetta => { return <bundle> }`
- Development/test runtime: Node.js 24 (CI pinned); minimum Node 18 for tooling

**Package Manager:**
- npm 11 (lockfile v3 present at `package-lock.json`)
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- No framework — plain TypeScript modules. UI uses React/ReactNative accessed via `vendetta.metro.common.React` and `vendetta.metro.common.ReactNative` (host-injected globals, not bundled)

**Testing:**
- Custom Node.js test runner — `scripts/test.mjs` esbuild-bundles `tests/harness.ts` with the `.wasm` asset loader, then runs the bundle under Node. No Jest/Vitest.

**Build/Dev:**
- esbuild 0.24.2 — bundles `src/index.ts` as an IIFE targeting ES2017 browser (`scripts/build.mjs`)
- @swc/core 1.15.40 — post-processes the esbuild bundle to ES5 so no `class` syntax survives into Hermes `eval`
- tsx 4.22.3 — TypeScript execution for the `tools/derive-keys.mjs` desktop key-derivation tool
- typescript 5.9.3 — type-checking only (`noEmit: true` in `tsconfig.json`)

## Key Dependencies

**Critical:**
- `@noble/ciphers` 1.3.0 — XChaCha20-Poly1305 AEAD encryption (`src/crypto/aead.ts`); implements the wire-compatible cipher matching stegcloak-rs/GoofCord
- `@noble/hashes` 1.8.0 — Argon2id key derivation (`src/crypto/argon.ts`); pure JS, 64 MiB memory cost; also provides SHA-256 for password ID hashing (`src/core/keycache.ts`)
- `fflate` 0.8.3 — raw DEFLATE compression/decompression (`src/crypto/deflate.ts`); also supplies `strToU8`/`strFromU8` for UTF-8 encoding (replacing `TextEncoder` which is absent in Hermes)

**Dev/Infrastructure:**
- `stegcloak-rs` (github:Milkshiift/stegcloak-rs) — WASM reference implementation used only in the test harness (`tests/harness.ts`) to cross-check byte-for-byte compatibility; not shipped in the plugin bundle
- `@swc/core` 1.15.40 — ES5 transpilation step in `scripts/build.mjs`; critical for Hermes compatibility (`class` elimination, `iterableIsArray` assumption to eliminate iterator-protocol `for...of` lowering)
- `esbuild` 0.24.2 — bundler; applies a custom plugin (`noble-macrotask-yield`) to patch `@noble/hashes` `nextTick` from microtask to `setTimeout` so Argon2 derivation yields the UI thread

## Configuration

**TypeScript:**
- `tsconfig.json`: `target: ES2020`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react`, `jsxFactory: React.createElement`, strict mode on, `noEmit: true`
- No path aliases configured

**Build:**
- `scripts/build.mjs` — esbuild → swc ES5 pipeline; output written to `site/index.js` and `site/manifest.json`
- Build validates output with two guards: `new Function()` parse check (Kettu eval compatibility) and regex checks blocking any surviving `class`/generator/`_iteratorNormalCompletion` syntax

**Environment:**
- No `.env` files — the plugin has no server-side component and no API keys
- Settings persisted via `vendetta.plugin.storage` (Kettu's reactive proxy), keys stored as base64 JSON in the same storage object

## Platform Requirements

**Development:**
- Node.js >=18 (CI uses Node 24)
- npm (lockfile v3)
- `--experimental-wasm-stringref` flag required by `scripts/test.mjs` for the stegcloak-rs WASM module

**Production:**
- Deployed as a static GitHub Pages site (`site/` directory)
- Plugin installer URL points to `site/manifest.json`; Kettu fetches and evaluates `site/index.js`
- No server, no database, no API keys — fully static delivery

---

*Stack analysis: 2026-05-30*
