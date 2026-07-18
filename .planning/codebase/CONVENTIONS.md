# Coding Conventions

**Analysis Date:** 2026-07-18

## Naming Patterns

**Files:**
- Lowercase camelCase or lowercase single-word module names: `src/core/keycache.ts`, `src/crypto/argon.ts`, `src/stego/zwc.ts`.
- React components use PascalCase: `src/ui/Settings.tsx`.
- No dedicated test-file naming convention exists; the test suite is centralized in `tests/harness.ts`.

**Functions:**
- camelCase for functions, including async functions: `deriveKey`, `getCachedKey`, `decryptWithCachedKeys`.
- `is`/`has`/`can` prefixes identify boolean predicates: `isCloaked`, `isCached`, `secureRngAvailable`.
- `init`, `clear`, `patch`/`unpatch`, and `register`/`unregister` prefixes identify lifecycle pairs.

**Variables:**
- camelCase locals and parameters; short closure/loop names such as `n`, `p`, `b`, and `v` are used for small scopes.
- UPPER_SNAKE_CASE for protocol and configuration constants: `DISCORD_CONTENT_LIMIT`, `NONCE_LENGTH`, `TAG_LENGTH`.
- Module-level mutable singletons use `let` and concise names (`store`, `mem`, `pending`, `unpatch`); they are not exported directly.

**Types:**
- PascalCase interfaces and type aliases, without an `I` prefix: `Settings`, `KeyCacheStore`, `DecryptResult`.
- Custom errors use PascalCase with an `Error` suffix: `PayloadError`, `IntegrityError`, `RngUnavailableError`.

## Code Style

**Formatting:**
- Four-space indentation, double-quoted import paths, required semicolons, and trailing commas in multiline constructs.
- TypeScript source targets ES2020 for checking; `tsconfig.json` has `strict: true`, `noEmit: true`, and `moduleResolution: "Bundler"`.
- No formatter configuration was found; style is maintained by existing source conventions.

**Linting:**
- No ESLint/Prettier configuration or lint script exists.
- Static validation is primarily TypeScript checking configuration plus build-time esbuild/SWC guards in `scripts/build.mjs`.

## Import Organization

**Order:**
1. External packages such as `@noble/*` and `fflate`.
2. Relative internal modules.
3. `import type` is used when a dependency is type-only, for example in `src/core/encrypt.ts`.

**Grouping:**
- Imports are generally contiguous and grouped by dependency role; there is no enforced alphabetical sorter.

**Path Aliases:**
- None. Internal imports use relative paths only.

## Error Handling

**Patterns:**
- Domain failures throw custom errors at protocol boundaries; expected cache/decryption misses return `null` in hot-path APIs such as `getCachedKey` and `decryptWithCachedKeys`.
- Async work uses `async`/`await` and local `try`/`catch`; promise catches are used at fire-and-forget boundaries in Discord hooks.
- Host/plugin boundaries are defensive: `src/index.ts` wraps subsystem initialization in `safe()`, and patch teardown is best-effort.

**Error Types:**
- Invalid payloads, authentication failures, decompression failures, message limits, and RNG availability have distinct errors in `src/core/payload.ts`, `src/core/stegcloak.ts`, `src/core/encrypt.ts`, and `src/crypto/random.ts`.
- Hot dispatch hooks do not throw; failures are recorded through `noteError` in `src/core/health.ts` or logged at the boundary.

## Logging

**Framework:**
- Production/plugin diagnostics use host-injected `vendetta.logger.log` and `vendetta.logger.error`; user-visible feedback uses `vendetta.ui.toasts.showToast` through wrappers in `src/discord/metro.ts` and `src/ui/Settings.tsx`.
- `console` output is confined to `tests/harness.ts`.

**Patterns:**
- Logging is guarded with `try`/`catch` so host logger failures cannot break plugin execution.
- Messages use the `GoofCrypt:` prefix; diagnostic messages use `GoofCrypt[diag]`.
- Silent hot-path failures accumulate counters via `src/core/health.ts` and are surfaced by the command layer.

## Comments

**When to Comment:**
- Every source module starts with a purpose/protocol/caveat header. Comments explain wire-format compatibility, Hermes limitations, security tradeoffs, or non-obvious workarounds.
- Comments commonly cite the corresponding `stegcloak-rs` behavior and explain why a guard exists.

**JSDoc/TSDoc:**
- Concise module and function comments are used selectively; formal `@param`/`@returns` tags are uncommon and reserved for complex cases.

**TODO Comments:**
- No consistent TODO tracking convention was found; issue-specific phase/spike references appear in comments and build/test guards.

## Function Design

**Size:**
- Functions are generally short (roughly 5–30 lines), with orchestration kept readable through named helpers such as `backgroundDecrypt` and `safe`.

**Parameters:**
- Public APIs use explicit typed parameters rather than generic options objects; injected RNG parameters keep crypto pipelines testable.

**Return Values:**
- Expected misses return `T | null` or `undefined`; guard clauses are common. Async APIs explicitly return `Promise<T>`.

## Module Design

**Exports:**
- Named exports are the default. Only `src/index.ts` has the plugin's default export; it exposes lifecycle functions and the settings screen.
- State is encapsulated behind accessors and lifecycle functions rather than exporting mutable singletons.

**Barrel Files:**
- No barrel modules. The import graph is intentionally layered and avoids circular dependencies: Discord → core → crypto/stego/util.

---

*Convention analysis: 2026-07-18*
*Update when patterns change*
