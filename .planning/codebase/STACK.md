# Technology Stack

**Analysis Date:** 2026-07-18

## Languages

**Primary:**
- TypeScript 5.9.x - Plugin source under `src/` and compatibility tests under `tests/`; strict type-checking is configured in `tsconfig.json`.

**Secondary:**
- JavaScript/ECMAScript modules - Build and test scripts in `scripts/`, plus the desktop key tool in `tools/`.
- JSX/TSX - React Native settings UI in `src/ui/Settings.tsx`.

## Runtime

**Environment:**
- Discord mobile on Android/iOS using the Hermes JavaScript engine - Production plugin runtime; Kettu/Vendetta evaluates the generated bundle.
- Node.js 24 in CI, Node.js 18+ for local tooling - Build, test, and key-derivation tooling.
- Browser-compatible bundled output - `scripts/build.mjs` targets ES2017 before ES5 lowering; no server runtime.

**Package Manager:**
- npm 11.x - Dependency installation and package scripts.
- Lockfile: `package-lock.json` present (lockfile v3).

## Frameworks

**Core:**
- Kettu/Vendetta plugin APIs - Host lifecycle, storage, patching, Metro lookup, commands, UI, logging, and toasts; injected by Discord mobile rather than bundled.
- React/React Native host components - Settings screen, accessed through `vendetta.metro.common`.

**Testing:**
- Custom Node.js harness - `scripts/test.mjs` bundles `tests/harness.ts` and runs it; no Jest/Vitest framework.
- `stegcloak-rs` WASM reference - Test-only oracle for byte-exact cross-compatibility.

**Build/Dev:**
- esbuild 0.24.x - Bundles `src/index.ts` into an IIFE and bundles the test harness; also loads the reference `.wasm` asset in tests.
- SWC `@swc/core` 1.15.x - Converts the plugin bundle to ES5 for Hermes parsing.
- TypeScript 5.9.x - Type-checking only (`noEmit: true`).
- tsx 4.22.x - Runs `tools/derive-keys.mjs` with TypeScript imports.

## Key Dependencies

**Critical:**
- `@noble/hashes` 1.8.x - Pure-JavaScript Argon2id and SHA-256; Argon2id uses GoofCord-compatible 64 MiB / 3-pass / parallelism-1 parameters.
- `@noble/ciphers` 1.3.x - XChaCha20-Poly1305 AEAD used by the wire format.
- `fflate` 0.8.x - Raw DEFLATE and UTF-8 conversion without relying on Hermes `TextEncoder`/`Buffer`.
- `stegcloak-rs` GitHub dependency - WASM compatibility reference, never shipped in the mobile plugin.

**Infrastructure:**
- Node.js built-ins (`node:fs/promises`, `node:crypto`, `node:path`, `node:url`) - Build, hashing, filesystem, and test-runner support.

## Configuration

**Environment:**
- No environment variables or `.env` configuration are required by the application; plugin settings and cached keys are held in `vendetta.plugin.storage`.
- Production installation metadata is generated in `site/manifest.json`; the generated bundle is `site/index.js`.

**Build:**
- `tsconfig.json` - ES2020 TypeScript checking, bundler resolution, React JSX, strict mode, and no emit.
- `scripts/build.mjs` - esbuild bundle, noble macrotask-yield patch, sync-derive import-graph guard, SWC ES5 lowering, Hermes syntax guards, eval-expression validation, and Pages manifest generation.
- `scripts/test.mjs` - esbuild test bundling with `.wasm` file loading, then Node execution with `--experimental-wasm-stringref`.
- `package.json` - `build`, `test`, and `derive` workflows and dependency declarations.

## Platform Requirements

**Development:**
- Node.js 18+ and npm; CI runs Node.js 24.
- `npm test` requires Node's `--experimental-wasm-stringref` support for the `stegcloak-rs` WASM test dependency.
- A Discord mobile/Kettu installation is required for device behavior, Vendetta APIs, Hermes parsing, and React Native integration checks.

**Production:**
- Static GitHub Pages hosting publishes `site/manifest.json` and `site/index.js`.
- Kettu installs the manifest URL and evaluates the generated single-expression plugin bundle inside Discord mobile; no backend, database, or API keys are used.

---

*Stack analysis: 2026-07-18*
*Update after major dependency changes*
