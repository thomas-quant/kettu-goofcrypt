# Phase 1: Spike — capture the probe + diagnose the freeze - Research

**Researched:** 2026-05-30
**Domain:** On-device native-crypto surface enumeration + Argon2/macrotask-yield freeze diagnosis in a Kettu/Vendetta Discord-mobile (Hermes) plugin
**Confidence:** HIGH on the codebase mechanics, the sync-derive import-graph audit, and the freeze-instrumentation approach (all verified against source in this session); MEDIUM-LOW only on what the on-device probe will actually find (that unknown is exactly what this spike exists to settle)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

> Decisions D-01..D-10 are LOCKED. Research these; do not relitigate or offer alternatives to them.

**Probe disposition & lifecycle (SPIKE-01):**
- **D-01:** Build the probe as **permanent code** — `src/discord/nativeProbe.ts` (discord layer, the only code allowed to touch `vendetta.*`/`nativeModuleProxy`/metro). It enumerates the native surface, builds a **structured `ProbeReport`**, persists it, and surfaces it via `__goofcrypt.diag()` and `/encrypt status`. This is the opposite of the current fire-and-forget `diagnose2.txt`. Phase 4 reuses this module to build/inject the candidate adapter.
- **D-02:** **Refresh strategy:** probe automatically on plugin load **when there's no report or the stored Discord/Hermes build tag changed**; persist the result. Also expose a **manual re-probe trigger** (e.g. a `/encrypt diag --probe` subcommand) to force a fresh scan after a Discord update. Enumeration is cheap (object-key scans only — no Argon2), so this is low-cost.
- **D-03:** The **on-load probe does enumeration only** (safe surface scans). It never *invokes* native crypto — invocation is a separate, manual, guarded step (see D-05).

**Candidate-call depth & safety (SPIKE-02):**
- **D-04:** **Tiered candidate invocation.** First call a reachable Argon2 candidate with **cheap params (m=8KiB, t=1)** purely to learn API shape: does it accept a real ~19-byte channelId salt? does it return raw bytes or a PHC string? does it throw? **Only if the shape passes**, do **one** run at the real `m=65536 KiB (64 MiB), t=3, p=1, v0x13, dkLen=32` to confirm it doesn't OOM/choke and to capture rough timing.
- **D-05:** **Crash safety — manual trigger + armed-flag poison detection.** Candidate *invocation* runs only on an explicit command (e.g. `/encrypt diag --test`), never automatically on load — a crash is then user-initiated and reproducible, not a launch crash-loop. Before each native call, persist an `armed: <candidateName>` flag in `plugin.storage`; clear it on return. On next load, a still-set armed flag means that candidate hard-crashed last time → record it as **`crashed/unsafe`** and skip it. Layer in `try/catch` for JS-level throws and a timeout race for hangs.

**Freeze-diagnosis method (SPIKE-03):**
- **D-06:** **Evidence from both sources.** (a) Instrument the **real** `deriveKeyAsync`/flux path — yield-counter, timestamps, and a runtime `nextTick.toString()` assertion that noble's `nextTick` is the **macrotask** (`setTimeout`) form, not a microtask — so a genuine first-encrypt and the `LOAD_MESSAGES_SUCCESS` concurrency storm are observed as they actually occur. (b) Add a **controlled `/encrypt bench`** that reproduces one derivation cleanly for first-yield / longest-block numbers. The storm only shows on the real path; the bench gives reproducible figures.
- **D-07:** **Sync-`deriveKey` audit = recorded audit + permanent build guard.** Do the one-time import-graph audit now (is the synchronous `deriveKey` via `core/stegcloak.ts` reachable from any `src/discord/` hot path?) and write the finding into the verdict. **Plus** add a **build-time assertion in `scripts/build.mjs`** that fails the build if anything under `src/discord/` (transitively, on the hot path) imports the sync `deriveKey` / `core/stegcloak.ts` sync pipeline — mirroring the existing class/generator/iterator regex gates. A sync-derive leak is exactly the regression that silently re-freezes; the structural guard stops recurrence.
- **D-08:** **Instrumentation is kept**, as the seed of the Phase-3 OBS-02 (`/encrypt bench` per path) and OBS-01 (`/encrypt status` shows live path) requirements — so Phase 3 hardens rather than recreates. **Hot-path live instrumentation** (yield-counter on the real `deriveKeyAsync`) sits **behind a debug flag** so it adds zero overhead in normal use.

**Verdict bar & device coverage (SPIKE-04):**
- **D-09:** **GREEN requires shape-pass AND a provisional byte-match.** A GREEN verdict needs: reachable candidate + accepts the real ~19-byte channelId salt + returns a raw 32-byte key **AND** those 32 bytes **byte-match a reference key derived by the trusted `@noble/hashes` path** for the same `(password, channelId)`. This catches the "wrong-32-bytes" failure (e.g. silent salt padding/truncation) at spike time instead of activating Phase 4 on a false positive. It does **not** replace the Phase-2 structural gate — it only keeps the Phase-1 verdict honest. Anything short of this → **RED** (Phase 4 does not run; milestone ships on Phase 3 alone).
- **D-10:** **Device coverage = primary device, conclusive; other platform = untested/assume-RED.** Run the spike on the user's main device and record its OS + Discord/Hermes build tag in the `ProbeReport`. The verdict is authoritative for that platform; the other platform is explicitly marked "untested — treated as RED until probed." The persisted report makes re-running on a second device later trivial.

### Claude's Discretion

> Research options and recommend within these freedom areas.

- **ProbeReport schema** — exact field layout (timestamp, build tag, enumerated module names, per-candidate {reachable, salt-accepted, output-kind, byte-match, armed/crashed} results) is the planner's call, as long as it is structured, persisted, and renderable by both `__goofcrypt.diag()` and `/encrypt status`.
- **Verdict document location/format** — a committed planning artifact (e.g. `01-VERDICT.md` in the phase dir, or a clearly-marked verdict section), as long as it states GREEN/RED explicitly and whether Phase 4 activates.
- **Where the noble reference key comes from** for the D-09 byte-match — on-device noble derivation (the plugin already has the sync `deriveKey`) vs a desktop-tool-derived reference — planner's choice; on-device is simplest.
- **Exact command surface** — whether the manual probe/test live as `/encrypt diag --probe`/`--test` subcommands or distinct verbs, provided they are discoverable and don't auto-invoke native crypto.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within the spike's scope. The Phase-2 gate, Phase-3 freeze-fix/key-sync/UX, and Phase-4 native wiring are *boundaries*, not deferred new ideas; they already live in REQUIREMENTS.md and ROADMAP.md. **This spike is enumeration + instrumentation + verdict only:**
- NO `crypto/nativeArgon.ts` injected registry / byte-equality vector gate → **Phase 2**.
- NO freeze *fix*, seamless key-sync, warming, or production UX → **Phase 3**.
- NO wiring a native engine into `deriveKeyAsync` → **Phase 4** (conditional on GREEN).
- NO change to the KDF algorithm/params/salt or wire format → out of scope for the whole milestone (breaks GoofCord byte-compat).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPIKE-01 | A reusable on-device native-crypto probe enumerates the reachable native surface (`nativeModuleProxy`, TurboModules incl. DAVE/MLS/Sodium/Aes, `metro.findByProps` for `crypto_pwhash`/`argon2id`/`scrypt`, `crypto.subtle`), **persists** the result, and surfaces it via `__goofcrypt.diag()` and `/encrypt status` | "Native Enumeration Mechanics" (object-key-scan-only pattern, built on `diagnose2.txt`); "Persistence via plugin.storage" pattern; existing `__goofcrypt.diag()` hook (`index.ts:56-65`) and `/encrypt status` verb (`commands.ts:118`) are extension points |
| SPIKE-02 | For any reachable Argon2 candidate, an on-device test confirms whether it accepts a real ~19-byte channelId salt **and** returns a raw 32-byte key (not a PHC string) | "Candidate Invocation Shape Detection" (tiered cheap→real params, salt-acceptance test, raw-vs-PHC detection); "Armed-Flag Crash-Safety Pattern"; the 16-byte-salt blocker (Pitfall 1) is the specific failure to detect |
| SPIKE-03 | The first-encrypt freeze is diagnosed with evidence — yield-count instrumentation, runtime-assert noble's `nextTick` is the macrotask form, audit for any synchronous `deriveKey` reaching a Discord-thread path, and check the `LOAD_MESSAGES_SUCCESS` concurrency storm | "Freeze Instrumentation" (yield-counter on real `deriveKeyAsync`, `nextTick.toString()` assertion); **the sync-derive import-graph audit is COMPLETED in this research** (see Runtime State Inventory / Code Examples — `core/stegcloak.ts` is NOT value-imported anywhere in `src/`); the five freeze candidates from research/SUMMARY.md |
| SPIKE-04 | A written native-feasibility verdict (GREEN/RED) is recorded in planning and gates whether the conditional native phase runs | "The Verdict Decision Tree"; the D-09 byte-match GREEN bar; the D-10 device-coverage rule; "Validation Architecture" (how each verdict input is made trustworthy) |
</phase_requirements>

## Summary

This phase is a **diagnosis spike** — its deliverables are *evidence and a verdict*, not a feature. Three independent investigations run in parallel: (1) enumerate the on-device native-crypto surface into a persisted `ProbeReport` (replacing the fire-and-forget `diagnose2.txt`), (2) for any Argon2 candidate, test salt-acceptance + raw-output shape under a crash-safe armed-flag protocol, and (3) instrument the *real* async derivation path to prove why first-encrypt still freezes. The phase ends with a committed GREEN/RED native-feasibility verdict that gates Phase 4.

Two things are already settled by prior research and confirmed in this session, which sharply de-risks the spike. First, the **sync-derive import-graph audit (SPIKE-03's hardest sub-question) is already answerable**: `core/stegcloak.ts` — the only consumer of the *synchronous* `deriveKey` — is **not value-imported anywhere in `src/`** (verified by grep: `core/encrypt.ts` imports only the `RandomBytes` *type* from it; the value-level `hide`/`reveal` are called only by `tests/harness.ts`). So no `src/discord/` hot path reaches the sync 64 MiB derive today. The freeze is therefore *not* a sync-leak in the current tree — pushing the diagnosis toward the other four candidates (nextTick regression, coarse `asyncTick:50`, `LOAD_MESSAGES_SUCCESS` concurrency storm, front-loaded first pass). Second, the **`@noble/hashes` caret risk is real and concrete**: package.json pins `^1.7.1` while the lockfile resolves `1.8.0`, and the latest published version is `2.2.0` (a major bump that would break the build-time `nextTick` regex patch entirely) — making the D-06 runtime `nextTick.toString()` assertion a genuine tripwire, not a theoretical one.

The catastrophic failure mode the verdict bar defends against is a native (or imported) path that returns the **wrong 32 bytes silently** — CI stays green (JS-path only), mobile↔mobile self-consistency hides it, and only real GoofCord interop reveals the break after poisoned keys are persisted. Hence D-09's GREEN bar: shape-pass *and* a byte-match against a noble reference key for a real-length channelId salt. The realistic expected outcome (per all four prior research dimensions) is **RED** — libsodium's public `crypto_pwhash` hardcodes a 16-byte salt while the channelId is ~18–19 bytes, and the arbitrary-salt `argon2id_hash_raw` is not in the exported ABI.

**Primary recommendation:** Build `src/discord/nativeProbe.ts` as a permanent, layering-respecting discord-layer module that produces a persisted, schema'd `ProbeReport`; gate native *invocation* behind a manual command + armed-flag poison detection; instrument the real `deriveKeyAsync` behind a debug flag; add a build-time sync-derive guard to `scripts/build.mjs`; and commit a GREEN/RED verdict driven by the D-09 byte-match. Treat the probe output as a true unknown and design both branches — but plan for RED.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Native-surface enumeration (`nativeModuleProxy`/turbo/metro/`crypto.subtle`) | discord (`nativeProbe.ts`) | — | Discord layer is the *only* code allowed to touch `vendetta.*`/globals (D-01, strict layering `discord → core → crypto/stego/util`). Mirrors the `random.ts` host-access precedent. |
| ProbeReport persistence | discord → settings/storage | — | `plugin.storage` reactive proxy, accessed via `settings()` accessors (never raw); a `DEFAULTS` field round-trips it through the typed proxy. |
| ProbeReport rendering | discord (`commands.ts` `/encrypt status`, `index.ts` `__goofcrypt.diag()`) | — | Both are existing on-device readout surfaces; extend, don't recreate. |
| Candidate invocation (salt/output/crash test) | discord (`nativeProbe.ts`, manual command) | — | Touches native modules → must stay in discord layer; runs only on explicit `/encrypt diag --test` (D-05). |
| Armed-flag crash poison detection | discord → storage | — | Persisted flag set before/cleared after each native call; read on next load. |
| Yield-count / `nextTick` instrumentation | crypto (`argon.ts` `deriveKeyAsync`) | discord (debug-flag toggle, readout) | The derivation engine is a crypto-layer concern; instrumentation hooks where the work happens, gated by a debug flag so it's zero-overhead normally (D-08). |
| Freeze observation on real path | discord (`flux.ts` `LOAD_MESSAGES_SUCCESS` storm, `send.ts` cold path) | crypto (yield counter) | The concurrency storm only manifests on the real dispatch path; observe it where it occurs (D-06a). |
| Controlled reproducible bench | discord (`commands.ts` `/encrypt bench`) | crypto (`benchOnce`) | Clean single-derivation figures (first-yield/longest-block) come from the existing bench surface (D-06b). |
| Sync-derive build guard | build tooling (`scripts/build.mjs`) | — | Static import-graph assertion alongside the existing class/generator/iterator regex gates (D-07). |
| Noble reference key for byte-match | crypto (`argon.ts` sync `deriveKey`, already exists) | — | The D-09 byte-match reference; computable on-device (the plugin already ships sync `deriveKey`). |
| Verdict authoring | planning artifact (committed `.md`) | — | A committed GREEN/RED document gating Phase 4 (D-09, D-10). |

## Standard Stack

This is a diagnosis spike against an existing codebase. **No new runtime dependencies are recommended or needed.** The "stack" is the existing toolchain plus the host surfaces the probe enumerates.

### Core
| Library / Surface | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| `@noble/hashes` argon2id | `1.8.0` (lockfile) / `^1.7.1` (package.json) | The byte-compatible KDF being instrumented; sync `deriveKey` is the D-09 byte-match reference | The only path that reproduces the GoofCord derivation byte-for-byte. `[VERIFIED: package-lock.json resolves 1.8.0]` Latest npm is `2.2.0` (major) — do **not** bump. `[VERIFIED: npm registry dist-tags.latest = 2.2.0]` |
| esbuild | `^0.24.0` (`0.24.2` per CLAUDE.md) | Bundles `src/index.ts` as IIFE; hosts the `nextTick` macrotask patch plugin | Existing build pipeline; the sync-derive guard (D-07) plugs in here. `[CITED: scripts/build.mjs]` |
| `@swc/core` | `^1.10.0` (`1.15.40` per CLAUDE.md) | ES5 down-level so no `class` survives into Hermes `eval` | Existing pipeline; all new probe code must survive it. `[CITED: scripts/build.mjs]` |

### Supporting (host surfaces the probe enumerates — NOT dependencies)
| Surface | Access pattern | What the probe records |
|---------|----------------|------------------------|
| `globalThis.nativeModuleProxy` | enumerate keys, regex `crypt\|sodium\|nacl\|argon\|pwhash\|kdf\|scrypt\|pbkdf\|dave\|hash` | matched module names + key counts. `[CITED: diagnose2.txt]` |
| `globalThis.__turboModuleProxy` | call with candidate names (`Sodium`, `Aes`, `DCDDAVEManager`, `NativeMLS`, …) | for each hit, first 20 method names. `[CITED: diagnose2.txt]` |
| `vendetta.metro.findByProps` | probe `crypto_pwhash`, `argon2id`, `argon2`, `crypto_pwhash_ALG_ARGON2ID13`, `scrypt`, `pbkdf2`, `subtle`, `secretbox` | FOUND/no + first 10 method names. `[CITED: diagnose2.txt]` |
| `globalThis.crypto.subtle` | presence check | boolean. `[CITED: diagnose2.txt]` |
| `vendetta.plugin.storage` | persist `ProbeReport` + `armed` flag via `settings()` accessor | durable, restart-survivable capture. `[CITED: ARCHITECTURE.md, keycache.ts persistence pattern]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Permanent `nativeProbe.ts` module (D-01, LOCKED) | Re-running an ad-hoc `/eval` of `diagnose2.txt` | Fire-and-forget; output is lost on restart — the exact problem this spike fixes. Locked against by D-01. |
| On-device noble reference for D-09 byte-match (recommended) | Desktop-tool-derived reference (`tools/derive-keys.mjs`) | Desktop reference needs out-of-band transfer; on-device is simplest and the plugin already ships sync `deriveKey`. Planner's discretion per CONTEXT. |
| Manual-command native invocation (D-05, LOCKED) | Auto-invoke on load | A crash becomes a launch crash-loop instead of a reproducible user-initiated event. Locked against by D-05. |

**Installation:**
```bash
# No new runtime dependencies. The spike instruments existing code.
# One hygiene action the spike's findings will recommend (PITFALLS Pitfall 5 / D-06):
#   pin @noble/hashes EXACTLY (drop the caret ^1.7.1 → 1.8.0) so a minor bump
#   cannot silently regress the build-time nextTick macrotask patch.
# (The actual pin change is a one-line package.json edit; whether it lands in
#  Phase 1 or Phase 3 is the planner's call — PERF-02 owns it formally.)
```

**Version verification:** `@noble/hashes` lockfile-resolved version confirmed as `1.8.0` `[VERIFIED: package-lock.json]`; latest published is `2.2.0` `[VERIFIED: npm registry]`. The caret `^1.7.1` in package.json is the live risk the runtime `nextTick.toString()` assertion (D-06) guards against.

## Package Legitimacy Audit

> This phase installs **no external packages**. It instruments existing code and enumerates host-provided native surfaces (which are not npm packages and cannot be slopchecked — they are runtime modules inside Discord's app bundle). The Package Legitimacy Gate is therefore **not applicable**.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none — no installs in this phase) | — | — | — | — | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Note: the native modules the probe enumerates (`Sodium`, `Aes`, DAVE/MLS, etc.) are host-injected runtime objects, not installable packages. Their legitimacy is established by the byte-match gate (D-09), not by registry checks — a present-but-wrong native module is exactly the "wrong 32 bytes silently" threat the verdict bar defends against.*

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
                          │   Discord / Vendetta host (Hermes)          │
                          │   nativeModuleProxy · __turboModuleProxy    │
   on-load (enumerate ────┤   vendetta.metro.findByProps · crypto.subtle│
   only, D-03)            │   FluxDispatcher · plugin.storage           │
                          └───────────────┬─────────────────────────────┘
                                          │ (1) ENUMERATE keys only — no invoke
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  src/discord/nativeProbe.ts  (NEW, discord layer — only toucher of host)   │
   │                                                                            │
   │  probe()  ──► scan surfaces ──► build ProbeReport ──► persist to storage   │
   │                                       │                                    │
   │  testCandidate(name)  [manual /encrypt diag --test only, D-05]            │
   │     ├─ set storage.armed = name      (poison flag BEFORE call)            │
   │     ├─ cheap params (m=8KiB,t=1)  ── salt-accept? raw-vs-PHC? throws?      │
   │     ├─ IF shape passes: ONE real run (m=64MiB,t=3,p=1,v0x13,dkLen=32)     │
   │     ├─ byte-match vs noble reference key (D-09)                            │
   │     └─ clear storage.armed           (clear flag ON RETURN)               │
   └───────────────┬─────────────────────────────────────┬────────────────────┘
                   │ persist + render                     │ reads noble reference
                   ▼                                      ▼
   ┌─────────────────────────────┐         ┌──────────────────────────────────┐
   │ plugin.storage.nativeProbe   │         │  src/crypto/argon.ts              │
   │  { buildTag, candidates[],   │         │   deriveKey (sync) ── reference   │
   │    armed, verdict, … }        │         │   deriveKeyAsync ◄── INSTRUMENT   │
   │  → __goofcrypt.diag()         │         │     (yield-counter, nextTick      │
   │  → /encrypt status            │         │      assertion) behind debug flag │
   └─────────────────────────────┘         └──────────────────────────────────┘

   PARALLEL & INDEPENDENT — Freeze diagnosis (SPIKE-03):
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Real-path observation:                                                    │
   │    flux.ts LOAD_MESSAGES_SUCCESS ─► N backgroundDecrypt coroutines ─►       │
   │       keycache.deriveKey (ASYNC) ─► deriveKeyAsync ─► [yield counter]       │
   │    send.ts cold path ─► keycache.deriveKey (ASYNC) ─► reject+resend         │
   │  Controlled: /encrypt bench ─► benchOnce ─► first-yield / longest-block ms  │
   │  Static (DONE in this research): import-graph audit ─► sync deriveKey       │
   │     (core/stegcloak.ts) NOT reachable from src/discord/  ✔                  │
   │  Build guard (NEW in build.mjs): fail build if discord → stegcloak sync     │
   └──────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────┐
                          │  Committed VERDICT (GREEN/RED)│
                          │  gates Phase 4 activation     │
                          └─────────────────────────────┘
```

A reader can trace the primary spike use case: the probe enumerates the host surface on load → persists a ProbeReport → renders it on-device; a manual command invokes any Argon2 candidate under armed-flag protection, tests salt+output shape, and byte-matches against the noble reference; in parallel, the real derivation path is instrumented to count yields and assert `nextTick` is the macrotask form; all of it feeds a committed GREEN/RED verdict.

### Recommended Project Structure
```
src/
├── discord/
│   ├── nativeProbe.ts      # NEW: enumerate surface, build+persist ProbeReport,
│   │                       #      guarded manual candidate test (armed flag)
│   ├── commands.ts         # CHANGED: /encrypt status renders ProbeReport;
│   │                       #          new diag verb(s) for --probe / --test;
│   │                       #          /encrypt bench reports first-yield/longest-block
│   └── flux.ts             # OBSERVED (storm), optionally debug-flag counter hook
├── crypto/
│   └── argon.ts            # CHANGED: deriveKeyAsync gains debug-flagged yield-
│   │                       #          counter + nextTick.toString() assertion;
│   │                       #          benchOnce returns richer timing
├── settings.ts             # CHANGED: DEFAULTS gains nativeProbe + armed + debug fields
└── index.ts                # CHANGED: onLoad wires probe (when stale/missing);
                            #          __goofcrypt.diag() surfaces ProbeReport
scripts/
└── build.mjs               # CHANGED: + sync-derive import-graph build guard (D-07)
.planning/phases/01-…/
└── 01-VERDICT.md           # NEW (or a verdict section): GREEN/RED + Phase-4 gate
```

### Pattern 1: Object-Key-Scan-Only Enumeration (no invocation on load)
**What:** Enumerate the native surface by reading object keys and probing module presence — never *calling* a crypto function. This is the on-load path (D-03); it is cheap and crash-safe.
**When to use:** SPIKE-01 enumeration, every load when the report is missing or the build tag changed (D-02).
**Example:**
```typescript
// Source: built directly on diagnose2.txt (repo root) — enumeration logic.
// Discord layer only. All host access wrapped in try/catch (vendetta API is `any`-typed).
function enumerateSurface(): ProbeReport {
    const nmp: Record<string, any> = (globalThis as any).nativeModuleProxy || {};
    let keys: string[] = [];
    try { keys = Object.keys(nmp); } catch (e) { /* note */ }
    const re = /crypt|sodium|nacl|argon|pwhash|kdf|scrypt|pbkdf|dave|hash/i;
    const cryptoIsh = keys.filter((k) => re.test(k));

    const turbo = (globalThis as any).__turboModuleProxy;
    const cands = ["NativeCryptoModule","DCDCrypto","Sodium","NativeSodium","RNSodium",
                   "DCDSodiumManager","NativeDAVE","DCDDAVEManager","NativeMLS","Aes"];
    const turboHits: Array<{ name: string; methods: string[] }> = [];
    for (let i = 0; i < cands.length; i++) {
        const n = cands[i];
        let m: any;
        try { m = (turbo && turbo(n)) || nmp[n]; } catch (e) { /* skip */ }
        if (m) {
            let methods: string[] = [];
            try { methods = Object.keys(m).slice(0, 20); } catch (e) {}
            turboHits.push({ name: n, methods });
        }
    }

    const findByProps = (globalThis as any).vendetta?.metro?.findByProps;
    const probes = ["crypto_pwhash","argon2id","argon2","crypto_pwhash_ALG_ARGON2ID13",
                    "scrypt","pbkdf2","subtle","secretbox"];
    const metroHits: Array<{ prop: string; found: boolean; methods: string[] }> = [];
    for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        let mod: any;
        try { mod = findByProps?.(p); } catch (e) {}
        metroHits.push({ prop: p, found: !!mod, methods: mod ? Object.keys(mod).slice(0, 10) : [] });
    }

    const subtle = !!((globalThis as any).crypto && (globalThis as any).crypto.subtle);
    return { /* schema below */ scannedKeys: keys.length, cryptoIsh, turboHits, metroHits, subtle } as ProbeReport;
}
```
> **Note on `for...of` vs index loops:** the build down-levels `for...of` over arrays via `iterableIsArray:true`, but **iterating a `Map`/`Set` with `for...of` is unsafe** (the iterator-protocol lowering drops the first element under Discord's Hermes — see Pitfall below). Use **array index loops** in all new probe code, as shown. `[CITED: scripts/build.mjs:88-91, codebase/CONCERNS.md]`

### Pattern 2: Armed-Flag Poison Detection (crash-safe invocation, D-05)
**What:** Before any native crypto *call*, persist `armed: <candidateName>` to storage; clear it on return. On next load, a still-set flag means that candidate hard-crashed (took the whole app down before it could clear) → record it `crashed/unsafe` and skip it.
**When to use:** SPIKE-02 candidate invocation, run only on manual `/encrypt diag --test` (never on load).
**Example:**
```typescript
// Source: D-05 (CONTEXT.md). Persistence via settings() accessor — never raw storage.
async function testCandidate(name: string, fn: NativeArgonCandidate): Promise<CandidateResult> {
    // 1. POISON FLAG before the call — survives a hard native crash.
    settings().nativeProbeArmed = name;            // persisted immediately by the reactive proxy

    const result: CandidateResult = { name, reachable: true, saltAccepted: false,
                                      outputKind: "unknown", byteMatch: false, crashed: false };
    try {
        // 2. Cheap-params shape probe (m=8KiB, t=1) — learn shape without OOM risk (D-04).
        const shape = await withTimeout(fn(CHEAP_PARAMS, REAL_19B_SALT), 8000); // timeout race for hangs
        result.saltAccepted = shape != null;
        result.outputKind = classifyOutput(shape);  // "raw32" | "phc-string" | "other"
        // 3. Only if shape passes, ONE real run (D-04) + byte-match (D-09).
        if (result.outputKind === "raw32" && result.saltAccepted) {
            const real = await withTimeout(fn(REAL_PARAMS, REAL_19B_SALT), 30000);
            result.byteMatch = eqBytes(real, NOBLE_REFERENCE_KEY); // D-09 reference
        }
    } catch (e) {
        result.error = (e as Error)?.message ?? String(e);   // JS-level throw → caught, not fatal
    } finally {
        // 4. CLEAR the flag — reached only if the call did NOT hard-crash the app.
        settings().nativeProbeArmed = null;
    }
    return result;
}

// On load (D-05): a still-set armed flag ⇒ last test hard-crashed that candidate.
function reconcileArmedFlag(report: ProbeReport): void {
    const armed = settings().nativeProbeArmed;
    if (armed) {
        markCandidateCrashed(report, armed);   // record "crashed/unsafe", skip it
        settings().nativeProbeArmed = null;
    }
}
```
**Pitfall for this pattern:** the reactive `plugin.storage` proxy must actually flush the `armed` write to disk *before* the native call executes. Kettu's storage is a synchronous reactive proxy (writes land in the in-memory JSON object immediately and Kettu persists asynchronously) — for the poison flag to survive a hard crash it must be on disk before the call. **This is a MEDIUM-confidence assumption** (no documented flush guarantee for Kettu storage); the planner should treat "does the armed write actually persist synchronously" as a thing the spike itself verifies on-device (write flag → force-kill app → reload → confirm flag still set), and document the result. See Open Questions.

### Pattern 3: Debug-Flagged Hot-Path Instrumentation (D-08)
**What:** The yield-counter and timing on the *real* `deriveKeyAsync` live behind a debug flag so they add zero overhead in normal use, and so the instrumentation can be kept as the seed of Phase-3 OBS-01/OBS-02.
**When to use:** SPIKE-03 evidence-from-real-path (D-06a).
**Example:**
```typescript
// Source: src/crypto/argon.ts deriveKeyAsync (existing) + D-06/D-08.
// noble's argon2idAsync yields via `await nextTick()` after each processBlock when
// elapsed >= asyncTick. We can't count noble's internal yields directly, but we CAN:
//   (a) assert nextTick is the macrotask (setTimeout) form, and
//   (b) measure wall-time + first-yield latency around the call.
import { nextTick } from "@noble/hashes/utils"; // the patched symbol

export function assertMacrotaskYield(): { ok: boolean; form: string } {
    const src = String(nextTick);                       // .toString() the runtime function
    const isMicrotask = /async\s*\(\s*\)\s*=>\s*\{\s*\}/.test(src); // empty async arrow = microtask
    return { ok: !isMicrotask, form: src.slice(0, 80) };
}

export async function deriveKeyAsyncInstrumented(password: string, channelId: string) {
    if (!settings().debugInstrument) return deriveKeyAsync(password, channelId);
    const t0 = Date.now();
    let firstYield = -1;
    // Wrap nextTick via a counting shim is NOT possible (it's imported into noble's
    // closure at bundle time). Instead, measure macrotask cadence by sampling:
    //   record timestamps in a setInterval(0) and diff against derivation wall-time.
    const samples: number[] = [];
    const id = setInterval(() => { const t = Date.now() - t0; if (firstYield < 0) firstYield = t; samples.push(t); }, 0);
    try {
        const key = await deriveKeyAsync(password, channelId);
        return { key, totalMs: Date.now() - t0, firstYieldMs: firstYield, yieldSamples: samples.length, ...assertMacrotaskYield() };
    } finally { clearInterval(id); }
}
```
> **Honest caveat:** noble's internal `await nextTick()` count is not directly observable from outside the library (the yield happens inside noble's closure). The practical on-device proxy is: (1) `nextTick.toString()` assertion proves the *form* is macrotask (catches the regex-regression candidate), and (2) a `setInterval(0)` sampler measures whether macrotasks actually *fire* during the derivation (zero samples in a 10s derivation ⇒ the UI thread is starved ⇒ effectively frozen even if "async"). The bench (D-06b) gives the clean first-yield/longest-block figure. This is MEDIUM confidence on exact yield-count, HIGH confidence on the macrotask-form assertion and the "are macrotasks firing at all" signal.

### Anti-Patterns to Avoid
- **Auto-invoking native crypto on load:** turns a candidate crash into a launch crash-loop. Invocation is manual-only (D-05). Enumeration-only on load (D-03).
- **Caching a metro/native handle once and trusting it forever:** the codebase already has this bug class (`_msgActions` in `metro.ts` cached via `??=`, never invalidated — `[CITED: metro.ts:10, CONCERNS.md]`). The probe must resolve lazily and the manual test must re-resolve, not reuse a stale handle.
- **Gating on "found" instead of "byte-matched":** a present-but-wrong native module returns the wrong 32 bytes silently. The Phase-1 verdict's GREEN bar is byte-match (D-09), not presence.
- **`for...of` over a Map/Set in new probe code:** drops the first element under Discord's Hermes. Use array index loops. `[CITED: scripts/build.mjs, CONCERNS.md]`
- **Raw `plugin.storage` access:** always go through `settings()` accessors (the established anti-pattern guard). `[CITED: ARCHITECTURE.md anti-patterns]`
- **Leaving `__goofcrypt` on `globalThis` after unload** — pre-existing concern; if the spike extends the hook, also ensure `onUnload` cleanup is considered (Phase-3 owns the formal fix, but don't worsen it). `[CITED: CONCERNS.md]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| The noble reference key for D-09 byte-match | A fresh Argon2 implementation | The existing **sync** `deriveKey` in `crypto/argon.ts` | Already byte-compat (CI-proven against stegcloak-rs); already on-device; identical params. `[CITED: argon.ts:27]` |
| Byte-equality comparison | A custom comparator | The existing `eqBytes` in `selfTest.ts` | Index-loop, Hermes-safe, already used by the self-test. `[CITED: selfTest.ts:12]` |
| Base64 normalization of a native return value | `atob`/`Buffer`/`TextDecoder` | The existing `fromBase64` in `util/base64.ts` + the `coerce()` precedent in `random.ts` | No `Buffer`/`TextEncoder` in Hermes; `random.ts:coerce()` already handles `Uint8Array \| number[] \| base64-string` from native modules. `[CITED: random.ts:27-40]` |
| UTF-8 encode of password/salt | `TextEncoder` | The existing `utf8Encode` from `crypto/deflate.ts` | `TextEncoder` absent in Hermes; `utf8Encode` (fflate `strToU8`) is the established replacement. `[CITED: argon.ts:14, CLAUDE.md]` |
| Surface enumeration logic | A new probe from scratch | Extend `diagnose2.txt`'s proven scan | It already enumerates the exact surfaces SPIKE-01 names; D-01 says build `nativeProbe.ts` *on* it. `[CITED: diagnose2.txt]` |
| Persistence | A new storage layer | `plugin.storage` via `settings()` + a `DEFAULTS` field | Reactive proxy already persists JSON across restarts; keycache uses it the same way. `[CITED: keycache.ts, ARCHITECTURE.md]` |
| The macrotask-yield patch | Re-patching noble at runtime | The existing build-time `nextTick` patch + the runtime `.toString()` assertion | The patch is already in `build.mjs`; the spike's job is to *assert* it held, not redo it. `[CITED: build.mjs:29-42]` |

**Key insight:** Almost every primitive this spike needs already exists in the codebase, byte-compat-proven and Hermes-safe. The spike's net-new code is *enumeration + instrumentation + a build guard + a verdict* — it should compose existing functions, not reimplement crypto. The one genuinely new mechanism is the armed-flag poison detection (no precedent in the repo).

## Runtime State Inventory

> This spike adds new *persisted* state (the ProbeReport and the armed flag) and instruments existing runtime state. It is not a rename/refactor, but it touches persisted storage and module-level singletons, so the inventory is relevant.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **NEW:** `plugin.storage.nativeProbe` (the persisted ProbeReport) and `plugin.storage.nativeProbeArmed` (the poison flag). Must round-trip through the typed `settings()` proxy via a `DEFAULTS` entry. Existing `plugin.storage.keys` (the key cache) is **untouched** by this spike. | Add `nativeProbe` + `nativeProbeArmed` (+ a `debugInstrument` flag) to `settings.ts` `DEFAULTS` so they default cleanly and persist. No migration of existing data. |
| Live service config | **None** — no external service config. Discord/Hermes build tag is *read* (to detect staleness, D-02) and *recorded* in the report; it is not configuration this spike writes anywhere external. | Record build tag in ProbeReport. No external config touched. |
| OS-registered state | **None** — verified by inspection; the plugin registers nothing at OS level (no Task Scheduler, no launchd, no pm2). It is a single eval'd JS bundle. | None. |
| Secrets/env vars | **None** — verified by CLAUDE.md ("No `.env` files; no API keys; fully static delivery"). The armed flag and ProbeReport contain no secrets (no passwords, no derived keys — the byte-match result is a boolean, not the key bytes). | Ensure ProbeReport persists **no secret material** (module names + booleans + timing only), consistent with the existing `__goofcrypt.diag()` "non-secret only" rule. `[CITED: index.ts:54]` |
| Build artifacts | The build emits `site/index.js` + `site/manifest.json`. Adding the sync-derive guard to `build.mjs` (D-07) changes only build-time validation, not output shape. **`node_modules` is NOT currently installed** (verified this session) — CI runs `npm install` fresh, so the lockfile's `1.8.0` is what ships, but a local dev re-resolve under `^1.7.1` could drift. | The sync-derive guard runs at build time (no new artifact). The caret→exact pin recommendation protects the macrotask patch in the emitted bundle. |

**Nothing found in OS-registered state and secrets/env vars:** confirmed — the plugin has no OS registrations and no secrets beyond the user's passwords (which this spike does not read, store, or surface).

## Common Pitfalls

### Pitfall 1: The freeze is assumed to be a sync-derive leak — but the audit (done here) says it is NOT
**What goes wrong:** Planners assume SPIKE-03's answer is "a sync `deriveKey` reaches a Discord thread" and design the fix around that. The **completed import-graph audit contradicts this**: `core/stegcloak.ts` (the only sync-`deriveKey` consumer) is not value-imported anywhere in `src/`; both `flux.ts` and `send.ts` call `keycache.deriveKey` (the **async** one). So the current tree has no sync leak.
**Why it happens:** The sync `deriveKey` and async `deriveKeyAsync` share a name root; `flux.ts:53` literally reads `await deriveKey(channelId, pw)` — but that `deriveKey` is imported from `core/keycache` (async), not `crypto/argon` (sync). `[CITED: flux.ts:10, keycache.ts:81]`
**How to avoid:** The spike *records* the clean audit and adds the **build guard** so a *future* stray import is blocked. The live diagnosis should focus on the other four candidates: nextTick regression, coarse `asyncTick:50`, the `LOAD_MESSAGES_SUCCESS` storm, front-loaded first pass.
**Warning signs:** A plan that "fixes the sync leak" with no evidence one exists.

### Pitfall 2: `nextTick` macrotask patch silently regressed via the caret
**What goes wrong:** package.json pins `^1.7.1`; lockfile resolves `1.8.0`; latest is `2.2.0`. A re-resolve (e.g. `npm install` without a lockfile, or a deliberate bump) could ship a noble where the patched line changed → `nextTick` reverts to the microtask form → "async" derivation never yields to the renderer → **full freeze**. `[VERIFIED: package.json ^1.7.1, package-lock.json 1.8.0, npm registry latest 2.2.0]`
**Why it happens:** The build *throws loudly* if the regex misses the exact string `export const nextTick = async () => { };` — so a *bumped* noble fails the build. The silent path is subtler: if the bundle was last built against old noble and the lockfile drifted, or if a future noble keeps the line but changes yield semantics.
**How to avoid:** The D-06 runtime `nextTick.toString()` assertion is the on-device tripwire (asserts the macrotask form at runtime, not just build time). The spike adds this assertion; the formal exact-pin is PERF-02 (Phase 3) but the spike should recommend it.
**Warning signs:** Yield sampler shows zero macrotasks fired during a 10s derivation; `nextTick.toString()` matches the empty-async-arrow.

### Pitfall 3: The `LOAD_MESSAGES_SUCCESS` concurrency storm masquerades as single-derivation cost
**What goes wrong:** Opening a channel with N cloaked messages launches N `backgroundDecrypt` coroutines (guarded per-message-ID, not per-channel). `keycache.deriveKey` dedupes the actual Argon2 via the `pending` Map (so Argon2 runs once per (channel,password)), but N coroutines still contend and N `MESSAGE_UPDATE` re-dispatches fire together. The freeze on *first channel open* may be this storm, not one derivation. `[CITED: flux.ts:40-72, CONCERNS.md performance bottleneck]`
**Why it happens:** Deduplication operates at the Argon2 level but not at the coroutine/re-dispatch level.
**How to avoid:** The spike *observes* this on the real path (count concurrent `backgroundDecrypt` launches and re-dispatch fan-out) and records it. **The fix is Phase 3** (guard by channelId, batch re-dispatch) — Phase 1 only measures.
**Warning signs:** Freeze severity scales with the number of cloaked messages in the opened channel; bench (single derivation) is smooth but first real channel-open janks.

### Pitfall 4: The armed-flag write doesn't reach disk before the crash
**What goes wrong:** The poison flag (D-05) only works if `settings().nativeProbeArmed = name` is durably persisted *before* the native call runs. If Kettu's storage flushes asynchronously, a hard native crash could occur after the in-memory write but before the disk flush → the flag is lost → the candidate is retried and crashes again (the very crash-loop D-05 avoids).
**Why it happens:** Kettu's `plugin.storage` is a reactive proxy; the persistence timing (sync vs async flush) is undocumented.
**How to avoid:** The spike must **verify the flush behavior on-device** (write flag → force-quit → relaunch → confirm flag survived) and document it. If the flush is async-only, the planner needs a mitigation (e.g. a deliberate small delay or a storage `.save()` call if Kettu exposes one) before the candidate test is trustworthy. This is itself a spike finding.
**Warning signs:** A candidate that crashed the app once crashes it again on the next `/encrypt diag --test`.

### Pitfall 5: New probe code breaks the Hermes build gates
**What goes wrong:** New code uses `class`, generators, or `for...of` over a Map/Set, and either fails the `build.mjs` regex gates (loud, good) or — worse — passes the gate but breaks under Discord's Hermes (the first-element-drop bug). `[CITED: build.mjs:81-91, CONCERNS.md fragile areas]`
**Why it happens:** `nativeProbe.ts` will naturally want to iterate enumerated keys; the idiomatic `for...of` over an array is fine (covered by `iterableIsArray`), but iterating a `Map`/`Set` is not.
**How to avoid:** Module-level `let` + functions (like `random.ts`), array index loops, `Uint8Array` only, `utf8Encode`/`fromBase64` for any encoding. Run `npm run build` (which throws on violations) as part of the task's verification.
**Warning signs:** `npm run build` throws "class/generator/iterator survived"; or on-device, the first enumerated module is silently missing from the report.

## Code Examples

### The completed sync-derive import-graph audit (SPIKE-03 deliverable, verified this session)
```bash
# Source: grep audit run in this research session against the live tree.
# Question (D-07): does any src/discord/ hot path transitively import the SYNC
# deriveKey (crypto/argon.ts:27) via core/stegcloak.ts?

# 1. Who VALUE-imports core/stegcloak.ts (which calls sync deriveKey)?
$ grep -rn "from \".*stegcloak\"" src/ --include="*.ts" | grep -v "stego/zwc"
src/core/encrypt.ts:9:import type { RandomBytes } from "./stegcloak"   # TYPE-ONLY — erased at build

# 2. Who imports the sync deriveKey from crypto/argon (vs deriveKeyAsync)?
$ grep -rn "from \".*crypto/argon\"" src/ --include="*.ts"
src/core/stegcloak.ts:12:import { deriveKey } from "../crypto/argon"        # the ONLY sync consumer
src/core/keycache.ts:17:import { deriveKeyAsync } from "../crypto/argon"    # async (correct)
src/discord/commands.ts:9:import { benchOnce } from "../crypto/argon"       # bench only

# 3. Who calls the sync hide/reveal (which call sync deriveKey)?
#    → only tests/harness.ts (off-device CI). NOT src/discord/.

# CONCLUSION (HIGH confidence): the sync deriveKey is reachable ONLY through
# core/stegcloak.ts's hide/reveal, which are called ONLY by the test harness.
# No src/discord/ hot path reaches it. The first-encrypt freeze is NOT a sync leak
# in the current tree. The build guard (D-07) makes this invariant permanent.
```

### Sketch: the sync-derive build guard (D-07) for `scripts/build.mjs`
```javascript
// Source: pattern mirrors the existing class/generator/iterator regex gates in
// scripts/build.mjs:81-91. Add AFTER the esbuild bundle, BEFORE swc.
// Approach: walk esbuild's metafile import graph; fail if any module under
// src/discord/ transitively reaches src/core/stegcloak.ts via a VALUE import.
//
// esbuild gives us `metafile: true` → result.metafile.inputs[path].imports[].
// A type-only import (import type {...}) is already erased by esbuild and will
// NOT appear as a value import in the metafile — so encrypt.ts's `import type
// { RandomBytes }` correctly does not trip the guard.

const meta = result.metafile;                       // requires metafile:true in build()
function reachesSyncDerive(entry, seen = new Set()) {
    if (seen.has(entry)) return false;
    seen.add(entry);
    if (/src[\\/]core[\\/]stegcloak\.ts$/.test(entry)) return true;
    const imports = meta.inputs[entry]?.imports ?? [];
    for (let i = 0; i < imports.length; i++) {
        if (reachesSyncDerive(imports[i].path, seen)) return true;
    }
    return false;
}
const discordEntries = Object.keys(meta.inputs).filter((p) => /src[\\/]discord[\\/]/.test(p));
for (let i = 0; i < discordEntries.length; i++) {
    if (reachesSyncDerive(discordEntries[i])) {
        throw new Error(`sync-derive leak: ${discordEntries[i]} transitively imports core/stegcloak.ts (sync 64MiB derive) — would re-freeze the UI`);
    }
}
```
> **Verification note:** the current build does **not** pass `metafile: true` to esbuild (`[CITED: build.mjs:45-60]`); the guard task must add it. esbuild erases `import type` before the metafile is produced, so the type-only `RandomBytes` import in `encrypt.ts` will not be a false positive — but the planner should add a regression test confirming the guard *would* fire if a value import were added. `[ASSUMED]` (esbuild type-erasure-before-metafile behavior is standard but should be confirmed during implementation.)

### Real-length salt for the D-09 byte-match (already in the harness)
```typescript
// Source: tests/harness.ts:35 — the harness already uses a 19-byte snowflake salt.
const CHANNEL = "1234567890123456789"; // snowflake-shaped salt (19 bytes)
// → The D-09 noble reference key is: deriveKey(VEC_PW, CHANNEL) for this exact
//   19-byte salt. A native candidate that only accepts a 16-byte salt will either
//   throw or (worse) silently coerce → byte-mismatch → RED. The real-length salt
//   is what makes the byte-match meaningful (Pitfall 1 from PITFALLS.md).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget `diagnose2.txt` `/eval` snippet (output lost on restart) | Permanent `nativeProbe.ts` building a persisted, restart-survivable `ProbeReport` | This phase (D-01) | The milestone can finally *conclude* the native decision from durable on-device evidence |
| `@noble/hashes ^1.7.1` (caret) | Pin exact `1.8.0` to protect the macrotask patch | Recommended now; formal in PERF-02 (Phase 3) | A caret bump silently re-freezes; the runtime `nextTick` assertion is the tripwire |
| Assume the freeze is a sync-derive leak | Evidence-driven: sync-leak audit is clean; investigate the other four candidates | This phase (D-06, D-07) | Stops the plan from "fixing" a non-existent bug |
| Gate native on "module found" | Gate on byte-match vs noble reference (D-09) | This phase | Catches the silent wrong-32-bytes failure before Phase 4 |

**Deprecated/outdated:**
- The notion that any *public* libsodium API can reproduce the GoofCord derivation — RED, because `crypto_pwhash` hardcodes a 16-byte salt and `argon2id_hash_raw` (arbitrary salt) is not in the exported ABI. `[CITED: research/STACK.md, libsodium source]`
- Treating DAVE/MLS as a likely Argon2 source — DAVE is A/V E2EE (MLS + HKDF/MLS-Exporter + scrypt), no password Argon2. `[CITED: research/STACK.md, daveprotocol.com]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Kettu's `plugin.storage` reactive proxy flushes the `armed` flag to disk synchronously (or fast enough) before a native call runs | Pattern 2 / Pitfall 4 | If async-only, the poison flag can be lost on a hard crash → the crash-loop D-05 is meant to prevent. **The spike must verify this on-device.** |
| A2 | esbuild erases `import type {...}` before producing the metafile, so the type-only `RandomBytes` import in `core/encrypt.ts` will not false-trip the D-07 build guard | Code Examples (build guard) | If type imports appear in the metafile, the guard needs to filter them explicitly. Confirm during implementation; add a regression test. |
| A3 | The on-device probe will likely find **no reachable Argon2 with arbitrary-salt raw output** (verdict → RED) | Summary / State of the Art | This is the *expected* outcome per all prior research, but it is precisely the unknown the spike settles. Plan both branches; design for RED. |
| A4 | noble's internal `await nextTick()` yield count is not directly observable from outside the library; the `setInterval(0)` sampler + `nextTick.toString()` assertion are the practical on-device proxies | Pattern 3 | If a cleaner hook exists (e.g. a noble option), the instrumentation could be more precise. The proxies are sufficient to distinguish "macrotasks firing" from "thread starved". |
| A5 | The Discord/Hermes build tag is reachable for the staleness check (D-02) — likely via a metro module or a `vendetta` field | Summary / D-02 | If no stable build tag is reachable, the staleness trigger needs an alternate signal (e.g. a manual re-probe only). The spike confirms reachability. |

**These five `[ASSUMED]` claims should be confirmed during the spike itself** — three of them (A1, A4, A5) are *findings the spike produces*, which is appropriate for a diagnosis spike. A2 is an implementation detail to verify when building the guard.

## Open Questions (SPIKE DELIVERABLES — resolved during execution)

> These are not pre-planning blockers. For a diagnosis spike, several open
> questions ARE the product: the spike's job is to settle them with on-device
> evidence. Each is mapped to the plan task that resolves it.

1. **Does the armed-flag write survive a hard native crash? (A1)** — *Resolved by: 01-03 Task 4 (on-device force-quit evidence checkpoint).*
   - What we know: Kettu storage is a reactive proxy that persists JSON; the keycache relies on it surviving restarts.
   - What's unclear: whether a write is on disk *before* the next synchronous statement runs, or flushed asynchronously.
   - Recommendation: Make this an explicit spike sub-task — write flag, force-quit, relaunch, check. Document the answer. If async-only, find Kettu's flush/save call or accept a small pre-call delay.

2. **Is a stable Discord/Hermes build tag reachable for the D-02 staleness trigger? (A5)** — *Resolved by: 01-03 Task 1 (probe scans for it) + Task 4 (on-device confirmation).*
   - What we know: D-02 wants to re-probe when the build tag changes.
   - What's unclear: where the build tag lives (a metro module? a `vendetta` field? `nativeModuleProxy`?).
   - Recommendation: The probe scans for it; if none is reliably reachable, fall back to manual-only re-probe (`/encrypt diag --probe`) and note it in the verdict.

3. **Where does the D-09 noble reference key come from — on-device or desktop? (Claude's discretion)** — *Resolved: on-device (decided here; implemented in 01-03 Task 1).*
   - What we know: the plugin already ships sync `deriveKey`; the harness already uses a 19-byte salt.
   - Recommendation: **On-device** (simplest, self-contained). Derive `deriveKey(VEC_PW, "1234567890123456789")` on-device and compare the candidate's output to it. No desktop round-trip needed for the Phase-1 verdict.

4. **Does the build's `for...of`-over-array assumption hold for the probe's enumeration loops?** — *Resolved: use array index loops (decided here; enforced in 01-03 Task 1 acceptance + build gate).*
   - What we know: `iterableIsArray:true` covers arrays; Map/Set iteration is unsafe.
   - Recommendation: Use array index loops in all new probe code (shown in Pattern 1). The on-device self-test already guards the array case.

## Environment Availability

> The spike's "environment" is the on-device Discord/Hermes runtime, which cannot be probed from this dev machine — that is the entire point of the spike. The dev-side toolchain is what gates *building* the spike code.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build + test harness | ✓ (CI pins 24; min 18) | — | — |
| `@noble/hashes` | reference key + instrumentation target | lockfile ✓ | `1.8.0` (lockfile); `^1.7.1` (package.json) | — (do not bump to 2.x) |
| esbuild / swc | build pipeline + metafile for D-07 guard | ✓ (dev deps) | `^0.24.0` / `^1.10.0` | — |
| stegcloak-rs WASM | CI byte-compat harness (must stay green) | ✓ (github source dep) | commit-pinned | — |
| `node_modules` (installed) | local build/test | ✗ **NOT currently installed** | — | `npm install` (CI does this fresh; lockfile → 1.8.0) |
| On-device Discord/Hermes runtime | ALL probe/invocation/freeze evidence | ✗ (by nature — dev machine cannot probe it) | — | None — the user runs the spike on their primary device (D-10) |
| Discord/Hermes native crypto modules | SPIKE-01/02 enumeration + invocation | **UNKNOWN** (this is what the spike settles) | — | RED branch: fall back to Phase 3 (key-sync + freeze fix); native never wired |

**Missing dependencies with no fallback:**
- The on-device runtime evidence cannot be produced off-device. The spike's deliverables are inherently on-device; the planner must structure tasks so the *code* is built/verified in CI but the *evidence* is gathered by the user on their device, then recorded into the verdict.

**Missing dependencies with fallback:**
- `node_modules` not installed locally — `npm install` restores the lockfile-pinned `1.8.0`. CI already does this on every run.
- Native crypto unreachable on-device (expected) — the RED branch is the planned-for primary outcome; the milestone ships on Phase 3 regardless.

## Validation Architecture

> `nyquist_validation` is enabled. This section describes how each spike *deliverable* is made **trustworthy** — i.e., how we know the evidence isn't lying. For a diagnosis spike, "validation" means: how do we prove the ProbeReport persisted, the candidate result is correct, the freeze claim is measured (not assumed), and the verdict is honest.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom Node test runner — `scripts/test.mjs` esbuild-bundles `tests/harness.ts` (with the `.wasm` loader) and runs it under Node. **No Jest/Vitest.** `[CITED: scripts/test.mjs, CLAUDE.md]` |
| Config file | none — the runner is the script itself (`scripts/test.mjs`) |
| Quick run command | `npm test` (runs the full byte-compat harness; fast — pure JS + WASM) |
| Full suite command | `npm test && npm run build` (harness green + Hermes-safe build gates pass) |

### Phase Requirements → Validation Map
Because this is a diagnosis spike, most deliverables are validated by **on-device evidence + a restart-survival or byte-match check**, not by a unit test. The table maps each deliverable to its trust mechanism.

| Req ID | Deliverable | Validation Type | How trust is established | Automatable in CI? |
|--------|-------------|-----------------|--------------------------|--------------------|
| SPIKE-01 | Persisted ProbeReport readable after restart | **Restart-survival test** (on-device) | Run probe → restart Discord → `__goofcrypt.diag()` + `/encrypt status` still show the report. Distinguishes "persisted" from "in-memory only" (the `diagnose2.txt` failure). | ❌ on-device manual; ✅ the schema's serialize/deserialize round-trip CAN be unit-tested off-device |
| SPIKE-01 | ProbeReport schema round-trips through storage | **Serialization round-trip test** | Unit test: build a ProbeReport → JSON.stringify → parse → deep-equal. Add to harness. | ✅ Wave 0 |
| SPIKE-02 | Candidate salt-acceptance + raw-32-byte output result | **Byte-match vs noble reference (D-09)** + output-shape classification | For any candidate, compare its 32 bytes to `deriveKey(VEC_PW, 19B_salt)`. A 16-byte-salt-coercing module mismatches → correctly reported as not-compatible. PHC-string output is caught by "is it exactly 32 raw bytes". | ❌ on-device (no native module in CI); ✅ the reference-key derivation + `eqBytes` logic is unit-testable |
| SPIKE-02 | Armed-flag crash detection works | **Force-crash survival test** (on-device) | Set armed flag → force-quit → relaunch → confirm flag persisted and candidate marked crashed (validates Pitfall 4 / A1). | ❌ on-device manual |
| SPIKE-03 | `nextTick` is the macrotask form | **Runtime `.toString()` assertion** | Assert `nextTick.toString()` does not match the empty-async-arrow microtask form. Catches the caret regression. | ✅ can assert in harness AND on-device |
| SPIKE-03 | Sync-derive does not reach a Discord thread | **Static import-graph audit (DONE here) + build guard** | The grep audit is recorded; the new `build.mjs` guard fails the build if a `discord → core/stegcloak` value import is ever added. Self-validating going forward. | ✅ build guard runs in CI on every build |
| SPIKE-03 | Yield-count / freeze evidence is real | **Measured, not assumed** — `setInterval(0)` sampler + bench first-yield/longest-block | On-device: zero macrotask samples during a 10s derivation ⇒ thread starved. Bench gives reproducible first-yield ms. | ❌ on-device (real Hermes timing); ✅ the instrumentation code compiles/builds clean |
| SPIKE-03 | `LOAD_MESSAGES_SUCCESS` storm observed | **Concurrency count on real path** | Count concurrent `backgroundDecrypt` launches + re-dispatch fan-out on a real cold channel open with N cloaked messages. | ❌ on-device |
| SPIKE-04 | GREEN/RED verdict is honest | **Verdict gated on byte-match (D-09), not presence** | The committed verdict cites the byte-match result; GREEN is impossible without a passing 32-byte match against the noble reference for a 19-byte salt. | ✅ the verdict references a CI-verifiable reference key |
| COMPAT-01 | Byte-compat harness stays green | **CI harness (the hard gate)** | Every change keeps `npm test` green; the spike touches no crypto primitives, so the harness should be unaffected. | ✅ CI |

### Sampling Rate
- **Per task commit:** `npm test` (byte-compat harness — must stay green; the spike must not regress interop) + `npm run build` (Hermes-safe gates: class/generator/iterator + the new sync-derive guard).
- **Per wave merge:** `npm test && npm run build` (full off-device suite green).
- **Phase gate:** Full off-device suite green **AND** the on-device evidence gathered (ProbeReport persisted+restart-survived, candidate tested if any reachable, freeze instrumented, verdict committed) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/harness.ts` — add a **ProbeReport serialization round-trip** assertion (build → stringify → parse → deep-equal) so the schema's persistability is CI-tested off-device.
- [ ] `tests/harness.ts` — add a **`nextTick` macrotask-form assertion** (import the patched `nextTick`, assert `.toString()` is not the microtask form) so the caret regression fails CI, not just on-device.
- [ ] `tests/harness.ts` — add a **D-09 reference-key vector** assertion (`deriveKey(VEC_PW, "1234567890123456789")` equals a committed 32-byte expected value, cross-checked against stegcloak-rs) so the on-device byte-match has a CI-proven target. *(Note: this overlaps with Phase-2 GATE-01; the spike needs only the reference key value, not the full structural gate — coordinate to avoid duplication.)*
- [ ] `scripts/build.mjs` — add `metafile: true` to the esbuild call + the sync-derive import-graph guard (D-07).
- [ ] No framework install needed — the custom runner already exists.

*If the planner judges the reference-key vector belongs wholly to Phase 2, Phase 1 can compute the noble reference on-device at test time instead of committing it — but having a CI-asserted value is strictly safer and is the recommendation.*

## Sources

### Primary (HIGH confidence)
- **Codebase (direct read this session):** `src/crypto/argon.ts` (sync `deriveKey` + async `deriveKeyAsync` + `benchOnce`), `src/crypto/random.ts` (DI/host-access + `coerce()` precedent), `src/discord/flux.ts` (`backgroundDecrypt`, `LOAD_MESSAGES_SUCCESS`), `src/discord/send.ts` (cold-path reject-resend), `src/discord/commands.ts` (`/encrypt` verbs), `src/discord/metro.ts` (`_msgActions` staleness), `src/index.ts` (`__goofcrypt.diag()`, `safe()` wrapper), `src/core/keycache.ts` (async `deriveKey`, `pending` dedup, persistence), `src/core/stegcloak.ts` (sync `deriveKey` consumer), `src/selfTest.ts` (`eqBytes`), `scripts/build.mjs` (nextTick patch + regex gates), `scripts/test.mjs` (custom runner), `tests/harness.ts` (19-byte CHANNEL salt), `package.json` (`^1.7.1` caret), `package-lock.json` (`1.8.0` resolved), `diagnose2.txt` (the probe to make durable).
- **Import-graph audit (grep, this session):** confirmed `core/stegcloak.ts` is not value-imported in `src/`; sync `deriveKey` is harness-only.
- **`.planning/research/` (SUMMARY, STACK, PITFALLS, ARCHITECTURE, FEATURES):** the RED verdict basis, the five freeze candidates, the byte-match gate, the DI/layering design, the libsodium salt blocker.
- **`.planning/codebase/` (ARCHITECTURE, CONCERNS):** layering, the `LOAD_MESSAGES_SUCCESS` storm, the `nextTick`/caret fragility, the `_msgActions` stale-handle class.

### Secondary (MEDIUM confidence)
- **npm registry `@noble/hashes`:** latest published version `2.2.0` (dist-tags.latest) — confirms a caret bump to 2.x would break the build patch. `[VERIFIED: npm registry]`
- libsodium `crypto_pwhash` fixed 16-byte salt + `argon2id_hash_raw` not exported (via prior research/STACK.md, sourced to libsodium GitHub).

### Tertiary (LOW confidence — on-device only)
- Whether Discord's mobile bundle surfaces ANY arbitrary-salt raw Argon2 through `nativeModuleProxy`/`__turboModuleProxy`/metro — undocumented; the spike settles it. Expected: none reachable that satisfies the 19-byte-salt + raw-32-byte bar.
- Kettu `plugin.storage` flush timing (sync vs async) — the spike must verify on-device (A1).

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps; existing toolchain): **HIGH** — verified against package.json, lockfile, npm registry, and source.
- Architecture (probe in discord layer, DI precedent, persistence pattern): **HIGH** — mirrors `random.ts` and keycache, codebase-grounded.
- Sync-derive audit (SPIKE-03's hardest sub-question): **HIGH** — completed by grep this session; `core/stegcloak.ts` not value-imported in `src/`.
- Freeze instrumentation (yield-count, nextTick assertion): **MEDIUM-HIGH** — the macrotask-form assertion and "are macrotasks firing" signal are HIGH; exact internal yield-count is not directly observable (A4).
- Armed-flag crash safety: **MEDIUM** — the pattern is sound but depends on storage flush timing (A1), which the spike must verify on-device.
- Native reachability (the verdict's actual unknown): **MEDIUM-LOW** — expected RED, but this is exactly what the spike exists to settle.

**Research date:** 2026-05-30
**Valid until:** ~2026-06-29 for the codebase/architecture findings (stable); the `@noble/hashes` registry state and the on-device native surface can change with any Discord/Hermes update — re-verify the build tag and re-run the probe if Discord updates.
