# Architecture Research

**Domain:** Native-crypto fast-path + fallback chain for a Hermes/Vendetta plugin (Argon2id KDF acceleration)
**Researched:** 2026-05-30
**Confidence:** HIGH (codebase-grounded; native-module reachability is the one MEDIUM/unverified input, handled by design via a runtime gate)

This research answers one question: **how to slot a native-crypto fast-path and a fallback chain into the existing strictly-layered architecture (`discord → core → {crypto, stego, util}`) without breaking any of its constraints.** Every recommendation here is anchored to the existing files and is designed so the native path is **architecturally un-trustable until a byte-equality gate passes**, and so the metro/native surface is injected (never imported) into the crypto layer.

---

## Standard Architecture

### System Overview (proposed end state)

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Discord / Vendetta API                            │
│   nativeModuleProxy · __turboModuleProxy · metro.findByProps          │
│   FluxDispatcher · MessageActions · plugin.storage                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ probe + inject (load-time, discord layer ONLY)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  src/discord/nativeProbe.ts   ← NEW. Touches vendetta.* / globals.    │
│  - scans nativeModuleProxy / turbo / metro (the diagnose2.txt logic)  │
│  - returns a plain { name, fn } adapter candidate + a ProbeReport     │
│  - persists ProbeReport to storage; surfaces via __goofcrypt.diag()   │
└───────────────┬──────────────────────────────────────────────────────┘
                │ injectNativeArgon(candidate)  (DI call, one direction)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                              core/                                     │
│  keycache.ts   ← deriveKey() picks: native → imported → optimized-JS  │
│  selfTest.ts*  ← byte-equality VECTOR gate flips nativeVerified flag  │
│  (decrypt/encrypt/payload/stegcloak/health unchanged)                 │
└───────────────┬──────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                              crypto/                                   │
│  argon.ts            ← stays the stable public interface              │
│    deriveKeyAsync()  ← internally consults the native registry        │
│  nativeArgon.ts ←NEW ← holds injected adapter + nativeVerified flag;  │
│                        NO vendetta/discord imports (pure, injectable) │
└──────────────────────────────────────────────────────────────────────┘
                          (stego / util unchanged)
```

\* `selfTest.ts` lives at `src/selfTest.ts` (top level, imported by `index.ts`), not under `core/`. It is the right home for the load-time vector gate because it already runs the on-device Hermes regression checks.

### Component Responsibilities

| Component | Responsibility | New / Changed | Layer |
|-----------|----------------|---------------|-------|
| `discord/nativeProbe.ts` | Scan `nativeModuleProxy` / `__turboModuleProxy` / `metro.findByProps` for an Argon2-capable native entry point; build a candidate adapter fn; build + persist a `ProbeReport` | NEW | discord (the *only* layer allowed to touch `vendetta.*`) |
| `crypto/nativeArgon.ts` | Hold the injected native adapter and the `nativeVerified` boolean; expose `injectNativeArgon()`, `nativeArgonAvailable()`, `markNativeVerified()`, `deriveNative()` | NEW | crypto (pure; injected, never imports discord) |
| `crypto/argon.ts` | Stable public KDF interface. `deriveKeyAsync()` keeps its signature; internally consults `nativeArgon` registry, falls back to noble | CHANGED | crypto |
| `core/keycache.ts` | Selection orchestration on the cold path: native → imported(key-sync) → optimized-JS. Hot path (`getCachedKey`) untouched | CHANGED | core |
| `selfTest.ts` | Add a fixed test-vector check `(password, channelId) → expected key`; on pass call `markNativeVerified()`; on fail leave native un-trusted | CHANGED | top-level |
| `tests/harness.ts` | Add the same fixed vector as a device-free assertion cross-checked against stegcloak-rs, so the expected key is provably correct before it can gate anything on-device | CHANGED | tooling |
| `discord/commands.ts` | `/encrypt status` reports KDF path + verified flag + probe summary | CHANGED | discord |
| `index.ts` | Wire the probe → inject → self-test order in `onLoad`; expose probe report on `__goofcrypt.diag()` | CHANGED | top-level |

---

## The Core Architectural Tension and Its Resolution

**Constraint:** `ARCHITECTURE.md` line 214 — *"No circular imports. Import graph is strictly layered: `discord` → `core` → `crypto/stego/util`."* The crypto layer (line 99-104) depends only on `@noble/*` and `fflate`; it must never reach `vendetta.*`.

**Problem:** A native Argon2 module is reachable only through `nativeModuleProxy` / `__turboModuleProxy` / `vendetta.metro.findByProps` — all of which live behind the discord/Vendetta surface. The crypto layer is exactly where the KDF lives, but it is the layer forbidden from importing discord.

**Resolution — dependency injection, not import (the existing `random.ts` precedent):**

There is already a pattern for this in the codebase. `src/crypto/random.ts` is in the crypto layer yet needs `vendetta.metro.findByProps` for the Metro RNG source. It does **not** import discord — it reaches `globalThis.vendetta` directly and degrades gracefully:

```typescript
// src/crypto/random.ts:57 — existing precedent
const findByProps = (globalThis as any).vendetta?.metro?.findByProps;
```

Two valid mechanisms exist; **pick injection (B), not the global reach (A)**, for the native path:

- **(A) Global-reach (what `random.ts` does today):** crypto reads `globalThis.vendetta` directly. Works, but it smudges the layer boundary — crypto now has implicit knowledge of the Vendetta runtime. Acceptable for a 3-line RNG probe; **wrong** for the native-crypto adapter, which carries the byte-compat risk and deserves a hard boundary.
- **(B) Dependency injection (RECOMMENDED):** the *discord* layer does all `vendetta.*`/`globalThis` touching (in `nativeProbe.ts`), then **passes a plain function** into the crypto layer via `injectNativeArgon(candidate)`. The crypto layer never names `vendetta`, `nativeModuleProxy`, or `metro`. The import graph stays `discord → crypto` (one direction); the *data* (an injected closure) also flows `discord → crypto`. No exception to the layering rule is needed — DI respects it exactly.

**Why this is clean:** `crypto/nativeArgon.ts` has the same purity profile as the rest of `crypto/` — pure functions, no module-level I/O, no `vendetta` reference. It is unit-testable in Node by injecting a fake adapter. The discord layer remains the sole owner of the Vendetta surface, consistent with `STRUCTURE.md` line 70 (*"Everything that touches `vendetta.*` directly"* lives in `src/discord/`).

> **Quality-gate check:** No discord import appears in crypto/core. The metro/native dependency crosses the boundary by **injection** (`injectNativeArgon`), called once at load from `index.ts`/`nativeProbe.ts`. This is the named injection mechanism the gate requires.

---

## Recommended Project Structure

```
src/
├── index.ts                    # CHANGED: onLoad wiring (probe → inject → self-test)
├── selfTest.ts                 # CHANGED: + fixed-vector gate → markNativeVerified()
├── crypto/
│   ├── argon.ts                # CHANGED: deriveKeyAsync consults native registry
│   ├── nativeArgon.ts          # NEW: injected adapter + nativeVerified flag (PURE)
│   ├── aead.ts                 # unchanged
│   ├── deflate.ts              # unchanged
│   └── random.ts               # unchanged (the DI/global-reach precedent)
├── core/
│   └── keycache.ts             # CHANGED: cold-path selection chain
├── discord/
│   ├── nativeProbe.ts          # NEW: scans native surface, builds adapter + ProbeReport
│   ├── commands.ts             # CHANGED: /encrypt status shows KDF path + probe
│   └── metro.ts                # (optional) home for shared proxy accessors
└── util/
    └── base64.ts               # unchanged (adapter may need it for base64 I/O)

tests/
└── harness.ts                  # CHANGED: + fixed-vector assertion vs stegcloak-rs
```

### Structure Rationale

- **`crypto/nativeArgon.ts` (not `discord/`):** the *execution* of Argon2 is a crypto-layer concern; only its *discovery* is a discord concern. Splitting discovery (discord) from execution-registry (crypto) is what lets the layering hold. The registry is a passive holder — it receives an already-resolved function.
- **`discord/nativeProbe.ts` (not `crypto/`):** all `nativeModuleProxy`/`turbo`/`metro` access — the literal `diagnose2.txt` logic — belongs in discord per `STRUCTURE.md`. This is also where the probe report is built and persisted.
- **Gate in `selfTest.ts`, not a new file:** `selfTest.ts` already exists to catch "things Node/CI cannot reproduce" on real-device Hermes (its own header comment). A native KDF that miscompiles a 64-bit op or mishandles the salt is *exactly* that class of bug. Reuse the surface; do not invent a parallel one.
- **Mirror in `tests/harness.ts`:** the on-device gate compares against a hard-coded expected key. That expected key must itself be proven correct *offline against the real stegcloak-rs WASM* (the existing CASES pattern) so it cannot silently encode a wrong value. The harness is the source of truth for the vector; selfTest is the on-device enforcer.

---

## Architectural Patterns

### Pattern 1: Injected Adapter Registry (layer-preserving native access)

**What:** The crypto layer exposes a registry that *receives* a native function; the discord layer is the only code that resolves it.

**When to use:** Whenever a pure lower layer needs a capability that only the host (Vendetta) can provide. Already implicitly used by `random.ts`; formalize it here.

**Trade-offs:** One extra wiring call at load time, in exchange for a hard, testable layer boundary and Node-unit-testability of the crypto layer.

**Example (shape only — must be `class`-free; see Hermes section):**

```typescript
// src/crypto/nativeArgon.ts — PURE. No vendetta/discord/global references.
// Adapter: same contract as deriveKeyAsync — bytes in, 32 bytes out.
export type NativeArgonFn = (password: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>;

let _fn: NativeArgonFn | null = null;
let _verified = false;          // gated by the byte-equality vector (selfTest)
let _sourceName = "none";

export function injectNativeArgon(fn: NativeArgonFn | null, sourceName: string): void {
    _fn = fn;
    _sourceName = fn ? sourceName : "none";
    _verified = false;          // a fresh adapter is ALWAYS un-trusted until re-gated
}

export function markNativeVerified(ok: boolean): void { _verified = ok; }

// The ONLY predicate the selection chain may trust:
export function nativeArgonReady(): boolean { return !!_fn && _verified; }

export function nativeArgonSource(): string { return _sourceName; }

// Raw run for the gate (verified=false is fine here — the gate is what sets it).
export function deriveNativeRaw(password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
    if (!_fn) return Promise.reject(new Error("no native argon"));
    return _fn(password, salt);
}
```

```typescript
// src/discord/nativeProbe.ts — discord layer owns ALL vendetta/global access.
import { injectNativeArgon } from "../crypto/nativeArgon";
// ...resolve a candidate from nativeModuleProxy / __turboModuleProxy / metro...
injectNativeArgon(candidateFn, "nativeModuleProxy:DCDSodium"); // example source
```

> **Critical invariant:** `injectNativeArgon` resets `_verified = false`. The native path cannot be reached by the selection chain until `selfTest` calls `markNativeVerified(true)`. There is no code path that sets `_verified` from the adapter itself — the gate is structurally unbypassable.

### Pattern 2: Byte-Equality Verification Gate (load-time, fixed vector)

**What:** Before the native path is ever trusted, run it on a hard-coded `(password, channelId) → expectedKey` vector and compare bytes. Only on exact match does `nativeVerified` flip true.

**When to use:** Mandatory for this milestone — the native path is byte-compat-risky (libsodium high-level `crypto_pwhash` enforces a **fixed 16-byte salt**, but the channelId salt is ~18-19 bytes; only a low-level `argon2id_hash_raw`-style entry point accepts arbitrary salt length — see Sources). The gate makes "does this reachable module reproduce our exact derivation?" a **runtime-decided fact**, not an assumption.

**Trade-offs:** Costs one extra 64 MiB Argon2 run at load (the native one, which is the fast one we're betting on — cheap if native, and if it's *not* fast we learn that too via timing). Worth it: it is the only thing standing between "fast" and "silently corrupting every message's key."

**Placement:** extend `src/selfTest.ts`. It already runs on load inside a `safe()` wrapper in `index.ts` and already does byte-equality (`eqBytes`) checks. Add:

```typescript
// src/selfTest.ts (sketch — keep it class-free, array index loops only)
// VECTOR must be reproduced offline by tests/harness.ts against stegcloak-rs
// so EXPECTED_KEY is provably the real derivation, not a typo we trust forever.
const VEC_PW = "goofcrypt-selftest-vector";
const VEC_CHANNEL = "1234567890123456789";          // snowflake-shaped, ~19-byte salt
const EXPECTED_KEY = fromBase64("…");                // pinned by harness

export async function verifyNativeArgon(): Promise<boolean> {
    if (!nativeArgonReady() && !haveInjectedNative()) return false;  // nothing to verify
    try {
        const got = await deriveNativeRaw(utf8Encode(VEC_PW), utf8Encode(VEC_CHANNEL));
        const ok = eqBytes(got, EXPECTED_KEY);
        markNativeVerified(ok);
        return ok;
    } catch {
        markNativeVerified(false);
        return false;
    }
}
```

The salt length in the vector is deliberately ~19 bytes so the gate **exercises the exact failure mode** (a 16-byte-salt-only module produces a different key → bytes mismatch → native rejected → fallback). The architecture turns the compat risk into a self-healing decision.

### Pattern 3: Cold-Path Selection Chain (native → imported → optimized-JS)

**What:** `deriveKeyAsync` stays the single stable public interface. Selection happens **one level up**, in `keycache.deriveKey()` (the cold path), because that is where the "is it already imported/cached?" question already lives. Splitting selection between two places would duplicate the cache check.

**Where each tier is decided:**

| Tier | Decided in | Predicate |
|------|-----------|-----------|
| 0. Hot cache (mem/persisted) | `getCachedKey()` — **unchanged** | already cached |
| 1. Imported (key-sync) | `getCachedKey()` reads persisted store | desktop-imported key present (same `passwordId` index) |
| 2. Native (verified) | inside `deriveKeyAsync` | `nativeArgonReady()` (= injected AND `_verified`) |
| 3. Optimized-JS (noble) | inside `deriveKeyAsync` | always available (final fallback) |

**Why selection lives inside `argon.ts` for tiers 2–3, and in `keycache.ts` for tiers 0–1:** tiers 0/1 are *cache* questions (key already exists → no derivation at all); they belong to keycache and are already implemented (`getCachedKey` checks mem then persisted store, where imported keys land — `keycache.ts:71`). Tiers 2/3 are *derivation-engine* questions; they belong inside `deriveKeyAsync`, keeping `keycache.deriveKey` ignorant of *how* derivation happens. This preserves the existing contract: keycache calls `deriveKeyAsync(password, channelId)` and gets 32 bytes — it never learns whether native or JS produced them.

**Trade-offs:** Keeps the blast radius tiny — `keycache.ts` barely changes; the engine choice is fully encapsulated in `argon.ts`. Downside: `deriveKeyAsync` gains a branch, but it is a single guarded call.

```typescript
// src/crypto/argon.ts — the only behavioural change; signature is identical.
export async function deriveKeyAsync(password: string, channelId: string): Promise<Uint8Array> {
    if (nativeArgonReady()) {                                  // tier 2 (verified only)
        try {
            return await deriveNativeRaw(utf8Encode(password), utf8Encode(channelId));
        } catch {
            // native broke at runtime → fall through to JS, do NOT throw.
        }
    }
    return argon2idAsync(utf8Encode(password), utf8Encode(channelId), ASYNC_OPTS); // tier 3
}
```

---

## Data Flow

### Flow A — Native-derive (cold cache, native verified)

```
send.ts / flux.ts cold path
   └─> keycache.deriveKey(channelId, pw)
          getCachedKey() → miss (tier 0/1)            [unchanged]
          dedupe via pending Map                       [unchanged]
          deriveKeyAsync(pw, channelId)                [crypto/argon.ts]
             nativeArgonReady() === true  ──────────► deriveNativeRaw(...)  [native, fast]
                                                          └─> 32-byte key
          mem.set + persist base64                     [unchanged]
```

The persisted store and mem cache are **engine-agnostic** — a native-derived key and a noble-derived key are byte-identical (that is what the gate guarantees), so the two-level cache, key-sync import, and winner-hint logic all keep working untouched.

### Flow B — Fallback selection (probe found nothing, or gate failed)

```
onLoad:
   nativeProbe.probe()  → no candidate  OR  candidate found
   injectNativeArgon(fn|null)           → _verified = false (always)
   selfTest.verifyNativeArgon()         → mismatch / no-native → markNativeVerified(false)

later, cold derive:
   deriveKeyAsync → nativeArgonReady() === false → argon2idAsync (noble, the current path)
```

Fallback is **automatic and silent** at the engine level. The user-visible fallback (key-sync import, "send again" toast) is unchanged from today — it already covers the slow-JS case.

### Flow C — Probe-result capture (durable, unlike `diagnose2.txt`)

```
nativeProbe.probe() builds ProbeReport {
    scannedKeys: number,
    cryptoIshNames: string[],         // re/test hits from nativeModuleProxy
    turboHits: { name, methods[] }[],
    metroHits: { prop, methods[] }[], // crypto_pwhash / argon2id / scrypt …
    subtle: boolean,
    chosen: string | null,            // adapter source, or null
    verified: boolean,                // filled after selfTest
    kdfPath: "native" | "js",
}
   ├─> persist to plugin.storage.nativeProbe (survives restart)
   ├─> expose on __goofcrypt.diag().nativeProbe   (read via /eval — durable)
   └─> summarise in /encrypt status                (one-line on-device readout)
```

This directly fixes the milestone's spike pain: `diagnose2.txt` was fire-and-forget; a `ProbeReport` persisted to storage + surfaced on `__goofcrypt.diag()` and `/encrypt status` makes the on-device findings durable and queryable without re-running an ad-hoc `/eval`.

### State Management (new module-level state, reset on unload)

- `crypto/nativeArgon.ts`: `_fn`, `_verified`, `_sourceName` — module-level singletons, consistent with the existing `random.ts` (`rngFn`, `secure`, `sourceName`) pattern. Reset by re-injecting `null` on `onUnload` (add to the `onUnload` chain), matching the constraint at `ARCHITECTURE.md:211` ("All are reset on `onUnload`").
- `storage.nativeProbe`: persisted `ProbeReport` (a new optional field on the storage object; add a default in `settings.ts` `DEFAULTS` so it round-trips through the typed proxy, per the "no raw storage access" anti-pattern at `ARCHITECTURE.md:225`).

---

## Build / Hermes Implications (for ALL new code)

Every new file must survive the `esbuild → swc ES5` pipeline and the **build-time regex gates** in `scripts/build.mjs` (lines 81-91). Concretely:

| Constraint | Source | Rule for new code |
|------------|--------|-------------------|
| No `class` syntax in output | `build.mjs:81` regex throws | `nativeArgon.ts` registry uses **module-level `let` + functions**, like `random.ts` — *not* a class. (swc would lower a class anyway, but stay idiomatic.) |
| No generators / `yield` | `build.mjs:84` | No generator functions. `async/await` is fine (esbuild/swc lower it without generators given the ES5 target + regenerator-free output; the existing async code already proves this). |
| No `for...of` iterator-protocol | `build.mjs:89` (`_iteratorNormalCompletion`) + `swc iterableIsArray:true` | New loops over arrays/Uint8Arrays are fine (covered by `iterableIsArray`). **Do not** iterate a `Map`/`Set` with `for...of` in new hot code without confirming it lowers to index loops; prefer array index loops in the gate/compare paths (the `eqBytes` style already in `selfTest.ts`). |
| No WASM | PROJECT.md out-of-scope | The native adapter is a *host module call*, not bundled WASM. Compliant. |
| No `TextEncoder`/`Buffer` | `ARCHITECTURE.md:212` | Adapter passes `Uint8Array` (via existing `utf8Encode` from `deflate.ts`); if a native module returns base64, decode with the existing `util/base64.ts` `fromBase64` (the `random.ts` `coerce()` shows the base64-from-native precedent at `random.ts:30`). |
| Single-expression eval bundle | `build.mjs:95-102` | New modules are ordinary ESM imports bundled by esbuild — no special handling. |
| `new Function` parse gate | `build.mjs:99` | Passes automatically if class/generator gates pass. |

**One concrete risk:** a native module returning a **base64 string** rather than `Uint8Array`. Reuse `random.ts:coerce()`'s approach (it already handles `Uint8Array | number[] | base64-string`) — generalise it into `util/` or copy the few lines into `nativeProbe.ts`. Do not assume the native return type; normalise at the discord/adapter boundary so the crypto registry always sees `Uint8Array`.

---

## Anti-Patterns (specific to this milestone)

### Anti-Pattern 1: Importing the native surface into the crypto layer

**What people do:** `import { nativeModuleProxy } from "..."` or reference `vendetta.metro` inside `crypto/nativeArgon.ts` to "keep the native code next to the KDF."
**Why it's wrong:** Violates the strict layering (`ARCHITECTURE.md:214`); makes the crypto layer un-testable in Node; couples crypto to the Vendetta runtime.
**Do this instead:** Resolve in `discord/nativeProbe.ts`, inject a plain function via `injectNativeArgon`. Crypto never names the host.

### Anti-Pattern 2: Trusting the native path on "found" instead of "verified"

**What people do:** `if (nativeModuleFound) useNative()` — gating on *presence*.
**Why it's wrong:** Presence ≠ byte-equality. A reachable libsodium whose high-level `crypto_pwhash` rejects/normalises the 19-byte salt will produce a *different 32-byte key*, silently breaking GoofCord interop for every message (the core-value violation). The wrong key still "works" locally and still encrypts — it just can never be decrypted by the desktop client.
**Do this instead:** Gate selection on `nativeArgonReady()` (= injected **AND** `_verified`), where `_verified` is set *only* by the fixed-vector byte-equality check in `selfTest`. `injectNativeArgon` forcibly resets `_verified=false`.

### Anti-Pattern 3: Hard-coding the expected key without proving it offline

**What people do:** Paste an `EXPECTED_KEY` from a one-off run into `selfTest.ts`.
**Why it's wrong:** If that key is wrong, the gate validates the native path against a wrong target — it could *accept* a broken native module or *reject* a correct one, and there is no second opinion.
**Do this instead:** Pin the vector in `tests/harness.ts` and assert it equals both our noble `deriveKey` output **and** stegcloak-rs's derivation (the harness already imports the real WASM). The harness is CI-gated, so a wrong expected key fails CI before it can ship.

### Anti-Pattern 4: Putting selection logic in `keycache.deriveKey` AND `argon.ts`

**What people do:** Branch on native in both the cache layer and the engine layer.
**Why it's wrong:** Duplicates the cache check and the fallback logic; two places to keep in sync.
**Do this instead:** Cache/import tiers in `keycache` (already there), engine tiers (native/JS) entirely inside `deriveKeyAsync`. One responsibility per layer.

---

## Integration Points

### Host (Vendetta / Discord) surface — touched ONLY by `discord/nativeProbe.ts`

| Surface | Access pattern | Notes |
|---------|----------------|-------|
| `globalThis.nativeModuleProxy` | enumerate keys, regex `crypt\|sodium\|argon\|pwhash\|...` | exactly the `diagnose2.txt` scan |
| `globalThis.__turboModuleProxy` | call with candidate names (`DCDSodium`, `Aes`, DAVE/MLS crypto) | wrap in try/catch; TurboModule calls can throw |
| `vendetta.metro.findByProps` | probe `crypto_pwhash`, `argon2id`, `scrypt`, `pbkdf2` | same as RNG metro probe in `random.ts:57` |
| `globalThis.crypto.subtle` | presence check | unlikely to offer Argon2id, but record it |
| `vendetta.plugin.storage` | persist `ProbeReport` (via `settings()`) | durable capture; **never** raw-access — go through `settings()` |

### Internal boundaries

| Boundary | Communication | Direction |
|----------|---------------|-----------|
| discord → crypto | `injectNativeArgon(fn, source)` (DI) | one-way, load-time |
| selfTest → crypto | `markNativeVerified(bool)` after vector check | one-way |
| keycache → crypto | `deriveKeyAsync(pw, channelId)` (unchanged signature) | one-way |
| crypto → util | `fromBase64` for native base64 returns | one-way |
| discord(commands) → crypto | `nativeArgonSource()` / readiness for `/encrypt status` | read-only |

No new edge points *up* the layer graph. Every arrow respects `discord → core → crypto`.

---

## Suggested Build Order (for the roadmap)

Ordered by dependency and by "de-risk the unknown first." The native-module reachability is the single biggest unknown, so the spike and the *verification machinery* come before any reliance on native.

1. **Probe capture (spike, durable).** Build `discord/nativeProbe.ts` producing a persisted `ProbeReport`; surface it on `__goofcrypt.diag()` and `/encrypt status`; add the `storage.nativeProbe` default in `settings.ts`. *No behaviour change yet.* This converts the lost `diagnose2.txt` result into a durable, on-device-readable artefact and tells us whether a native Argon2/low-level-salt entry point even exists. **Depends on:** nothing. **Gate it answers:** "is there anything to accelerate with?"

2. **Byte-equality vector harness.** Add the fixed `(password, channelId)→key` vector to `tests/harness.ts`, asserted against both noble and stegcloak-rs WASM; export the pinned `EXPECTED_KEY` (base64) for selfTest to consume. **Depends on:** nothing (pure tooling). **Why before the adapter:** the adapter is untrustable without a proven target; build the target first.

3. **Native adapter registry + gate.** Add `crypto/nativeArgon.ts` (injected registry, `_verified` flag) and extend `selfTest.ts` with `verifyNativeArgon()`. Wire `nativeProbe → injectNativeArgon → selfTest.verifyNativeArgon` in `index.ts` `onLoad` (probe → inject → verify order). Still *not* selected by derivation yet — only the flag is computed and surfaced. **Depends on:** 1 (probe/candidate) + 2 (expected key).

4. **Fallback wiring (selection chain).** Change `deriveKeyAsync` in `argon.ts` to consult `nativeArgonReady()` with try/catch fallthrough to noble. `keycache` unchanged except possibly a comment. Now native is actually used **iff verified**. Re-run the harness (must stay green — it exercises the JS path; native is device-only). **Depends on:** 3.

5. **UX / status + key-sync polish.** `/encrypt status` shows `kdf: native|js · verified: y/n`; ensure the key-sync import path (already shipped) is the documented fallback when native is absent; non-blocking-send UX unchanged. **Depends on:** 4.

6. **(Parallel/independent) Jank root-cause.** The PROJECT notes the async+macrotask path "still freezes" — investigate whether `send.ts` reliably takes the async route and whether the noble macrotask-yield actually yields on-device. This is independent of native and can proceed alongside 1-2; its findings may make native unnecessary or may confirm it's required. **Depends on:** nothing.

**Critical-path ordering rule for the roadmap:** *verification machinery (steps 1-3) must precede any step that lets native produce a real key (step 4).* The byte-equality gate is a hard predecessor to native selection — never wire selection before the gate exists.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Layering-preserving injection (DI) | HIGH | Directly mirrors the existing `random.ts` host-access pattern; one-directional import graph preserved |
| Gate placement (selfTest + harness) | HIGH | Reuses existing on-device byte-equality surface and the existing WASM cross-check harness |
| Selection split (keycache cache-tiers vs argon engine-tiers) | HIGH | Matches existing responsibilities; minimal diff; signature preserved |
| Hermes/swc safety of new code | HIGH | New code is functions + `let` singletons + array-index loops; passes the existing build regex gates by construction |
| Native module *reachability* + low-level salt acceptance | MEDIUM | Library facts verified (high-level `crypto_pwhash` = fixed 16-byte salt; low-level `argon2id_hash_raw` = arbitrary salt). Whether Discord exposes such an entry point is *unverified on-device* — which is precisely why the architecture makes it a runtime gate, not an assumption |

---

## Sources

- libsodium `crypto_pwhash` (high-level) — fixed `crypto_pwhash_SALTBYTES` (16-byte) salt: https://libsodium.gitbook.io/doc/password_hashing/default_phf (HIGH)
- libsodium low-level Argon2 `argon2id_hash_raw` accepts arbitrary `saltlen`: https://github.com/jedisct1/libsodium/blob/master/src/libsodium/crypto_pwhash/argon2/argon2.h (HIGH)
- react-native-sodium binding exposing `crypto_pwhash` / Argon2id13 (example of how a native module surfaces these): https://github.com/lyubo/react-native-sodium/blob/master/android/src/main/java/org/libsodium/rn/RCTSodiumModule.java (MEDIUM)
- Existing codebase precedents (HIGH, primary source):
  - `src/crypto/random.ts` — crypto-layer host-access via `globalThis.vendetta` + base64 `coerce()` (the DI/normalisation precedent)
  - `src/crypto/argon.ts` — the `deriveKeyAsync` public interface to extend
  - `src/core/keycache.ts` — two-level cache + cold-path `deriveKey` selection site
  - `src/selfTest.ts` — on-device byte-equality (`eqBytes`) gate surface
  - `tests/harness.ts` — stegcloak-rs WASM cross-check + `CASES` vector pattern
  - `scripts/build.mjs` — the class/generator/iterator regex gates new code must pass
  - `diagnose2.txt` — the existing (fire-and-forget) native-crypto probe to make durable

---
*Architecture research for: native-speed Argon2id fast-path + fallback chain (GoofCrypt mobile)*
*Researched: 2026-05-30*
