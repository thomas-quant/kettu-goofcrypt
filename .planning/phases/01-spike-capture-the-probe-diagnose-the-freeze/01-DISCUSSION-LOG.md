# Phase 1: Spike — capture the probe + diagnose the freeze - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-30
**Phase:** 1-Spike — capture the probe + diagnose the freeze
**Areas discussed:** Probe disposition, Candidate-call depth & safety, Freeze-diagnosis method, Verdict bar & device coverage

---

## Probe disposition

### How should the probe be built — as permanent code or a throwaway diagnostic?

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent nativeProbe.ts | Build src/discord/nativeProbe.ts properly; structured, persisted ProbeReport surfaced via diag()/status; Phase 4 reuses it. | ✓ |
| Throwaway diagnostic | A minimal eval-style snippet like diagnose2.txt; read back manually then deleted. Doesn't satisfy persisted+restart-survivable. | |
| Hybrid: throwaway probe, persist only the result | Throwaway enumeration but persist findings into a ProbeReport; no permanent module. | |

**User's choice:** Permanent nativeProbe.ts
**Notes:** SPIKE-01 explicitly wants a persisted, restart-survivable report — the opposite of fire-and-forget diagnose2.txt. The module is also the Phase-4 home for candidate-adapter injection.

### When should the probe actually run and (re)write the persisted ProbeReport?

| Option | Description | Selected |
|--------|-------------|----------|
| On load if missing/stale + manual re-probe | Auto-probe on load when no report or build tag changed; persist; manual re-probe trigger for after Discord updates. | ✓ |
| Every load, unconditionally | Re-enumerate every onLoad and overwrite. | |
| Probe once, manual refresh only | First time only; never auto-refresh. Risk of stale verdict after a silent Discord update. | |

**User's choice:** On load if missing/stale + manual re-probe
**Notes:** Enumeration is cheap (object-key scans, no Argon2). Balances current-report freshness against not re-running needlessly.

---

## Candidate-call depth & safety

### How hard should the on-device test hit a reachable native Argon2 candidate?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered: cheap shape-probe, then one full-param run | Cheap params (m=8KiB,t=1) to learn shape, then ONE 64MiB run only if shape passes. | ✓ |
| Full real params only | Call directly at m=64MiB/t=3/p=1; every attempt pays the heavy cost, OOM risk. | |
| Shape-only, never full params | Only cheap-param shape checks; can't confirm survival of real params. | |

**User's choice:** Tiered: cheap shape-probe, then one full-param run
**Notes:** Fast feedback + real-param confirmation (OOM/timing) with minimal exposure to the expensive path.

### How do we keep a misbehaving native candidate from bricking Discord (hard crash/hang)?

| Option | Description | Selected |
|--------|-------------|----------|
| Manual trigger + armed-flag poison detection | Invocation only via explicit command (never auto on load); persist armed:<candidate> before each call, clear on return; stale flag on next load => crashed/unsafe, skip. Plus try/catch + timeout. | ✓ |
| try/catch + timeout only | Wrap + race; a true hard-crash takes the client down with no breadcrumb; auto-run could crash-loop. | |
| Auto-run on load, fully guarded | Run candidate tests during the on-load probe; worse UX if a candidate hard-crashes on every launch. | |

**User's choice:** Manual trigger + armed-flag poison detection
**Notes:** Implies the on-load probe does enumeration only; candidate invocation is a separate, manual, guarded step.

---

## Freeze-diagnosis method

### Where should the freeze evidence come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Both: live instrumentation + controlled bench | Instrument the real deriveKeyAsync/flux path (yield-counter, nextTick assertion, observe LOAD_MESSAGES storm) AND a controlled /encrypt bench for clean numbers. | ✓ |
| Live-only instrumentation | Only the real path; faithful but noisy and no clean baseline. | |
| Bench-only repro | Only a synthetic bench; can't reproduce the storm or a real send/flux sync-path leak. | |

**User's choice:** Both: live instrumentation + controlled bench
**Notes:** The LOAD_MESSAGES_SUCCESS storm only shows on the real path; the bench gives reproducible first-yield/longest-block figures. They corroborate.

### How do we handle the 'no synchronous deriveKey on a Discord-thread path' audit?

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent build-time guard + recorded audit | One-time import-graph audit in the verdict NOW, plus a build assertion in scripts/build.mjs failing the build if src/discord/ pulls the sync deriveKey / core/stegcloak.ts on the hot path. | ✓ |
| One-time manual audit only | Trace by hand, record, move on; nothing prevents reintroduction. | |
| Runtime tripwire instead | Dev-only guard that throws if sync deriveKey is entered from a Discord-thread stack; some hot-path cost, only fires if executed. | |

**User's choice:** Permanent build-time guard + recorded audit
**Notes:** A sync-derive leak is exactly the regression that silently re-freezes; a structural guard mirrors the existing class/generator regex gates.

### What happens to the live instrumentation + bench after the verdict is recorded?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as seed of Phase-3 bench/status, debug-flag gated | Keep /encrypt bench + assertions (seed OBS-01/OBS-02); hot-path instrumentation behind a debug flag (zero normal overhead). | ✓ |
| Throwaway — rip it all out | Capture evidence then remove; Phase 3 rebuilds from scratch. | |
| Keep bench, drop hot-path instrumentation | Keep the controlled bench; remove the live yield-counter entirely. | |

**User's choice:** Keep as seed of Phase-3 bench/status, debug-flag gated
**Notes:** Phase 3 hardens rather than recreates; hot-path live instrumentation is debug-flagged for zero overhead in normal use.

---

## Verdict bar & device coverage

### What evidence should be required to record a GREEN verdict?

| Option | Description | Selected |
|--------|-------------|----------|
| Shape-pass AND provisional byte-match vs noble reference | Reachable + 19-byte salt accepted + raw 32 bytes AND those bytes match a noble-derived reference for the same (password, channelId). | ✓ |
| Shape-pass only | GREEN on shape alone regardless of byte correctness; wrong-bytes catch deferred to Phase 2. | |
| Three-state GREEN / YELLOW / RED | YELLOW when byte-match couldn't run on-device; more nuance, more verdict logic. | |

**User's choice:** Shape-pass AND provisional byte-match vs noble reference
**Notes:** Catches the catastrophic 'wrong-32-bytes' failure at spike time. Does not replace the Phase-2 structural gate — keeps the Phase-1 verdict honest. Anything short → RED.

### Which device(s) must the probe + verdict cover to be conclusive?

| Option | Description | Selected |
|--------|-------------|----------|
| Primary device only; other platform untested/assume-RED | Run on the main device, record OS + build tag; other platform marked untested/RED until probed. | ✓ |
| Both Android and iOS required | Don't finalize until probed on both; most conclusive, blocks on device availability. | |
| Android only | Target Android, treat iOS out-of-scope. | |

**User's choice:** Primary device only; other platform untested/assume-RED
**Notes:** Pragmatic given native is expected-RED; the persisted report makes re-running on a second device later trivial.

---

## Claude's Discretion

- ProbeReport schema (field layout), as long as structured/persisted/renderable by diag() + status.
- Verdict document location/format (e.g. 01-VERDICT.md), as long as it states GREEN/RED and Phase-4 activation explicitly.
- Source of the noble reference key for the D-09 byte-match (on-device noble vs desktop tool).
- Exact command surface for the manual probe/test verbs.

## Deferred Ideas

None — discussion stayed within the spike's scope. Phase 2/3/4 boundaries were referenced as scope guards, not new deferred ideas (they already live in REQUIREMENTS.md / ROADMAP.md).
