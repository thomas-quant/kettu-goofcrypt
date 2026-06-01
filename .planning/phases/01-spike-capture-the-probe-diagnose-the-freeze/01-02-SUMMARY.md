---
phase: 01-spike-capture-the-probe-diagnose-the-freeze
plan: 02
subsystem: crypto
tags: [argon2id, noble-hashes, nextTick, macrotask, instrumentation, debug-flag, spike]

# Dependency graph
requires:
  - phase: 01 (plan 01-01)
    provides: debugInstrument Settings field + DEFAULTS, ProbeReport schema, nextTick CI tripwire (off-device half), sync-derive import-graph build guard
provides:
  - assertMacrotaskYield() — on-device runtime caret-regression tripwire (String(nextTick) macrotask-form assertion)
  - deriveKeyAsyncInstrumented(password, channelId, debug=false) — zero-overhead parameter-gated yield/timing sampler over the real deriveKeyAsync
  - benchOnceDetailed() — LOCKED enriched-timing contract { totalMs, firstYieldMs, longestBlockMs, yieldCount, ok, form } for Plan 03 bench wiring
  - debug-gated (settings().debugInstrument) concurrency observation of the LOAD_MESSAGES_SUCCESS storm in flux.ts
  - debug-gated cold-path first-key-ready latency observation in send.ts
  - confirmed finding: flux.ts AND send.ts both import the ASYNC core/keycache deriveKey (live-path half of the SPIKE-03 sync-leak evidence)
affects: [plan 01-03 (commands/diag/bench wiring binds against benchOnceDetailed + assertMacrotaskYield), plan 01-04 (verdict), phase 03 OBS-01/OBS-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parameter-injected debug flag (mirrors random.ts rng: RandomBytes DI) keeps the crypto layer free of any settings() up-graph import while still allowing debug-gated instrumentation"
    - "setInterval(0) macrotask sampler as the on-device proxy for 'are macrotasks firing during derivation' (noble's internal nextTick yield count is not observable from outside its closure — A4)"
    - "Debug-gated observation hooks in the discord layer (which MAY import settings) that accumulate/log and never throw inside the Flux hook (mirrors the noteError convention)"

key-files:
  created: []
  modified:
    - src/crypto/argon.ts
    - src/discord/flux.ts
    - src/discord/send.ts

key-decisions:
  - "argon.ts debug flag is a PARAMETER, never settings() — disregarded the RESEARCH Pattern 3 sketch's settings().debugInstrument line (the flagged crypto→settings up-graph edge); mirrored random.ts's rng DI-by-parameter convention"
  - "benchOnceDetailed() locked here (NOT deferred to SUMMARY) as the authoritative contract Plan 03 binds against: { totalMs, firstYieldMs, longestBlockMs, yieldCount, ok, form }; benchOnce(): Promise<number> left untouched so existing callers do not break"
  - "longestBlockMs computed as the max gap between consecutive setInterval(0) samples (plus the tail gap from last sample to completion) — the worst single UI stall during derivation"

requirements-completed: [SPIKE-03]

# Metrics
duration: ~10min
completed: 2026-06-01
---

# Phase 1 Plan 02: On-Device Instrumentation of the Real Derive + Dispatch Path Summary

**The real async derivation and the LOAD_MESSAGES_SUCCESS dispatch storm are now measured (not assumed): a parameter-gated `setInterval(0)` yield sampler over the real `deriveKeyAsync`, an on-device `nextTick` macrotask-form tripwire, a locked enriched-bench contract for Plan 03, and zero-overhead debug-gated observation of the storm + cold-path — all preserving discord→core→crypto layering and changing no freeze behavior (the fix is Phase 3).**

## Performance
- **Duration:** ~10 min
- **Completed:** 2026-06-01
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `assertMacrotaskYield()` to `src/crypto/argon.ts` — the on-device runtime counterpart to the Plan 01 off-device CI tripwire. It computes `String(nextTick)` and returns `{ ok, form }`, where `ok=false` means noble's `nextTick` is the empty-async-arrow microtask form (regressed, UI re-freezes) and `ok=true` means the `setTimeout` macrotask form the build patch installs.
- Added `deriveKeyAsyncInstrumented(password, channelId, debug=false)` — when `debug` is false it early-returns the plain `deriveKeyAsync` result with zero overhead; when true it returns the derived key plus `totalMs`, `firstYieldMs`, `yieldSamples`, and the `assertMacrotaskYield()` result via a `setInterval(0)` sampler. The `debug` flag is parameter-injected, NOT read from settings — argon.ts imports no settings.
- Added `benchOnceDetailed()` returning the LOCKED contract `{ totalMs, firstYieldMs, longestBlockMs, yieldCount, ok, form }`; `benchOnce(): Promise<number>` is untouched.
- Added a debug-gated (`settings().debugInstrument`) `activeDerivations`/`peakDerivations` concurrency counter to `src/discord/flux.ts` `backgroundDecrypt`, incrementing on `deriving.add` and decrementing in the existing `.finally`, logging peak concurrency via `vendetta.logger.log`. Dispatch/decrypt/per-messageId-guard behavior is unchanged.
- Added a debug-gated cold-path first-key-ready latency log to `src/discord/send.ts` (timestamp before `deriveKey`, diff in the `.then`). Reject-and-resend behavior is unchanged.

## Task Commits
1. **Task 1: assertMacrotaskYield + parameter-gated instrumented derive wrapper** — `585504c` (feat)
2. **Task 2: benchOnceDetailed + debug-gated storm/cold-path observation** — `2103648` (feat)

_Both tasks: `npm run build` exits 0 (class-free, sync-derive guard green), `npm test` 49 passed / 0 failed (byte-compat COMPAT-01 hard gate held)._

## Files Created/Modified
- `src/crypto/argon.ts` — Added `import { nextTick } from "@noble/hashes/utils"`; exported `assertMacrotaskYield()`, `deriveKeyAsyncInstrumented()`, `benchOnceDetailed()`. `OPTS`/`ASYNC_OPTS`/`deriveKey`/`deriveKeyAsync`/`benchOnce` byte-compat surface untouched.
- `src/discord/flux.ts` — Added module-level `activeDerivations`/`peakDerivations`; debug-gated increment/log on `backgroundDecrypt` launch and debug-gated decrement in the `.finally`.
- `src/discord/send.ts` — Added debug-gated cold-path latency timestamp + log around the existing `deriveKey(...).then(...)`.

## Locked Contracts (for Plan 03)

**`deriveKeyAsyncInstrumented(password, channelId, debug=false)` return shape (when `debug=true`):**
```
{ key: Uint8Array, totalMs: number, firstYieldMs: number, yieldSamples: number, ok: boolean, form: string }
```
When `debug=false`: returns `Promise<Uint8Array>` (the plain `deriveKeyAsync` result, zero overhead).

**`benchOnceDetailed()` LOCKED return contract (authoritative — Plan 03 Task 3 binds against this):**
```
{ totalMs: number, firstYieldMs: number, longestBlockMs: number, yieldCount: number, ok: boolean, form: string }
```
- `totalMs` — wall-clock derivation time
- `firstYieldMs` — latency to the first fired macrotask (front-loaded first pass indicator)
- `longestBlockMs` — max gap between consecutive samples (incl. the tail gap to completion) ⇒ worst single UI stall
- `yieldCount` — number of macrotasks that fired (zero across a multi-second derivation ⇒ thread-starved ⇒ effectively frozen)
- `ok` / `form` — spread from `assertMacrotaskYield()` (caret-regression tripwire)

## Decisions Made

**Parameter injection over `settings()` inside argon.ts (PATTERNS.md flag #1).** The RESEARCH Pattern 3 sketch (~lines 324–326) reads `settings().debugInstrument` inside `argon.ts`, which is exactly the forbidden crypto→settings up-graph edge. Disregarded that line; `deriveKeyAsyncInstrumented` takes a plain boolean `debug` parameter, mirroring `random.ts`'s `rng: RandomBytes` DI. Verified `! grep -q 'settings()' src/crypto/argon.ts` passes (a comment that originally contained the literal `settings()` was reworded to "the settings module" so the layering grep gate stays clean).

**`benchOnceDetailed` locked here, not deferred.** Per the plan, the enriched-bench shape is the contract Plan 03 binds against, so it is authoritative in this SUMMARY rather than left to discovery. `benchOnce()`'s existing `Promise<number>` signature is preserved so no existing caller breaks.

**A4 honest caveat encoded in comments.** noble's internal `await nextTick()` count is not observable from outside its closure. The instrumentation proves two things only: (1) the `nextTick` runtime *form* is macrotask (`assertMacrotaskYield`), and (2) macrotasks actually *fire* during derivation (`setInterval(0)` sampler) — zero samples across a multi-second derivation ⇒ thread starved.

## Confirmed Finding (SPIKE-03 live-path sync-leak evidence)

Both `src/discord/flux.ts` (line 10) and `src/discord/send.ts` (line 12) import `deriveKey` from `../core/keycache` — the **ASYNC** variant (`keycache.deriveKey` → `deriveKeyAsync` → `argon2idAsync`), NOT the sync `crypto/argon` `deriveKey`. This is the live-path half of the SPIKE-03 evidence: the two user-facing derivation entry points (inbound flux background-decrypt and outbound send cold-path) both reliably take the async route. Combined with Plan 01's permanent esbuild-metafile sync-derive build guard (the static half), the no-sync-leak audit (D-07) is confirmed on both the static import graph and the live dispatch paths. The remaining freeze is therefore NOT a sync leak — it is the async derivation's own wall-clock cost / yield cadence, which this plan's instrumentation now measures (and Phase 3 fixes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed dependencies via `npm ci`**
- **Found during:** Pre-execution setup
- **Issue:** The fresh worktree had no `node_modules`, so `npm run build` and `npm test` could not run.
- **Fix:** Ran `npm ci` (lockfile-faithful; not a new package add, so the package-legitimacy checkpoint does not apply).
- **Files modified:** none tracked (`node_modules` is gitignored)
- **Verification:** Build and test commands subsequently ran.
- **Committed in:** n/a (no tracked changes)

**2. [Rule 1 - Bug] Reworded an argon.ts comment to satisfy the `! grep -q 'settings()'` layering gate**
- **Found during:** Task 1 verification
- **Issue:** A doc comment originally read "never read from settings()" — the literal `settings()` tripped the acceptance gate `! grep -q 'settings()' src/crypto/argon.ts` even though no actual call was added.
- **Fix:** Reworded to "never read from the settings module"; the file has zero `settings()` occurrences.
- **Files modified:** src/crypto/argon.ts
- **Verification:** `! grep -q 'settings()' src/crypto/argon.ts` succeeds; build + harness green.
- **Committed in:** `585504c` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking environment setup, 1 comment-wording fix to keep the layering gate green)
**Impact on plan:** No scope change. All `must_haves.truths` satisfied; the benchOnceDetailed contract is locked; no freeze behavior changed (observe-only, per the plan — the fix is Phase 3).

## Known Stubs
None — all added instrumentation is wired and exercised by the build/harness; the debug-gated paths default to zero-overhead off (`debugInstrument: false`), which is intentional (D-08) and consumed on-device + by Plan 03's diag/bench commands.

## Issues Encountered
None beyond the two documented deviations.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Plan 03 can wire `/encrypt diag`/`bench` against the locked `benchOnceDetailed()` contract and `assertMacrotaskYield()` without re-deriving shapes.
- The instrumentation is structured (parameter-gated, debug-flagged, observe-only) to seed Phase-3 OBS-01/OBS-02 without recreating it.
- Confirmed both live derivation entry points take the async route — combined with Plan 01's static build guard, the no-sync-leak audit is complete on both axes.

## Self-Check: PASSED
- Files: `src/crypto/argon.ts`, `src/discord/flux.ts`, `src/discord/send.ts`, `01-02-SUMMARY.md` all present.
- Commits `585504c`, `2103648` exist in git history.

---
*Phase: 01-spike-capture-the-probe-diagnose-the-freeze*
*Completed: 2026-06-01*
