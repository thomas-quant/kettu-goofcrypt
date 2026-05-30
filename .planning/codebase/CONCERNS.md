# Codebase Concerns

**Analysis Date:** 2026-05-30

## Tech Debt

**`decryptedIds` set is never pruned:**
- Issue: `decryptedIds` in `src/discord/flux.ts` (line 18) is a module-level `Set<string>` that accumulates every decrypted message ID across the session. There is no eviction, size cap, or clear on `unpatchFlux`. Over a long session with thousands of messages the set grows without bound.
- Files: `src/discord/flux.ts`
- Impact: Memory pressure on mobile. `clearMemory()` in `src/core/keycache.ts` is called on `onUnload` but does not touch `decryptedIds`. Plugin reload leaves the set populated since the variable is module-scoped.
- Fix approach: Add `decryptedIds.clear()` inside `unpatchFlux()`, or use a bounded LRU / weak-reference approach for IDs older than N messages.

**`deriving` set guard is per-message not per-channel:**
- Issue: `backgroundDecrypt` in `src/discord/flux.ts` (line 17–46) guards duplicate work with a `deriving` Set keyed by message ID. When `LOAD_MESSAGES_SUCCESS` delivers a batch of N cloaked messages from the same channel, each has a unique ID and each passes the `deriving.has(id)` check. `deriveKey` in `src/core/keycache.ts` deduplicates concurrent Argon2 calls via the `pending` Map, so actual Argon2 work is not duplicated, but N separate `backgroundDecrypt` IIFE coroutines are still launched and N separate `MESSAGE_UPDATE` re-dispatches will fire after derivation completes — one per original message.
- Files: `src/discord/flux.ts`, `src/core/keycache.ts`
- Impact: On initial channel open with many cloaked messages the Flux dispatcher gets flooded with `MESSAGE_UPDATE` events simultaneously, which could cause visible stuttering or flicker.
- Fix approach: Guard `backgroundDecrypt` by `channelId` rather than `messageId`, or batch re-dispatch once derivation completes for all pending messages in that channel.

**`noUnusedLocals: false` in tsconfig:**
- Issue: `tsconfig.json` sets `"noUnusedLocals": false`, meaning dead code and unused imports accumulate silently.
- Files: `tsconfig.json`
- Impact: Low — current codebase is small and clean. Sets a permissive precedent.
- Fix approach: Enable `noUnusedLocals: true` and fix any resulting warnings.

**No `tsc` type-check step in CI or build:**
- Issue: `scripts/build.mjs` uses esbuild which transpiles without type checking. `scripts/test.mjs` bundles with esbuild too. The CI workflow (`.github/workflows/ci.yml`) runs only `npm test` and `npm run build` — neither invokes `tsc`. TypeScript errors are only caught locally via editor tooling.
- Files: `package.json`, `.github/workflows/ci.yml`, `scripts/build.mjs`
- Impact: Type regressions can ship to production undetected. The `strict: true` in tsconfig has no enforcement path.
- Fix approach: Add a `"typecheck": "tsc --noEmit"` script and add it as a CI step before build.

**Diagnose files committed to repository root:**
- Issue: `diagnose.txt`, `diagnose2.txt`, `diagnose3.txt` are checked in to the repository root. They contain raw Discord `eval` snippets used during development, including one that previously exposed a `storageRef` (see `diagnose3.txt` contents referencing `g.storageRef`).
- Files: `diagnose.txt`, `diagnose2.txt`, `diagnose3.txt`
- Impact: Leaks internal debugging surface and historical API shape. Not a security risk by themselves, but adds noise and reveals implementation details.
- Fix approach: Delete all three files and add `diagnose*.txt` to `.gitignore`.

**Duplicate `showToast` implementations:**
- Issue: `showToast` is implemented twice: once in `src/discord/metro.ts` (exported) and again as a local copy in `src/ui/Settings.tsx` (lines 16–22). The Settings copy does not log to `vendetta.logger` as a fallback.
- Files: `src/discord/metro.ts`, `src/ui/Settings.tsx`
- Impact: Bug divergence — if the toast API changes, one copy may be fixed and the other not.
- Fix approach: Import `showToast` from `src/discord/metro.ts` in `Settings.tsx`.

---

## Security Considerations

**Passwords stored in plaintext in Vendetta plugin storage:**
- Risk: `settings().passwords` is a raw comma-separated string stored in Kettu's reactive storage, which is plaintext JSON on-device. There is no keychain, secure enclave, or OS-level secret storage. This is acknowledged in `src/core/keycache.ts` (line 13–14) but is an inherent limitation, not a mitigated risk.
- Files: `src/settings.ts`, `src/core/keycache.ts`
- Current mitigation: Passwords are described as "pre-shared, casual privacy" — the security model is explicit. Derived keys have the same exposure.
- Recommendations: Document clearly in README that passwords are not protected by a PIN or device lock. For higher-threat use cases, advise against persistent storage of passwords.

**Password input field is not masked (`secureTextEntry` absent):**
- Risk: The `Input` component in `src/ui/Settings.tsx` renders a plain `RN.TextInput` without `secureTextEntry={true}`. When users type or paste passwords in the settings UI, the text is visible on screen (shoulder-surfing risk) and may appear in keyboard autocomplete suggestions.
- Files: `src/ui/Settings.tsx` (line 33–51)
- Current mitigation: None.
- Recommendations: Add `secureTextEntry={true}` to the password `Input` field. The cover and mark fields should remain plain text.

**Key bundle import has no shape validation beyond `JSON.parse`:**
- Risk: `importKeys` in `src/core/keycache.ts` (lines 51–64) iterates `Object.keys(keysObj)` and writes every value directly into `store.keys` without checking that values are valid base64 strings, that channel IDs are snowflake-shaped, or that the passwordId keys are 22-char base64. A malformed bundle silently writes garbage keys, which could cause decrypt failures on legitimate messages that looked up a poisoned slot.
- Files: `src/core/keycache.ts`, `src/discord/commands.ts` (line 81–82), `src/ui/Settings.tsx` (lines 89–90)
- Current mitigation: The outer `try/catch` in callers catches JSON parse errors. Post-parse structural errors are silent.
- Recommendations: Validate that each value in an imported bundle matches a 43-44 char base64 pattern before writing, and that the outer shape has string→object→string nesting.

**`__goofcrypt` global debug hook persists after `onUnload`:**
- Risk: `(globalThis as any).__goofcrypt` is set during `onLoad` (`src/index.ts` lines 56–65) but never deleted in `onUnload`. After the plugin is disabled, the hook remains on `globalThis` and is accessible to any other Discord eval snippet or plugin. The hook exposes `selfTest` (a full crypto round-trip function) and `diag()` (plugin internals).
- Files: `src/index.ts`
- Current mitigation: The hook intentionally excludes raw passwords and the storage reference. `diag()` returns only counts.
- Recommendations: Add `delete (globalThis as any).__goofcrypt;` to `onUnload`.

**`allowInsecureRng` path uses `Math.random` for XChaCha nonces:**
- Risk: If a user enables "Allow insecure RNG", nonces are generated with `Math.random` (`src/crypto/random.ts` lines 104–107). `Math.random` is not a CSPRNG; on some JS engines the output is predictable given a few samples. This would allow a passive observer (with access to ciphertexts) to brute-force the nonce space and recover plaintext.
- Files: `src/crypto/random.ts`, `src/discord/send.ts` (line 22)
- Current mitigation: The option is off by default and labelled "weaker" in the UI. A toast warns on load if it triggers the disable branch.
- Recommendations: The current warning in settings is minimal. Add a stronger warning (modal-style, not just hint text) when the user tries to enable this toggle.

---

## Performance Bottlenecks

**LOAD_MESSAGES_SUCCESS launches one backgroundDecrypt coroutine per cloaked message:**
- Problem: When switching to a channel with 50 cloaked messages and a cold key cache, `patchFlux` launches 50 independent async coroutines, each awaiting `deriveKey` for each password. `deriveKey` correctly deduplicates concurrent Argon2 calls via the `pending` Map, so Argon2 only runs once per (channel, password) pair. However, 50 simultaneous coroutines still contend, and on completion all 50 fire `FluxDispatcher().dispatch()` with `MESSAGE_UPDATE` within the same microtask drain, potentially causing 50 consecutive React re-renders.
- Files: `src/discord/flux.ts` (lines 40–72), `src/core/keycache.ts`
- Cause: Deduplication operates at the Argon2 level but not at the re-dispatch level.
- Improvement path: After derivation completes, batch the pending messages and issue a single `LOAD_MESSAGES_SUCCESS`-style bulk re-dispatch rather than N individual `MESSAGE_UPDATE` events.

**Argon2 takes ~10s on-device (by design, 64 MiB, 3 iterations):**
- Problem: First send or decrypt to any channel without an imported key triggers a ~10s blocking-equivalent derivation. The async path (`deriveKeyAsync` with `asyncTick: 50`) is used to keep the UI responsive, but the total wall time is still ~10s per (channel, password) pair.
- Files: `src/crypto/argon.ts`, `scripts/build.mjs` (macrotask patch)
- Cause: The `@noble/hashes` pure-JS Argon2id implementation has no 64-bit integer optimisation for JS. This is inherent to the platform.
- Improvement path: The key-sync / `derive-keys.mjs` desktop tool mitigates this for known channels. Document clearly in settings that importing keys eliminates the delay. No code change can make pure-JS Argon2 fast.

---

## Fragile Areas

**Build relies on regex-patching noble's `utils.js` at bundle time:**
- Files: `scripts/build.mjs` (lines 29–42)
- Why fragile: The `nobleMacrotaskYield` esbuild plugin matches the exact string `export const nextTick = async () => { };` in `@noble/hashes/utils.js`. If `@noble/hashes` is updated to a version where this line changes (whitespace, semicolons, or a different yield strategy), the patch silently fails with a thrown error that blocks the build entirely.
- Safe modification: Always pin `@noble/hashes` to an exact version (`1.7.1` is already in `package.json` but with a caret `^1.7.1`), and run `npm test && npm run build` after any dependency update. The build throws if the regex misses, so the failure is loud.
- Test coverage: The CI build step will catch it (`npm run build` throws on patch failure).

**Build relies on regex checks for `class` and generator syntax surviving swc:**
- Files: `scripts/build.mjs` (lines 80–91)
- Why fragile: Correctness of the Hermes-safe build depends on post-build regex assertions (`/\bclass\s*/`, `/function\s*\*/`, `/_iteratorNormalCompletion/`). If swc changes its output shape (e.g., emits `var X={...}` instead of `class X{...}`), the class check regex may pass but the output could still use syntax Hermes rejects.
- Safe modification: The self-test (`src/selfTest.ts`) does an on-device smoke check for transpiler regressions at runtime. Update the regex checks if `@swc/core` is upgraded.
- Test coverage: Build-time regex check + on-device self-test cover the known failure modes.

**`vendetta` API is entirely `any`-typed:**
- Files: `src/global.d.ts`, all `src/discord/` files
- Why fragile: The entire Vendetta/Kettu plugin host API is declared as `declare const vendetta: any`. All metro lookups, patchers, and toasts are untyped. A Kettu version update that renames or restructures `vendetta.patcher.before`, `vendetta.metro.findByProps`, or `vendetta.ui.toasts.showToast` would silently type-check but throw at runtime.
- Safe modification: When adding new use-sites of the vendetta API, always wrap in `try/catch` (the `safe()` pattern in `src/index.ts` already does this for init). Use optional chaining on all vendetta accesses.
- Test coverage: None — no way to test vendetta API availability without the real runtime.

**`MessageActions()` metro lookup is cached on first call and never invalidated:**
- Files: `src/discord/metro.ts` (lines 6–12)
- Why fragile: `_msgActions` is set once via `??=`. If Discord hot-reloads its module registry (possible during app update or reconnect), `_msgActions` holds a stale reference. Sending would silently fail or use the wrong module.
- Safe modification: Consider re-resolving on each call (the lookup is cheap) or clearing `_msgActions` in `onUnload`.
- Test coverage: None.

**`stegcloak-rs` devDependency is pinned to a commit SHA via GitHub source:**
- Files: `package.json` (line 20), `package-lock.json`
- Why fragile: `"stegcloak-rs": "github:Milkshiift/stegcloak-rs"` resolves to commit `847c39e`. This is a source-level dependency requiring build tooling (the WASM is not pre-built in npm). If the upstream repo is deleted, renamed, or force-pushed, the CI will break. The lockfile pins the commit SHA, but npm install from a clean environment fetches from GitHub directly.
- Safe modification: Fork the repo under the project owner's GitHub account or vendor the compiled WASM binary directly into the repo.
- Test coverage: CI `npm install` will fail loudly if the upstream disappears.

---

## Test Coverage Gaps

**On-device / runtime integration paths are untested:**
- What's not tested: The entire `src/discord/` layer (`flux.ts`, `send.ts`, `commands.ts`, `metro.ts`) has zero automated tests. The Flux dispatch patch, the send intercept, the command registration, and all vendetta API interactions are only exercised by loading the plugin in Kettu on a real device.
- Files: `src/discord/flux.ts`, `src/discord/send.ts`, `src/discord/commands.ts`, `src/discord/metro.ts`
- Risk: A Kettu API change silently breaks encryption/decryption without any CI signal.
- Priority: High

**Key import (`importKeys`) is untested:**
- What's not tested: The key-sync workflow — `importKeys` in `src/core/keycache.ts`, the import path in `src/discord/commands.ts` and `src/ui/Settings.tsx`, and the `derive-keys.mjs` → mobile round-trip — has no test in `tests/harness.ts`. The harness only tests the stegcloak byte-compatibility pipeline.
- Files: `src/core/keycache.ts`, `tests/harness.ts`
- Risk: A regression in `passwordId()` or `toBase64/fromBase64` would silently break key-sync, causing decryption failures on mobile for channels that relied on imported keys.
- Priority: High

**`src/core/decrypt.ts` multi-password fallback is untested:**
- What's not tested: The `decryptWithCachedKeys` loop across multiple passwords, `orderPasswords` winner hinting, and the `decryptCorrupt` error path (authenticated decrypt but failed decompress) have no dedicated tests.
- Files: `src/core/decrypt.ts`, `src/core/keycache.ts`
- Risk: Regressions in multi-password ordering or the corruption-detection branch would be silent.
- Priority: Medium

**`src/crypto/random.ts` fallback chain is untested:**
- What's not tested: The RNG probe chain (`detectRng`) — Metro `getRandomValues`, Metro `randomBytes`, and the `Math.random` insecure fallback — is never exercised in the harness (which injects Node's `webcrypto` directly).
- Files: `src/crypto/random.ts`
- Risk: A new Kettu version that removes the standard `crypto.getRandomValues` global could silently fall through to the insecure fallback if `allowInsecureRng` is set.
- Priority: Low

**Health counters are not tested:**
- What's not tested: `src/core/health.ts` counters (`deriveFails`, `decryptCorrupt`, `sendAborts`) and `healthSummary()` output format are not covered.
- Files: `src/core/health.ts`
- Risk: Formatting regressions in status output; silent counter overflow on long sessions (JavaScript numbers don't overflow, so this is cosmetic only).
- Priority: Low

---

## Known Bugs

**`base64.ts` LOOKUP table has no bounds check for non-ASCII characters:**
- Symptoms: `fromBase64()` in `src/util/base64.ts` (line 39) indexes into an `Int16Array(128)` with `str.charCodeAt(i)`. For any character with code point >= 128 (e.g., a pasted key bundle containing a non-ASCII character from clipboard), `LOOKUP[charCodeAt]` returns `undefined` (not `-1`), and the `if (v < 0) continue;` guard does not skip it — `undefined < 0` is `false` in JavaScript.
- Files: `src/util/base64.ts`
- Trigger: Paste a key bundle string that contains a non-ASCII character (accidental copy of surrounding text, smart quotes, etc.).
- Workaround: The outer `try/catch` in the import handlers would eventually catch a malformed result, but the corruption happens silently within `fromBase64`.
- Fix: Change the guard to `if (v == null || v < 0) continue;` or clamp the index: `const v = i < 128 ? LOOKUP[str.charCodeAt(i)] : -1`.

**Settings UI does not re-derive or warm keys after passwords are saved:**
- Symptoms: After typing new passwords in the Settings UI and pressing "Save", the `mem` key cache still holds stale entries for old passwords. The new passwords are stored to `settings().passwords` but no warm-up is triggered. The next send or decrypt will trigger a ~10s derivation delay.
- Files: `src/ui/Settings.tsx` (lines 80–84)
- Trigger: Change passwords in settings, then immediately try to send or receive a message in a channel.
- Workaround: `/encrypt cycle` or `/encrypt on` triggers a `warm()` call that starts background derivation.
- Fix: Call `warm(getCurrentChannelId())` after `save()` in the Settings component.

---

*Concerns audit: 2026-05-30*
