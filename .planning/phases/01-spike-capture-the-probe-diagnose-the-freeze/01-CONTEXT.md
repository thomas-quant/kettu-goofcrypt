# Phase 1: Spike — capture the probe + diagnose the freeze - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

A **diagnosis spike**, not a feature build. It settles the milestone's two central unknowns with on-device *evidence* and commits a written verdict:

1. **Native reachability** — is any byte-compatible native Argon2 actually reachable on-device, accepting a real ~19-byte channelId salt and returning a raw 32-byte key? (SPIKE-01, SPIKE-02)
2. **Freeze root cause** — why does first-encrypt still freeze despite the existing async + macrotask-yield path? (SPIKE-03)
3. **Verdict** — a written GREEN/RED native-feasibility verdict that gates whether Phase 4 ever runs. (SPIKE-04)

**Deliverables:** a persisted, restart-survivable `ProbeReport`; recorded per-candidate salt/output test results; an evidence-backed freeze root cause; a committed GREEN/RED verdict.

**Explicitly NOT in this phase (belongs elsewhere — do not build here):**
- The `crypto/nativeArgon.ts` injected registry and the structural byte-equality vector gate → **Phase 2**.
- The actual freeze *fix*, seamless key-sync, warming, and the production `/encrypt status`/`bench` UX → **Phase 3**.
- Wiring a native engine into `deriveKeyAsync` → **Phase 4** (conditional on a GREEN verdict).
- Changing the KDF algorithm/params/salt or the wire format → out of scope for the whole milestone (breaks GoofCord byte-compat).

</domain>

<decisions>
## Implementation Decisions

### Probe disposition & lifecycle (SPIKE-01)
- **D-01:** Build the probe as **permanent code** — `src/discord/nativeProbe.ts` (discord layer, the only code allowed to touch `vendetta.*`/`nativeModuleProxy`/metro). It enumerates the native surface, builds a **structured `ProbeReport`**, persists it, and surfaces it via `__goofcrypt.diag()` and `/encrypt status`. This is the opposite of the current fire-and-forget `diagnose2.txt`. Phase 4 reuses this module to build/inject the candidate adapter.
- **D-02:** **Refresh strategy:** probe automatically on plugin load **when there's no report or the stored Discord/Hermes build tag changed**; persist the result. Also expose a **manual re-probe trigger** (e.g. a `/encrypt diag --probe` subcommand) to force a fresh scan after a Discord update. Enumeration is cheap (object-key scans only — no Argon2), so this is low-cost.
- **D-03:** The **on-load probe does enumeration only** (safe surface scans). It never *invokes* native crypto — invocation is a separate, manual, guarded step (see D-05).

### Candidate-call depth & safety (SPIKE-02)
- **D-04:** **Tiered candidate invocation.** First call a reachable Argon2 candidate with **cheap params (m=8KiB, t=1)** purely to learn API shape: does it accept a real ~19-byte channelId salt? does it return raw bytes or a PHC string? does it throw? **Only if the shape passes**, do **one** run at the real `m=65536 KiB (64 MiB), t=3, p=1, v0x13, dkLen=32` to confirm it doesn't OOM/choke and to capture rough timing.
- **D-05:** **Crash safety — manual trigger + armed-flag poison detection.** Candidate *invocation* runs only on an explicit command (e.g. `/encrypt diag --test`), never automatically on load — a crash is then user-initiated and reproducible, not a launch crash-loop. Before each native call, persist an `armed: <candidateName>` flag in `plugin.storage`; clear it on return. On next load, a still-set armed flag means that candidate hard-crashed last time → record it as **`crashed/unsafe`** and skip it. Layer in `try/catch` for JS-level throws and a timeout race for hangs.

### Freeze-diagnosis method (SPIKE-03)
- **D-06:** **Evidence from both sources.** (a) Instrument the **real** `deriveKeyAsync`/flux path — yield-counter, timestamps, and a runtime `nextTick.toString()` assertion that noble's `nextTick` is the **macrotask** (`setTimeout`) form, not a microtask — so a genuine first-encrypt and the `LOAD_MESSAGES_SUCCESS` concurrency storm are observed as they actually occur. (b) Add a **controlled `/encrypt bench`** that reproduces one derivation cleanly for first-yield / longest-block numbers. The storm only shows on the real path; the bench gives reproducible figures.
- **D-07:** **Sync-`deriveKey` audit = recorded audit + permanent build guard.** Do the one-time import-graph audit now (is the synchronous `deriveKey` via `core/stegcloak.ts` reachable from any `src/discord/` hot path?) and write the finding into the verdict. **Plus** add a **build-time assertion in `scripts/build.mjs`** that fails the build if anything under `src/discord/` (transitively, on the hot path) imports the sync `deriveKey` / `core/stegcloak.ts` sync pipeline — mirroring the existing class/generator/iterator regex gates. A sync-derive leak is exactly the regression that silently re-freezes; the structural guard stops recurrence.
- **D-08:** **Instrumentation is kept**, as the seed of the Phase-3 OBS-02 (`/encrypt bench` per path) and OBS-01 (`/encrypt status` shows live path) requirements — so Phase 3 hardens rather than recreates. **Hot-path live instrumentation** (yield-counter on the real `deriveKeyAsync`) sits **behind a debug flag** so it adds zero overhead in normal use.

### Verdict bar & device coverage (SPIKE-04)
- **D-09:** **GREEN requires shape-pass AND a provisional byte-match.** A GREEN verdict needs: reachable candidate + accepts the real ~19-byte channelId salt + returns a raw 32-byte key **AND** those 32 bytes **byte-match a reference key derived by the trusted `@noble/hashes` path** for the same `(password, channelId)`. This catches the "wrong-32-bytes" failure (e.g. silent salt padding/truncation) at spike time instead of activating Phase 4 on a false positive. It does **not** replace the Phase-2 structural gate — it only keeps the Phase-1 verdict honest. Anything short of this → **RED** (Phase 4 does not run; milestone ships on Phase 3 alone).
- **D-10:** **Device coverage = primary device, conclusive; other platform = untested/assume-RED.** Run the spike on the user's main device and record its OS + Discord/Hermes build tag in the `ProbeReport`. The verdict is authoritative for that platform; the other platform is explicitly marked "untested — treated as RED until probed." The persisted report makes re-running on a second device later trivial.

### Claude's Discretion
- **ProbeReport schema** — exact field layout (timestamp, build tag, enumerated module names, per-candidate {reachable, salt-accepted, output-kind, byte-match, armed/crashed} results) is the planner's call, as long as it is structured, persisted, and renderable by both `__goofcrypt.diag()` and `/encrypt status`.
- **Verdict document location/format** — a committed planning artifact (e.g. `01-VERDICT.md` in the phase dir, or a clearly-marked verdict section), as long as it states GREEN/RED explicitly and whether Phase 4 activates.
- **Where the noble reference key comes from** for the D-09 byte-match — on-device noble derivation (the plugin already has the sync `deriveKey`) vs a desktop-tool-derived reference — planner's choice; on-device is simplest.
- **Exact command surface** — whether the manual probe/test live as `/encrypt diag --probe`/`--test` subcommands or distinct verbs, provided they are discoverable and don't auto-invoke native crypto.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone intent & verdict basis (read first)
- `.planning/research/SUMMARY.md` — the RED-verdict research basis; the SPIKE→GATE→FALLBACKS shape, the five freeze root-cause candidates, and the "never trust unverified bytes" principle. **Highest-priority read.**
- `.planning/REQUIREMENTS.md` §"Spike & De-risking" — SPIKE-01..SPIKE-04 exact wording.
- `.planning/ROADMAP.md` §"Phase 1" — goal + 4 success criteria; §"Phase 4" for what a GREEN verdict unlocks.
- `.planning/PROJECT.md` §Context — the exact KDF params, the libsodium 16-byte-salt vs ~19-byte channelId blocker, and the three prior fix rounds.

### Research detail
- `.planning/research/STACK.md` — keep `@noble/hashes`, **pin exact** (drop the caret); why native is RED.
- `.planning/research/PITFALLS.md` — Pitfall 4 (still-freezes candidates) and Pitfall 5 (native fragility / silent wrong-bytes).
- `.planning/research/ARCHITECTURE.md` — the `nativeProbe.ts` (discord) → `nativeArgon.ts` (pure crypto) DI design, mirroring the `random.ts` precedent; build-order steps.
- `.planning/research/FEATURES.md` — persisted probe is P1/"unblocks everything".

### Codebase grounding
- `.planning/codebase/ARCHITECTURE.md` — layering (`discord → core → crypto/stego/util`), the sync-on-cache-hit/async-on-miss split, the "calling sync `deriveKey` on the hot path" anti-pattern.
- `.planning/codebase/CONCERNS.md` — the `LOAD_MESSAGES_SUCCESS` storm (per-message `backgroundDecrypt` coroutines), the noble `nextTick` build-patch fragility, the `_msgActions` stale-handle bug class.
- `diagnose2.txt` (repo root) — the existing fire-and-forget probe snippet; the starting point for `nativeProbe.ts` enumeration.

### Primary source files this spike touches/instruments
- `src/discord/nativeProbe.ts` — **NEW** (the probe + ProbeReport).
- `src/crypto/argon.ts` — `deriveKeyAsync` (Argon2id, `asyncTick:50`); instrument here.
- `src/discord/flux.ts` — `backgroundDecrypt`, the `LOAD_MESSAGES_SUCCESS` storm path.
- `src/discord/send.ts` — first-encrypt cold-path (cache-miss → fire-and-forget derive → reject).
- `src/discord/commands.ts` — `/encrypt` (status, bench, diag subcommands live here).
- `src/index.ts` — the `__goofcrypt` debug hook (`diag()`); onLoad probe wiring.
- `src/core/keycache.ts` — `deriveKey`, `pending` dedup Map, persisted store.
- `src/crypto/random.ts` — the existing DI-injection precedent for `nativeProbe → nativeArgon`.
- `src/core/stegcloak.ts` — the **sync** `deriveKey` consumer the build guard must keep off the hot path.
- `scripts/build.mjs` — the macrotask-yield patch + regex gates; add the sync-derive build guard here.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`__goofcrypt` debug hook** (`src/index.ts`, ~lines 56–65) — already exposes `diag()`; extend it to surface the persisted `ProbeReport`.
- **`/encrypt` slash command** (`src/discord/commands.ts`) — already has `status` and `bench` verbs; add the persisted-report rendering to `status` and the diagnosis bench to `bench`/a new `diag` verb.
- **`random.ts` DI precedent** (`src/crypto/random.ts`) — the discord-layer-resolves-then-injects-into-pure-crypto-layer pattern the native path will mirror (Phase 4); the probe is the discord-layer half.
- **`plugin.storage` reactive proxy** — the persistence target for the `ProbeReport` and the armed-flag; access via `settings()` accessors, never raw.
- **Sync `deriveKey`** (`src/crypto/argon.ts`) — available on-device for computing the D-09 noble reference key for the byte-match.

### Established Patterns
- **Strict layering** `discord → core → {crypto, stego, util}` — `nativeProbe.ts` is discord-layer; it must not be imported by core/crypto. No edge points up the graph.
- **`safe(label, fn)` init wrapper** (`src/index.ts:29`) — wrap the on-load probe so a probe failure can't break plugin init.
- **Hermes-safe build constraints** — no `class`, no generators, no `for...of` over Map/Set on hot paths, `Uint8Array` only; all new probe code must pass the existing `scripts/build.mjs` regex gates.
- **`noteError(kind, e)`** (`src/core/health.ts`) — silent-failure counters surfaced by `/encrypt status`; reuse for probe/candidate failures.

### Integration Points
- **onLoad** (`src/index.ts`) — where the missing/stale-triggered probe runs and the `__goofcrypt.diag()` hook is wired.
- **`/encrypt status` + `bench`** (`src/discord/commands.ts`) — where the report and the freeze numbers surface to the user on-device.
- **`scripts/build.mjs`** — where the permanent sync-`deriveKey`-on-hot-path build guard is added (alongside the class/generator/iterator checks).
- **`deriveKeyAsync` in `argon.ts`** — where the debug-flagged yield-counter instrumentation hooks in.

</code_context>

<specifics>
## Specific Ideas

- The catastrophic failure mode the verdict bar is designed against: a native (or imported) path that returns the **wrong 32 bytes silently** — CI stays green (it only exercises the JS path), mobile↔mobile self-consistency hides it, and only real GoofCord interop reveals the break after poisoned keys are persisted. Hence the D-09 byte-match-vs-noble GREEN bar.
- The user reports first-encrypt **still freezes** despite three prior fix rounds — so the diagnosis must be evidence-driven (instrument, don't assume), and must specifically check whether the send path is reliably taking the async route at all.
- Pin `@noble/hashes` **exactly** — a caret bump can regress the build-time `nextTick` macrotask patch and silently re-freeze; the runtime `nextTick.toString()` macrotask assertion (D-06) is the on-device tripwire for that.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the spike's scope. (Phase 2's gate, Phase 3's freeze-fix/key-sync/UX, and Phase 4's native wiring were referenced as boundaries, not deferred new ideas; they already live in REQUIREMENTS.md and ROADMAP.md.)

</deferred>

---

*Phase: 1-Spike — capture the probe + diagnose the freeze*
*Context gathered: 2026-05-30*
