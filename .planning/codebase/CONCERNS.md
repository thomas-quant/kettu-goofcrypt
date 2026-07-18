# Codebase Concerns

**Analysis Date:** 2026-07-18

## Tech Debt

**Plaintext password and derived-key persistence:**
- Issue: `src/settings.ts` stores the configured password string, while `src/core/keycache.ts` persists derived 32-byte keys as base64 in `vendetta.plugin.storage`.
- Why: The cache is designed to survive restarts and avoid repeating the 64 MiB Argon2id derivation.
- Impact: Anyone able to inspect plugin storage obtains the passwords or reusable channel keys; `clearMemory()` does not remove persisted keys.
- Fix approach: Keep the casual-privacy limitation explicit, and if the host offers secure storage, move passwords and/or key material behind it. Add a migration and an explicit cache-clear path before changing the persisted format.

**Import path accepts unvalidated key-store data:**
- Issue: `src/core/keycache.ts:51-64` copies arbitrary object keys and values into persistent storage; `src/ui/Settings.tsx:88-94` and `src/discord/commands.ts:110-118` only decode JSON/base64 and do not validate bundle version, channel IDs, password IDs, key lengths, or base64 canonicality.
- Why: The path was added as a low-friction desktop-to-mobile key-sync escape hatch.
- Impact: Malformed or oversized input can poison the cache, make later `fromBase64` lookups return invalid-length keys, or consume storage. It can also silently report successful imports that cannot decrypt.
- Fix approach: Validate the outer shape, permitted identifiers, exact 32-byte decoded key length, and expected bundle version before mutating storage; import transactionally and test rejection cases.

**Global debug hook lifecycle leak:**
- Issue: `src/index.ts:89-101` installs `globalThis.__goofcrypt`, but `onUnload()` only unpatches Discord hooks, unregisters commands, and clears memory (`src/index.ts:126-131`).
- Why: The hook is useful for on-device diagnostics and was added without unload symmetry.
- Impact: Reloading or disabling the plugin leaves stale diagnostic functions and references reachable from the global object, potentially calling torn-down state and retaining objects.
- Fix approach: Record ownership of the installed hook and delete or restore it during unload, guarding against another plugin replacing it.

## Known Bugs

**Settings changes do not invalidate or re-warm cached/decryption state:**
- Symptoms: Changing passwords in the settings screen saves the new string but leaves old in-memory/persisted keys available; changing the mark or password list does not clear `src/discord/flux.ts`'s `decryptedIds`.
- Trigger: Decrypt or encrypt a channel, then edit passwords/mark in `src/ui/Settings.tsx:80-85` and continue using the same channel/messages.
- Workaround: Disable/reload the plugin or use the command path that cycles settings; this is not a reliable user-facing fix.
- Root cause: The save handler writes settings only. There is no cache invalidation or reprocessing policy coupled to settings mutation, and `src/core/keycache.ts:114-118` is only called on unload.

**Inbound history can launch many background decrypt coroutines:**
- Symptoms: Opening a channel containing multiple cloaked messages can show repeated derivation toasts, schedule many per-message async tasks, and produce a burst of `MESSAGE_UPDATE` dispatches.
- Trigger: `LOAD_MESSAGES_SUCCESS` with several uncached cloaked messages (`src/discord/flux.ts:102-105`).
- Workaround: Pre-warm the channel key with `/encrypt` commands before opening history.
- Root cause: `src/discord/flux.ts:49-93` guards by message ID, while `src/core/keycache.ts:85-97` deduplicates only the underlying `(channel,password)` derivation. The surrounding coroutines and redispatches are still multiplied by message count.

## Security Considerations

**Explicit insecure RNG opt-in weakens nonce security:**
- Risk: `src/crypto/random.ts:102-109` uses `Math.random()` when requested, which is not a CSPRNG and can make XChaCha nonce collisions or prediction materially more plausible. Reuse of a `(key, nonce)` pair compromises AEAD confidentiality/integrity.
- Current mitigation: `allowInsecureRng` defaults to false (`src/settings.ts:86-92`), and send availability is checked in `src/discord/send.ts:30-35` / `src/discord/commands.ts:20-22`.
- Recommendations: Keep the default deny behavior; require an unmistakable confirmation explaining the consequence, expose the active RNG source, and consider refusing insecure mode for production builds.

**Native RNG output validation is incomplete:**
- Risk: `src/crypto/random.ts:27-40` accepts any `Uint8Array` or array without checking that it contains at least the requested number of bytes; base64 strings are truncated rather than rejected. Short output can produce a nonce with insufficient entropy.
- Current mitigation: The source is selected only from modules exposing expected random APIs, and secure mode is disabled if discovery fails.
- Recommendations: Enforce exact output length and reject malformed/non-canonical native results before returning bytes; add tests for short arrays, short strings, and throwing providers.

## Performance Bottlenecks

**Pure-JavaScript Argon2id derivation:**
- Problem: `src/crypto/argon.ts:13-22` uses Argon2id with 64 MiB memory, time cost 3, and parallelism 1; the synchronous path remains available to compatibility code.
- Measurement: Project documentation and implementation notes record roughly a 10-second first derivation on mobile; `src/crypto/argon.ts:111-145` exposes timing and longest-block diagnostics but no committed device baseline.
- Cause: Hermes lacks fast native 64-bit integer support; the bundled implementation is pure JS. The async path yields through a build-time patch but does not reduce total CPU work.
- Improvement path: Prefer a byte-exact native implementation only after the vector gate in `tests/harness.ts:214-232` passes. Preserve the current Argon2 parameters and retain a measured fallback.

## Fragile Areas

**Build-time patch of noble `nextTick`:**
- Why fragile: `scripts/build.mjs:29-40` rewrites one exact source declaration inside `@noble/hashes`; a dependency update or formatting change can make the replacement fail or change semantics. Runtime responsiveness depends on this becoming a macrotask.
- Common failures: A dependency bump can reintroduce microtask-only yielding and restore UI starvation, or a changed module path can bypass the plugin.
- Safe modification: Pin and audit the dependency, keep the source-literal CI assertion in `tests/harness.ts:186-207`, and verify `assertMacrotaskYield()` on-device.
- Test coverage: The harness checks the patch target, but Node does not execute the shipped patched bundle; real Hermes behavior is covered only by diagnostics/self-test.

**Hermes transpilation and iteration assumptions:**
- Why fragile: `scripts/build.mjs:93-120` relies on SWC ES5 lowering and `iterableIsArray:true`, because iterator-protocol lowering reportedly drops the first element under the target Hermes runtime.
- Common failures: New `Map`/`Set` iteration, unsupported syntax, or a bundler/transpiler upgrade can silently alter runtime behavior while Node tests remain green.
- Safe modification: Use index loops for arrays and explicit Map/Set access, run the build guards, and test the resulting bundle on-device.
- Test coverage: `src/selfTest.ts:29-57` checks selected parse/stego/base64 invariants, not every generated control-flow path or Discord host interaction.

**Memoized Metro `MessageActions` handle:**
- Why fragile: `src/discord/metro.ts:6-12` caches the first resolved module indefinitely.
- Common failures: Discord reloads or replaces Metro modules and the cached object becomes stale; sends then fail or use an invalid host reference until plugin reload.
- Safe modification: Resolve per operation or add invalidation on host/module failure, while preserving the fallback lookup behavior.
- Test coverage: No automated test exercises Metro replacement, stale handles, or Vendetta patch lifecycle.

## Scaling Limits

**Per-channel/per-password cache growth:**
- Current capacity: `src/core/keycache.ts:26-28` retains one in-memory key per `(channelId,password)` and persists every derived key; there is no TTL, LRU, channel cap, or persisted-cache pruning.
- Limit: Growth is proportional to the number of channels visited times configured passwords and is bounded only by device/plugin storage.
- Symptoms at limit: Increased storage size, slower cache reads/serialization, and retained sensitive material for channels no longer used.
- Scaling path: Add bounded eviction and an explicit “clear derived keys” control, with careful persistence and re-derivation semantics.

## Dependencies at Risk

**`@noble/hashes` integration contract:**
- Risk: The build relies on a private-ish source shape and import resolution details of `@noble/hashes` (`scripts/build.mjs:32-39`), while Argon2 performance is central to the product.
- Impact: Version drift can break builds, silently restore freezes, or alter cryptographic behavior before compatibility tests catch all runtime effects.
- Migration plan: Keep the version pinned, fail closed on patch mismatch, run cross-implementation vectors for every upgrade, and isolate any native replacement behind the same vectors.

## Missing Critical Features

**Reliable key-cache/settings lifecycle management:**
- Problem: There is no user-visible cache revocation, password-change migration, or safe purge operation; only volatile memory is cleared on unload.
- Current workaround: Reloading the plugin clears memory, but persisted keys remain and settings edits do not coordinate with them.
- Blocks: Users cannot confidently rotate passwords or remove derived material from the device.
- Implementation complexity: Medium; requires storage schema/versioning, cache invalidation, UI/command affordances, and regression tests.

## Test Coverage Gaps

**Key-sync validation and persistence round trips:**
- What's not tested: The harness covers wire compatibility, but does not test `importKeys` shape rejection, malformed base64, exact key length, storage mutation behavior, or derive-keys output through import and subsequent `getCachedKey`.
- Risk: Desktop-derived keys can appear imported while remaining unusable, or malformed input can persist silently.
- Priority: High
- Difficulty to test: Low to medium; provide a mock Kettu storage and fixtures from `tools/derive-keys.mjs`.

**Host lifecycle and settings behavior:**
- What's not tested: `onLoad`/`onUnload` symmetry, global hook cleanup, Metro module replacement, Flux payload variants, settings save invalidation, and repeated history loads.
- Risk: Device-only regressions can leave stale patches/hooks, fail sends after Discord reloads, or cause duplicate decrypt work without CI detection.
- Priority: High
- Difficulty to test: Medium; requires host API mocks and dispatch fixtures, but most core lifecycle assertions can run under Node.

**RNG provider failure modes:**
- What's not tested: Native providers returning short or malformed values, provider exceptions after detection, and explicit insecure-RNG UX/guard behavior.
- Risk: Encryption may use weak or malformed nonces despite the secure-RNG gate.
- Priority: Medium
- Difficulty to test: Low; inject/mock provider results and assert exact-length rejection.

---

*Concerns audit: 2026-07-18*
*Update as issues are fixed or new ones discovered*
