---
phase: 1
slug: spike-capture-the-probe-diagnose-the-freeze
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Spike caveat:** This is a *diagnosis* spike. Most deliverables (ProbeReport,
> candidate results, freeze evidence, verdict) are validated by **on-device
> evidence + a restart-survival or byte-match check**, not by a unit test. The
> off-device surface that *can* be CI-tested is captured in the Wave 0 section.
> Source of this contract: `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom Node test runner — `scripts/test.mjs` esbuild-bundles `tests/harness.ts` (with the `.wasm` loader) and runs it under Node. No Jest/Vitest. |
| **Config file** | none — the runner is the script itself (`scripts/test.mjs`) |
| **Quick run command** | `npm test` (byte-compat harness; pure JS + WASM, fast) |
| **Full suite command** | `npm test && npm run build` (harness green + Hermes-safe build gates pass) |
| **Estimated runtime** | ~5–15 seconds (harness + esbuild→swc build) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (byte-compat harness must stay green — the spike touches no crypto primitive and must not regress interop) **and** `npm run build` (Hermes-safe gates: class/generator/iterator + the new sync-derive guard).
- **After every plan wave:** Run `npm test && npm run build` (full off-device suite green).
- **Before `/gsd-verify-work`:** Full off-device suite green **AND** on-device evidence gathered (ProbeReport persisted + restart-survived, candidate tested if any reachable, freeze instrumented, verdict committed).
- **Max feedback latency:** ~15 seconds (off-device); on-device evidence is manual.

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; the rows below map each **requirement
> deliverable** to its trust mechanism (from `01-RESEARCH.md`). The planner
> binds these to concrete task IDs in the PLAN.md `<automated>` / `<manual>`
> fields. `❌ W0` = the automatable half is a Wave 0 harness addition.

| Deliverable | Requirement | Validation Type | Trust mechanism | Test Type | Automated Command | CI? | Status |
|-------------|-------------|-----------------|-----------------|-----------|-------------------|-----|--------|
| ProbeReport schema round-trips through storage | SPIKE-01 | Serialization round-trip | build ProbeReport → `JSON.stringify` → parse → deep-equal | unit | `npm test` | ✅ W0 | ⬜ pending |
| Persisted ProbeReport readable after restart | SPIKE-01 | Restart-survival (on-device) | probe → restart Discord → `__goofcrypt.diag()` + `/encrypt status` still show report | manual | on-device | ❌ | ⬜ pending |
| Candidate salt-acceptance + raw-32-byte output | SPIKE-02 | Byte-match vs noble (D-09) + output-shape | compare candidate 32 bytes to `deriveKey(VEC_PW, 19B salt)`; PHC/16-byte-salt mismatch ⇒ not-compatible | unit (ref) + manual (device) | `npm test` (ref logic) | ❌ W0 | ⬜ pending |
| Armed-flag crash detection works | SPIKE-02 | Force-crash survival (on-device) | set armed flag → force-quit → relaunch → flag persisted, candidate marked crashed (A1) | manual | on-device | ❌ | ⬜ pending |
| `nextTick` is the macrotask form | SPIKE-03 | Runtime `.toString()` assertion | assert `nextTick.toString()` is not the microtask empty-async-arrow form (catches caret regression) | unit + manual | `npm test` | ✅ W0 | ⬜ pending |
| Sync-derive never reaches a Discord thread | SPIKE-03 | Static import-graph audit (DONE) + build guard | recorded grep audit; new `build.mjs` guard fails build on any `discord → core/stegcloak` value import | build gate | `npm run build` | ✅ | ⬜ pending |
| Yield-count / freeze evidence is real | SPIKE-03 | Measured, not assumed | `setInterval(0)` sampler + bench first-yield / longest-block ms; zero samples in 10s ⇒ thread starved | manual + build | on-device (timing); `npm run build` (compiles) | ❌ | ⬜ pending |
| `LOAD_MESSAGES_SUCCESS` storm observed | SPIKE-03 | Concurrency count on real path | count concurrent `backgroundDecrypt` launches + re-dispatch fan-out on real cold channel open | manual | on-device | ❌ | ⬜ pending |
| GREEN/RED verdict is honest | SPIKE-04 | Verdict gated on byte-match (D-09) | committed verdict cites byte-match; GREEN impossible without passing 32-byte match for a 19-byte salt | doc + ref | `npm test` (ref key) | ✅ | ⬜ pending |
| Byte-compat harness stays green | COMPAT-01 | CI harness (hard gate) | every change keeps `npm test` green; spike touches no crypto primitive | regression | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/harness.ts` — add a **ProbeReport serialization round-trip** assertion (build → stringify → parse → deep-equal) so the schema's persistability is CI-tested off-device.
- [ ] `tests/harness.ts` — add a **`nextTick` macrotask-form assertion** (import the patched `nextTick`, assert `.toString()` is not the microtask form) so the caret regression fails CI, not just on-device.
- [ ] `tests/harness.ts` — add a **D-09 reference-key vector** assertion (`deriveKey(VEC_PW, "1234567890123456789")` equals a committed 32-byte expected value cross-checked against stegcloak-rs) so the on-device byte-match has a CI-proven target. *(Overlaps Phase-2 GATE-01 — coordinate; Phase 1 needs only the reference key value, not the full structural gate.)*
- [ ] `scripts/build.mjs` — add `metafile: true` to the esbuild call + the sync-derive import-graph guard (D-07).
- [ ] No framework install needed — the custom runner already exists.

---

## Manual-Only Verifications

> A diagnosis spike is inherently on-device-evidence heavy. These cannot be
> automated in CI (no native module / real Hermes timing in the Node runner).

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ProbeReport survives a Discord restart | SPIKE-01 | persistence flush is a runtime property of `plugin.storage` on-device | Run probe → fully restart Discord → run `__goofcrypt.diag()` and `/encrypt status`; report must still render. |
| Armed-flag survives a hard native crash | SPIKE-02 | depends on storage flush timing before a native call (A1) | Set armed flag → trigger candidate → force-quit during call → relaunch → confirm flag persisted and candidate marked `crashed/unsafe`. |
| Real first-encrypt / `LOAD_MESSAGES_SUCCESS` freeze timing | SPIKE-03 | real Hermes thread timing is not reproducible in the Node runner | Open a cold channel with N cloaked messages + send first encrypt; record yield-count samples, first-yield ms, longest-block ms, concurrent `backgroundDecrypt` count. |
| Candidate native Argon2 reachability + real-param run | SPIKE-02 | no native module exists in CI | On primary device, run `/encrypt diag --test`; record per-candidate {reachable, salt-accepted, output-kind, byte-match, timing, armed/crashed}. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (or a Manual-Only row above with on-device instructions)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (harness round-trip, nextTick assertion, D-09 vector, build guard)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s (off-device)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
