# Roadmap: GoofCrypt (mobile) — native-speed Argon2id milestone

## Overview

This is a **brownfield, de-risk-first** milestone on a working plugin. The goal is to kill the ~10s first-encrypt UI freeze while keeping byte-exact interop with GoofCord/stegcloak-rs (the non-negotiable core value). Research reached a strong RED verdict: a byte-compatible **native** Argon2 is almost certainly unreachable in the Hermes/Kettu sandbox (libsodium's public `crypto_pwhash` hardcodes a 16-byte salt vs the ~19-byte channelId salt; no WASM on Hermes; DAVE/MLS has no Argon2). So the milestone is shaped as **SPIKE → GATE → FALLBACKS**, with the native fast-path as a strictly-gated conditional branch that only runs if the spike verdict is GREEN. Phase 1 captures the never-recorded on-device probe output and diagnoses the freeze. Phase 2 builds the byte-equality verification machinery FIRST — a committed KDF test vector, a CI assertion, and an unbypassable on-load self-check + path quarantine — because no derivation path may ever produce a real key until it reproduces that vector. Phase 3 is the **primary deliverable**: it actually fixes the freeze and hardens seamless key-sync, shipping regardless of the spike verdict. Phase 4 is the conditional native fast-path, gated behind Phase 2 and activated only if Phase 1's verdict is GREEN.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Spike — capture the probe + diagnose the freeze** - Persist the on-device native-crypto probe, settle salt/raw-output reachability, diagnose why first-encrypt still janks, and record a GREEN/RED native verdict
- [ ] **Phase 2: Verification gate (built FIRST)** - Commit a real-length KDF test vector, assert it in CI, and add an unbypassable on-load byte-equality self-check + path quarantine before any native path can produce a key
- [ ] **Phase 3: Fallback delivery (primary deliverable)** - Actually fix the freeze, make key-sync seamless and safe, and surface the live derivation path — ships regardless of the spike verdict
- [ ] **Phase 4: Native fast-path (CONDITIONAL — only if Phase 1 verdict is GREEN)** - Wire a verified native Argon2 engine behind the Phase 2 gate, with try/catch fall-through to noble

## Phase Details

### Phase 1: Spike — capture the probe + diagnose the freeze

**Goal**: Settle the milestone's two central unknowns with evidence — (a) is any byte-compatible native Argon2 actually reachable on-device, and (b) why does first-encrypt still freeze despite the existing async + macrotask-yield path — and record a written GREEN/RED native verdict that gates Phase 4.
**Depends on**: Nothing (first phase)
**Requirements**: SPIKE-01, SPIKE-02, SPIKE-03, SPIKE-04
**Success Criteria** (what must be TRUE):

  1. A persisted `ProbeReport` enumerates the reachable native surface (`nativeModuleProxy`, TurboModules incl. DAVE/MLS/Sodium/Aes, `metro.findByProps` for `crypto_pwhash`/`argon2id`/`scrypt`, `crypto.subtle`) and is readable on-device via `__goofcrypt.diag()` and `/encrypt status` after a restart — unlike the current fire-and-forget `diagnose2.txt`
  2. For every reachable Argon2 candidate, a recorded on-device result states whether it accepts a real ~19-byte channelId salt AND returns a raw 32-byte key (not a PHC string) — or `none reachable` if there are no candidates
  3. The first-encrypt freeze has a written, evidence-backed root cause: yield-count instrumented on-device, a runtime assertion that noble's `nextTick` is the macrotask form, an import-graph audit proving no synchronous `deriveKey` reaches a Discord-thread path, and a check of the `LOAD_MESSAGES_SUCCESS` concurrency storm
  4. A written native-feasibility verdict (GREEN or RED) is committed to planning and explicitly states whether Phase 4 activates

**Plans**: 4 plansPlans:
**Wave 1**

- [ ] 01-01-PLAN.md — Wave-0 CI foundation: ProbeReport schema + settings fields, harness assertions (round-trip, nextTick macrotask, D-09 vector), sync-derive build guard

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Freeze instrumentation: parameter-injected debug yield/timing sampler + assertMacrotaskYield in argon.ts, debug-gated storm/cold-path observation in flux.ts/send.ts

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — Permanent nativeProbe.ts: surface enumeration + persisted ProbeReport, crash-safe tiered candidate test (D-09 byte-match), onLoad wiring + /encrypt diag verb + on-device evidence capture

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 01-04-PLAN.md — GREEN/RED verdict (gated on the D-09 byte-match) + evidence-backed freeze root cause + exact @noble/hashes pin

### Phase 2: Verification gate (built FIRST)

**Goal**: Build the single load-bearing safeguard — a byte-equality verification gate — BEFORE any native path can write a real key, so every wrong-32-bytes failure mode (salt length, params, version, output encoding, native correctness, key-sync determinism) is caught loudly in CI or on-device instead of silently poisoning interop.
**Depends on**: Nothing (pure tooling + gate scaffolding; hard predecessor to Phase 4)
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04, COMPAT-01
**Success Criteria** (what must be TRUE):

  1. A fixed `(password, real-length channelId) → expected 32-byte key` vector is committed, generated by the trusted `@noble/hashes`/desktop path and cross-checked against the stegcloak-rs WASM in the harness, so the expected key is provably correct and not a trusted typo
  2. The CI harness asserts the KDF vector and stays green; any future change to params, salt handling, base64, or the noble version that alters the output fails the build loudly
  3. An on-load byte-equality self-check exists: any candidate derivation path must reproduce the committed vector on-device before it may produce real keys, behind a `verified` flag that `injectNativeArgon` forcibly resets (structurally unbypassable — `nativeArgonReady()` = injected AND verified)
  4. Path quarantine holds: no unverified derivation path writes to the key cache; engine selection gates strictly on `verified` and falls through to the noble JS path otherwise — demonstrated by a deliberately-wrong injected adapter being rejected

**Plans**: TBD

### Phase 3: Fallback delivery (primary deliverable)

**Goal**: Solve the user-visible freeze for real and make seamless key-sync a trustworthy primary mitigation — the milestone's actual deliverable, shippable whether or not native ever lands. Apply the Phase 1 diagnosis, eliminate any synchronous derive on a Discord thread, hide cold-path latency, harden key-sync correctness, and make the live derivation path always visible.
**Depends on**: Phase 1 (applies the freeze diagnosis), Phase 2 (status reports the `verified` flag; key-sync round-trip reuses the committed vector)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04, SYNC-01, SYNC-02, SYNC-03, SYNC-04, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):

  1. First-encrypt-in-a-channel no longer freezes the UI: no synchronous Argon2 ever runs on a Discord-thread path, verified by on-device yield instrumentation (yield-count > 0, `nextTick` asserted as the macrotask form, noble pinned exactly), and the diagnosed fix from Phase 1 is applied (e.g. finer `asyncTick`, serialized cold-channel derivations)
  2. The cold path is non-blocking and proactive: a "deriving… / send again" feedback (never a blocking spinner) appears on a cold channel, and keys are warmed on channel switch and after Settings "Save" so the key is usually ready before the user sends
  3. Seamless key-sync works end-to-end: clipboard auto-detect of a `goofcrypt:`-prefixed bundle offers one-tap import; malformed bundles (bad base64, wrong nesting, non-ASCII) are rejected before writing instead of silently poisoning the cache; and the `base64.ts` non-ASCII bounds bug is fixed
  4. A key-sync round-trip harness test pins the `passwordId`/base64/sha256 determinism contract between `tools/derive-keys.mjs` and the plugin, reusing the Phase 2 vector
  5. Fallbacks are always loud: `/encrypt status` reports the live derivation path (`native(verified)` | `js` | `imported`) and the active RNG source, and `/encrypt bench` measures each available path using the real params (m=65536, t=3, p=1) including first-yield / longest-block latency

**Plans**: TBD

### Phase 4: Native fast-path (CONDITIONAL — only if Phase 1 verdict is GREEN)

**Goal**: Wire a native Argon2 engine that runs the same derivation at native speed — but ONLY if Phase 1's spike verdict was GREEN (a reachable Argon2 that accepts a ~19-byte salt and returns a raw 32-byte key; research rates this unlikely). The path is architecturally un-trustable until it passes the Phase 2 byte-equality gate on-device. **Activation condition: SPIKE-04 verdict = GREEN. If RED, this phase does not run and the milestone ships on Phase 3 alone.**
**Depends on**: Phase 1 (GREEN verdict required to activate), Phase 2 (the byte-equality gate is a HARD predecessor — native must never produce a real key before the gate exists)
**Requirements**: NATIVE-01, NATIVE-02
**Success Criteria** (what must be TRUE):

  1. The discord layer (`nativeProbe.ts`) injects a plain function into a pure crypto-layer registry (`nativeArgon.ts`) by dependency injection, with no layering violation (crypto never imports discord/vendetta)
  2. `deriveKeyAsync` uses the native engine **iff** it passed the on-device byte-equality gate (`nativeArgonReady()`), with try/catch fall-through to the noble JS path on any throw, non-32-byte result, or vector mismatch
  3. An unverified native key is never persisted or cached, and the CI byte-compatibility harness stays green throughout (it exercises the JS path; native is device-only and gated)

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (Phase 4 conditional on the Phase 1 GREEN verdict)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Spike — probe + freeze diagnosis | 0/4 | Planned | - |
| 2. Verification gate (built FIRST) | 0/TBD | Not started | - |
| 3. Fallback delivery (primary) | 0/TBD | Not started | - |
| 4. Native fast-path (conditional) | 0/TBD | Not started | - |
