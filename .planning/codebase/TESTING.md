# Testing Patterns

**Analysis Date:** 2026-07-18

## Test Framework

**Runner:**
- Custom Node.js runner in `scripts/test.mjs`; it uses esbuild to bundle `tests/harness.ts` and then dynamically imports the generated Node ESM bundle.
- No Jest, Vitest, Mocha, or browser/device test runner is configured.

**Assertion Library:**
- No assertion library. `tests/harness.ts` uses a local `check(name, condition, detail)` function, counts passes/failures, prints results, and exits nonzero on failure.

**Run Commands:**
```bash
npm test                 # Bundle and run the compatibility harness
npm run build            # Build plugin and run Hermes/static-output guards
npx tsc --noEmit         # Type-check using tsconfig.json (not wired as an npm script)
```

## Test File Organization

**Location:**
- All executable tests are in `tests/harness.ts`; generated output is `tests/dist/harness.mjs` and is ignored by Git.

**Naming:**
- No per-module test suffix or unit/integration filename split is used.

**Structure:**
```
tests/
  harness.ts             # single end-to-end compatibility and regression harness
  dist/harness.mjs       # generated esbuild artifact, ignored
```

## Test Structure

**Suite Organization:**
- The harness is a linear sequence of numbered sections (`[1]` through `[10]`) rather than `describe`/`it` suites.
- Each case calls `check(...)`; many protocol cases iterate the shared `CASES` fixture array.

**Patterns:**
- Tests use explicit setup, operation, and boolean verification inside `try`/`catch` blocks.
- Randomized checks use Node `webcrypto.getRandomValues`; failure details include the case name and a short output or length.
- The harness is device-free and exercises pure modules, not Vendetta/React Native runtime wiring.

## Mocking

**Framework:**
- No mocking library is used.
- `tests/harness.ts` provides a focused Kettu-like reactive storage `Proxy` stub to reproduce null-hostile storage behavior.

**What to Mock:**
- Host storage behavior is simulated locally; cryptographic randomness uses Node Web Crypto.
- The real `stegcloak-rs` WASM implementation is used as a reference dependency, not mocked.

**What NOT to Mock:**
- Do not replace the compatibility reference or the pure-JS crypto/stego pipeline when validating interoperability; those comparisons are the hard gate.

## Fixtures and Factories

**Test Data:**
- Shared protocol cases are the `CASES` array in `tests/harness.ts`, covering ASCII, no whitespace, tiny covers, tabs/newlines, Unicode whitespace, edge whitespace, emoji, and a 5k message.
- Constants include the snowflake-shaped channel salt and fixed Argon2 reference password/vector.
- `rng(n)` is a small random-byte helper; no separate fixtures directory or factory module exists.

**Location:**
- Fixtures and helpers are colocated in `tests/harness.ts`.

## Coverage

**Requirements:**
- No line/branch coverage target, coverage reporter, or threshold enforcement is configured.
- CI enforces behavior through the compatibility harness and build guards instead of coverage metrics.

**Configuration:**
- No coverage configuration was found.

## Test Types

**Unit Tests:**
- Pure primitive identity and error behavior are tested inline: zero-width conceal/extract, wrong password, salt sensitivity, and key-vector derivation.

**Integration Tests:**
- The main suite is an integration/compatibility test against the real `stegcloak-rs` WASM library in both directions, including cloaked-message parity.
- It also validates JSON serialization of `ProbeReport`, noble `nextTick` patch targeting, and Kettu storage initialization behavior.

**E2E Tests:**
- No Discord device or UI E2E tests exist. `src/discord/*`, React Native settings, Metro resolution, and actual Hermes evaluation are covered only indirectly by static build guards and manual/device use.

## Common Patterns

**Async Testing:**
```typescript
// The harness is mostly synchronous; async setup is handled by the runner/build.
// Async production paths are not directly exercised by a dedicated async test suite.
```

**Error Testing:**
```typescript
let threw = false;
try {
    ourReveal(stego, "wrongpass", CHANNEL);
} catch (e) {
    threw = e instanceof DecryptionError;
}
check("ours.reveal wrong password → DecryptionError", threw);
```

**Snapshot Testing:**
- Not used.

## CI Validation and Gaps

- `.github/workflows/ci.yml` runs on pushes to `main` and manual dispatch with Node 24: `npm install`, then `npm test`; only after tests pass does it run `npm run build` and deploy `site/` to GitHub Pages.
- The harness is a strong byte-exact compatibility gate, but there are no isolated regression tests for settings, key-cache lifecycle, send/Flux patch behavior, commands, or native probe adapters.
- Build guards in `scripts/build.mjs` validate parseability, absence of Hermes-incompatible class/generator/iterator lowering, and prevention of sync Argon2 import leakage, but they are not invoked by `npm test`.
- CI does not run `npx tsc --noEmit`, does not collect coverage, and does not exercise a real Hermes/Discord runtime.

---

*Testing analysis: 2026-07-18*
*Update when test patterns change*
