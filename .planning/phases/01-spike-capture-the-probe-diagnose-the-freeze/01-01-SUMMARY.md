---
phase: 01-spike-capture-the-probe-diagnose-the-freeze
plan: 01
subsystem: testing
tags: [argon2id, noble-hashes, esbuild, metafile, stegcloak, json-schema, ci]

# Dependency graph
requires:
  - phase: 01 (research/patterns)
    provides: completed sync-derive import-graph audit (D-07), ProbeReport schema discretion (D-01), nextTick caret tripwire design (D-06), D-09 vector convention
provides:
  - ProbeReport + CandidateResult persisted schema (plain-JSON, non-secret) in src/settings.ts
  - nativeProbe / nativeProbeArmed / debugInstrument Settings fields + DEFAULTS
  - Wave-0 CI assertions [7] ProbeReport round-trip, [8] nextTick caret tripwire, [9] D-09 reference vector
  - committed D-09 reference key vector (32 bytes) cross-checked against stegcloak-rs
  - permanent sync-derive import-graph build guard in scripts/build.mjs (metafile + reachesSyncDerive)
affects: [plan 01-02 (nativeProbe + on-device instrumentation), plan 01-03 (commands/diag wiring), plan 01-04 (verdict), phase 02 GATE-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProbeReport persistence mirrors KeyCacheStore→Settings→DEFAULTS pattern (plain-JSON, non-secret only)"
    - "esbuild metafile import-graph walk as a structural build-time invariant guard (mirrors the class/generator/iterator regex gates)"
    - "Off-device CI tripwire for the build-time noble nextTick macrotask patch (reads the esm source, not the runtime form, because the test bundle is unpatched)"

key-files:
  created: []
  modified:
    - src/settings.ts
    - tests/harness.ts
    - scripts/build.mjs

key-decisions:
  - "ProbeReport field layout chosen at Claude's discretion (D-01): version/timestamp/buildTag/platform/scannedKeys/cryptoIsh[]/turboHits[]/metroHits[]/subtle/candidates[]/verdict — all plain-JSON, no Uint8Array/Map/Set, no secret material"
  - "[8] caret tripwire asserts the build-patch TARGET STRING is present in noble's esm/utils.js source (the real regression surface) rather than String(nextTick) at runtime — because scripts/test.mjs does NOT apply the build-time macrotask patch, so the runtime nextTick is the unpatched microtask form"
  - "D-09 reference vector committed as a 32-byte literal captured once from deriveKey('goofcryptspikevector', CHANNEL); cross-checked via a stegcloak-rs sc.hide→ourReveal round-trip so the value is provably from the byte-compat path, not a typo"

patterns-established:
  - "Build guard: walk result.metafile.inputs import graph after esbuild bundle, before swc; throw on a forbidden transitive edge"
  - "CI tripwire for a build-time source-rewrite patch: assert the patch's exact target literal still exists in the dependency source"

requirements-completed: [SPIKE-01, SPIKE-03]

# Metrics
duration: ~20min
completed: 2026-06-01
---

# Phase 1 Plan 01: Spike CI Foundation Summary

**Off-device CI foundation for the spike: the persisted ProbeReport/CandidateResult schema, three Wave-0 harness assertions (ProbeReport JSON round-trip, nextTick caret tripwire, committed D-09 reference vector), and a permanent esbuild-metafile sync-derive build guard that makes the no-sync-leak audit un-regressable.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-01
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Defined and exported the `ProbeReport` and `CandidateResult` interfaces (plain-JSON, non-secret) plus the three spike Settings fields (`nativeProbe`/`nativeProbeArmed`/`debugInstrument`) with clean DEFAULTS — every downstream plan now builds against fixed shapes.
- Added three Wave-0 CI assertions to `tests/harness.ts` ([7], [8], [9]); full harness is green at **49 passed, 0 failed**, COMPAT-01 hard gate held.
- Committed the D-09 reference-key vector and cross-checked it against the real stegcloak-rs WASM reference, so the on-device byte-match has a CI-proven target.
- Wired a permanent `metafile: true` + `reachesSyncDerive` import-graph guard into `scripts/build.mjs`; demonstrated it fires on a deliberate `discord→core/stegcloak` value import and exits 0 on the clean tree.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define ProbeReport schema + spike settings fields** — `888e530` (feat)
2. **Task 2: Add Wave-0 CI assertions [7]-[9]** — `a335110` (test)
3. **Task 3: Add sync-derive import-graph build guard (D-07)** — `f5e407d` (feat)

_Note: Tasks 1 and 2 were marked `tdd="true"`. Their verification is a build/grep gate (Task 1) and the harness assertions themselves (Task 2); no separate RED test commit was warranted because the "behavior" under test for Task 2 IS the new harness section. The harness was confirmed green after each change._

## Files Created/Modified
- `src/settings.ts` — Added exported `interface ProbeReport` + `interface CandidateResult`; extended `Settings` with three optional spike fields; added `nativeProbe: null`, `nativeProbeArmed: null`, `debugInstrument: false` to `DEFAULTS` (existing `initSettings` back-fill loop covers them).
- `tests/harness.ts` — Added sections `[7]` ProbeReport JSON round-trip, `[8]` nextTick caret tripwire, `[9]` D-09 reference vector; new imports (`nextTick`, `deriveKey`, `ProbeReport` type, `node:module`/`node:fs`/`node:path` helpers).
- `scripts/build.mjs` — Added `metafile: true` to the esbuild `build()` call and the `reachesSyncDerive` import-graph guard between bundle and swc transform.

## Decisions Made

**ProbeReport field layout (D-01, Claude's discretion).** Chosen layout (all plain-JSON, non-secret):
`version: number`, `timestamp: number`, `buildTag: string | null`, `platform: string | null`, `scannedKeys: number`, `cryptoIsh: string[]`, `turboHits: Array<{name; methods[]}>`, `metroHits: Array<{prop; found; methods[]}>`, `subtle: boolean`, `candidates: CandidateResult[]`, `verdict: "GREEN" | "RED" | "untested"`.
`CandidateResult`: `name`, `reachable`, `saltAccepted`, `outputKind ("raw32"|"phc-string"|"other"|"unknown")`, `byteMatch`, `crashed`, `error?`, `timingMs?`. No `Uint8Array`/`Map`/`Set`; no key bytes or passwords.

**Committed D-09 reference vector (32 bytes):**
First 4 bytes `[88, 212, 83, 25 …]`, last 4 bytes `[… 226, 205, 232, 4]`, length 32. Captured once from `deriveKey("goofcryptspikevector", "1234567890123456789")` (the existing sync noble path) and cross-checked via `ourReveal(sc.hide("x", VEC_PW, CHANNEL, "cover"), VEC_PW, CHANNEL) === "x"`.

**nextTick-in-test-bundle finding (the key Open Question):**
`scripts/test.mjs` does **NOT** apply the `nobleMacrotaskYield` esbuild plugin — that patch lives only in `scripts/build.mjs`. Therefore the `nextTick` imported into the harness bundle is the **unpatched microtask form** (`async () => { }`, confirmed: the microtask regex matches it). Asserting `!microtaskRegex.test(String(nextTick))` against the test bundle would therefore **fail** and would test the wrong surface. The `[8]` assertion instead reads noble's `esm/utils.js` source and asserts the build patch's exact target literal — `export const nextTick = async () => { };` — is still present, i.e. the build-time macrotask rewrite will still fire. That is the true caret-regression tripwire; the on-device `assertMacrotaskYield()` (Plan 02) is the runtime counterpart.

**Build-guard fire/revert demonstration result:**
- Clean tree: `npm run build` exits **0** (no `discord→stegcloak` value import; matches the research audit).
- Injected a real value import of `reveal` from `../core/stegcloak` into `src/discord/commands.ts` (with a `globalThis` reference so esbuild keeps it): `npm run build` **threw** `sync-derive leak: src/discord/commands.ts transitively imports core/stegcloak.ts (sync 64MiB derive) — would re-freeze the UI` and exited **1**.
- Reverted the injection via `git checkout -- src/discord/commands.ts`; rebuild exits **0** again. Confirmed `import type { RandomBytes }` in `core/encrypt.ts` does NOT false-trip (esbuild erases type-only imports before the metafile).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `[8]` assertion reframed to be CI-green and meaningful**
- **Found during:** Task 2 (Wave-0 CI assertions)
- **Issue:** The plan's literal `[8]` action — `check("nextTick is macrotask form", !/async\s*\(\s*\)\s*=>\s*\{\s*\}/.test(String(nextTick)), ...)` — would **fail** under `npm test`, because the test bundle (`scripts/test.mjs`) does not apply the build-time macrotask patch, so the runtime `nextTick` is the microtask form. The plan's own `[8]` behavior spec explicitly anticipates this ("if the harness bundle does NOT receive the build-time patch … document that … and still assert the form … coordinate the exact expectation with how scripts/test.mjs bundles").
- **Fix:** The assertion now resolves noble's `esm/utils.js` (via `createRequire` + the public `./utils` entry, since the package `exports` map blocks deep paths) and asserts the build patch's exact target literal is still present — the real caret-regression surface — while recording the runtime form in the failure detail for documentation. CI-green and tests the thing that actually matters.
- **Files modified:** tests/harness.ts
- **Verification:** `npm test` → `[8]` passes; full harness 49 passed, 0 failed.
- **Committed in:** `a335110` (Task 2 commit)

**2. [Rule 3 - Blocking] Installed dependencies via `npm ci`**
- **Found during:** Pre-execution setup
- **Issue:** The worktree had no `node_modules`, so `npm run build` and `npm test` could not run.
- **Fix:** Ran `npm ci` (lockfile-faithful install; NOT a new package add, so the package-legitimacy checkpoint does not apply).
- **Files modified:** none tracked (`node_modules` is gitignored)
- **Verification:** Build and test commands subsequently ran.
- **Committed in:** n/a (no tracked changes)

---

**Total deviations:** 2 auto-fixed (1 bug-class reframe, 1 blocking environment setup)
**Impact on plan:** The `[8]` reframe was required to produce a green, meaningful CI assertion and is fully consistent with the plan's documented contingency. No scope creep; all four `must_haves.truths` are satisfied (the nextTick truth is satisfied by asserting the build patch will fire, which is the off-device half of the macrotask guarantee).

## Issues Encountered
- `require.resolve("@noble/hashes/esm/utils.js")` and `@noble/hashes/package.json` are both blocked by the package `exports` map. Resolved by resolving the public `@noble/hashes/utils` entry and deriving the `esm/utils.js` sibling from its directory.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The ProbeReport/CandidateResult contracts, the three spike Settings fields, and the D-09 reference vector are fixed and CI-checked — Plans 02/03/04 can build against them without re-deriving shapes.
- The sync-derive build guard is permanent; any future stray `discord→core/stegcloak` value import will fail the build loudly.
- Open question for Plan 02 (on-device): whether the reactive `plugin.storage` proxy flushes the `nativeProbeArmed` write to disk before a native call (A1 / Pitfall 4) — unresolved here (off-device only), flagged for the on-device armed-flag work.

## Self-Check: PASSED

- Files: `src/settings.ts`, `tests/harness.ts`, `scripts/build.mjs`, `01-01-SUMMARY.md` all present.
- Commits `888e530`, `a335110`, `f5e407d` all exist in git history.

---
*Phase: 01-spike-capture-the-probe-diagnose-the-freeze*
*Completed: 2026-06-01*
