# Coding Conventions

**Analysis Date:** 2026-05-30

## Naming Patterns

**Files:**
- Lowercase camelCase for modules: `keycache.ts`, `stegcloak.ts`, `deflate.ts`, `base64.ts`
- PascalCase for React components: `Settings.tsx`
- Kebab-case does not appear; all filenames use camelCase or lowercase single words
- Test harness is lowercase: `harness.ts`

**Functions:**
- camelCase for all exported and internal functions: `deriveKey`, `getCachedKey`, `encryptWithKey`, `decryptWithCachedKeys`, `initKeyCache`, `orderPasswords`, `rememberWinner`
- Boolean-returning functions use is/has/can prefix: `isCloaked`, `isCached`, `isReady`, `secureRngAvailable`, `canEnable`, `isMarked`, `isWhitespace`
- Side-effect init functions use `init` prefix: `initSettings`, `initKeyCache`
- Cleanup/teardown functions use `clear` prefix: `clearMemory`
- Patch/unpatch pairs share prefix: `patchSend`/`unpatchSend`, `patchFlux`/`unpatchFlux`
- Register/unregister pairs: `registerCommands`/`unregisterCommands`

**Variables:**
- camelCase throughout; no Hungarian notation
- Module-level mutable singletons use short names: `store`, `mem`, `pending`, `winners`, `rngFn`, `dispose`, `unpatch`, `disposers`
- Constants use UPPER_SNAKE_CASE: `DISCORD_CONTENT_LIMIT`, `DEFAULTS`, `OPTS`, `ASYNC_OPTS`, `KEY_LENGTH`, `VERSION_1`, `NONCE_LENGTH`, `TAG_LENGTH`, `ZWC`, `IDX`, `CHARS`, `LOOKUP`, `CHANNEL`
- Intermediate variables in closures use short conventional names: `n`, `k`, `p`, `b`, `t`, `v`, `acc`, `out`

**Types and Interfaces:**
- PascalCase for interfaces and type aliases: `Settings`, `KeyCacheStore`, `DecryptResult`, `RandomBytes`, `Case`
- Error classes are PascalCase with `Error` suffix: `PayloadNotFoundError`, `DecryptionError`, `IntegrityError`, `MessageTooLongError`, `RngUnavailableError`, `PayloadError`
- `type` used for simple function-shaped aliases (`RandomBytes`), `interface` for object shapes (`Settings`, `KeyCacheStore`, `DecryptResult`)

**React Components (UI):**
- PascalCase for component functions: `Label`, `Input`, `Toggle`, `SettingsComponent`
- Props interfaces are inline (no separate named type): `props: { text: string; hint?: string }`

## Code Style

**Formatting:**
- 4-space indentation (consistent throughout all `.ts`/`.tsx` files)
- No trailing semicolons omitted — semicolons used everywhere
- Double quotes for import paths (enforced by TypeScript/esbuild)
- Template literals used for string interpolation
- No explicit `prettier` or `biome` config file found — style is enforced by convention and TypeScript compilation

**Linting:**
- No `.eslintrc` or `eslint.config.*` present — no automated lint step
- TypeScript `strict: true` in `tsconfig.json` is the primary static gate
- `noUnusedLocals: false` — unused locals are tolerated
- `skipLibCheck: true` — only the project's own files are strictly type-checked

## Import Organization

**Order (observed pattern):**
1. Node built-ins first when present (e.g. `import { webcrypto } from "node:crypto"` in test harness)
2. External npm packages (e.g. `@noble/hashes`, `@noble/ciphers`, `fflate`, `stegcloak-rs`)
3. Internal project modules — crypto layer first, then core, then util, then discord/ui
4. No barrel/index files; all imports are direct module-path imports

**Path style:**
- Relative paths only for internal imports: `"../crypto/argon"`, `"./keycache"`, `"../stego/zwc"`
- No path aliases (`@/`, `~`, etc.) — `tsconfig.json` has no `paths` mapping
- `node:` protocol prefix used for Node built-ins in scripts and test harness

**`import type` usage:**
- Used when importing only a type, not a value: `import type { RandomBytes } from "./stegcloak"`, `import type { KeyCacheStore } from "./core/keycache"`

## Error Handling

**Error taxonomy pattern:**
- Custom `Error` subclasses with `name` property set to the class name in the constructor
- Each error class lives in the module it belongs to (not a shared errors file)
- Error classes are exported from their declaring module: `PayloadNotFoundError`, `DecryptionError`, `IntegrityError` from `src/core/stegcloak.ts`; `MessageTooLongError` from `src/core/encrypt.ts`; `PayloadError` from `src/core/payload.ts`; `RngUnavailableError` from `src/crypto/random.ts`

**Typed error re-throws:**
- Catch-and-rethrow converts low-level errors into domain errors:
  ```typescript
  try {
      ({ nonce, ctAndTag } = unframe(payloadBytes));
  } catch (e) {
      if (e instanceof PayloadError) throw new IntegrityError(e.message);
      throw e;
  }
  ```

**Typed unknown cast:**
- Unknown `catch` parameters are cast inline: `(e as Error).message ?? String(e)` or `(e as Error)?.message`

**Empty catch for don't-care errors:**
- Used deliberately on hot-path teardown calls and vendetta API calls that can never be observed:
  ```typescript
  } catch {
      /* ignore */
  }
  ```
- Also used in `index.ts` for vendetta logger calls where logging failure must not block the plugin

**`noteError` for silent failure accounting:**
- Side-effect functions that swallow errors in dispatch-hook paths call `noteError(kind, e)` from `src/core/health.ts` instead of throwing, so counters accumulate and are visible via `/encrypt status`

**Null returns instead of throws on hot paths:**
- Functions called synchronously from a Flux dispatch hook (`decryptWithCachedKeys`, `getCachedKey`) return `null` on miss rather than throwing, because throwing inside a Flux hook has unpredictable side effects

## Logging

**Framework:**
- `vendetta.logger.log/error` for plugin-level structured logs
- `vendetta.ui.toasts.showToast` for user-visible feedback
- No `console.log` in `src/` — all user feedback goes through toasts
- `console.log`/`console.error` used only in `tests/harness.ts` for test output

**Toast helper:**
- `showToast` wrapper defined in `src/discord/metro.ts` silently swallows vendetta API failures; `src/ui/Settings.tsx` has its own local copy for the same reason

**Pattern:**
- Errors visible to the user are shown as toasts with a `"GoofCrypt: "` prefix
- Errors visible to developers are logged with `vendetta.logger.error`
- Silent errors in hot paths accumulate via `noteError` in `src/core/health.ts`

## Comments

**Module-level JSDoc blocks:**
- Every source file begins with a `/** ... */` block describing purpose, wire-format alignment, and any caveats
- These blocks are the primary documentation; no separate README per module
- Format: concise prose, no `@param`/`@returns` tags except in specific complex functions

**Inline comments:**
- Used liberally to explain protocol choices, format constraints, and non-obvious guard conditions
- Single-line `//` style; no block `/* */` for inline use
- Comments often reference the upstream Rust source (`stegcloak-rs src/encrypt.rs`) to explain byte-format requirements

**Security caveats:**
- Security limitations are documented inline in the relevant module (e.g. `src/core/keycache.ts` documents that persisted keys are plaintext JSON)

## Function Design

**Size:**
- Functions are short (typically 5–20 lines); no function exceeds ~30 lines
- Complex orchestration functions (`onLoad`, `execute`, `backgroundDecrypt`) remain readable through descriptive local variable names and comments

**Parameters:**
- Explicit typed parameters; no `options` objects used
- Boolean flags avoided in public APIs (prefer separate functions or caller control)
- `rng: RandomBytes` injected as a parameter in pure pipeline functions to keep them testable without side effects

**Return values:**
- Functions return `T | null` rather than throwing when a miss is expected (`getCachedKey`, `decryptWithCachedKeys`, `selfTest`)
- Async functions return `Promise<T>` explicitly; async/await used throughout (no raw `.then` chains except `finally` cleanup)

## Module Design

**Exports:**
- Named exports only; no barrel `index.ts` re-exports
- Only `src/index.ts` uses `export default` (the plugin entry object)
- Re-export used once: `export { isCloaked }` in `src/core/stegcloak.ts` to give consumers a single import point

**Module-level singletons:**
- Mutable state initialized lazily and exported only via accessor functions: `settings()`, `getCachedKey()`, `secureRngAvailable()`
- Raw singleton variables (`store`, `mem`, `rngFn`) are `let` at module scope, not exported

**`const` vs `let`:**
- `const` for all constants, imports, and computed values
- `let` only for module-level mutable state singletons or loop accumulators
- `as const` applied to literal objects that must not be widened: `OPTS`, `ASYNC_OPTS`

---

*Convention analysis: 2026-05-30*
