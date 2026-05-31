# Phase 1: Spike — capture the probe + diagnose the freeze - Pattern Map

**Mapped:** 2026-05-30
**Files analyzed:** 9 (1 new, 8 modified)
**Analogs found:** 9 / 9

> **Read-this-first for the planner/executor.** Almost every primitive this spike needs already exists, byte-compat-proven and Hermes-safe. The net-new code is *enumeration + instrumentation + a build guard + a verdict*. **Compose existing functions; do not reimplement crypto.** The one genuinely new mechanism (armed-flag poison detection) has no repo precedent — design it from D-05.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/discord/nativeProbe.ts` | **NEW** discord-layer probe | event-driven (host-surface enumeration) + transform (candidate test) | `src/crypto/random.ts` (host-access + `coerce`) + `diagnose2.txt` (enumeration) | role-match (structure) + exact (enumeration logic) |
| `src/crypto/argon.ts` | crypto / KDF (modify) | transform (instrument) | itself — extend `deriveKeyAsync` / `benchOnce` in place | self (in-place extension) |
| `src/discord/flux.ts` | discord / Flux hook (observe) | event-driven (dispatch storm) | itself — `backgroundDecrypt` / `LOAD_MESSAGES_SUCCESS` | self (observe; optional debug counter) |
| `src/discord/send.ts` | discord / send patch (observe) | request-response (cold-path reject) | itself — cold-cache reject-resend block | self (observe only) |
| `src/discord/commands.ts` | discord / slash command (modify) | request-response (verb dispatch) | itself — existing `status` / `bench` verbs | self (add `diag` verb + render) |
| `src/index.ts` | plugin entry (modify) | event-driven (onLoad lifecycle) | itself — `safe()` wrapper + `__goofcrypt.diag()` | self (extend hook + wire probe) |
| `src/core/keycache.ts` | core / persistence (read-only ref) | CRUD (persisted store + dedup) | itself — persistence + `pending` dedup pattern | self (reference only — do not modify) |
| `scripts/build.mjs` | build tooling (modify) | batch (static import-graph check) | itself — existing class/generator/iterator regex gates | self (add metafile + guard) |
| `tests/harness.ts` | test (modify) | batch (assertion suite) | itself — existing `check()` / `CHANNEL` salt | self (add Wave 0 assertions) |

**Layering invariant (HARD):** `discord → core → {crypto, stego, util}`. `nativeProbe.ts` is **discord-layer** — it is the *only* new code allowed to touch `vendetta.*` / `globalThis.nativeModuleProxy` / `__turboModuleProxy` / metro. It **must not be imported by `core/` or `crypto/`**. No edge points up the graph. (Confirmed: the audit below shows the current tree has no up-graph leak.)

---

## Pattern Assignments

### `src/discord/nativeProbe.ts` (NEW — discord layer; probe + ProbeReport + guarded candidate test)

**Analog A — host access & module-shape coercion:** `src/crypto/random.ts`
**Analog B — enumeration logic:** `diagnose2.txt` (repo root)
**Analog C — persistence target:** `src/core/keycache.ts` + `src/settings.ts`

#### Module-shape pattern to mirror (from `random.ts`)
`random.ts` is the canonical discord-adjacent "resolve a host surface, probe a priority chain, expose via accessor functions, never `class`" precedent. Mirror its module shape exactly:
- Module-level `let` singletons + functions (NO `class`), e.g. `let rngFn: RngFn | null = null; let secure = false;` (`random.ts:23-25`).
- Each host probe wrapped in its own `try { … } catch { /* ignore */ }` because the vendetta/native API is `any`-typed and may be absent (`random.ts:58-72`, `73-83`).
- Metro access via the exact guarded form `const findByProps = (globalThis as any).vendetta?.metro?.findByProps;` then `findByProps?.("…")` (`random.ts:57-59`).
- Presence exposed via boolean/string accessor functions (`secureRngAvailable()`, `rngSource()` — `random.ts:90-96`), NOT exported mutable state. The ProbeReport accessors mirror this.

#### Native-return coercion — reuse, do not hand-roll (`random.ts:27-40`)
A native Argon2 candidate may return `Uint8Array | number[] | base64-string`. `random.ts:coerce()` already normalizes exactly these three shapes:
```typescript
function coerce(v: unknown, n: number): Uint8Array {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    if (typeof v === "string") {
        // assume base64 from a native module
        const bin = (globalThis as any).atob ? (globalThis as any).atob(v) : null;
        if (bin) {
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out.subarray(0, n);
        }
    }
    throw new RngUnavailableError();
}
```
> **For the probe's `classifyOutput()`** (`"raw32" | "phc-string" | "other"`): the index-loop base64-decode here is the Hermes-safe template. Prefer `fromBase64` from `src/util/base64.ts` over the inline `atob` when normalizing a candidate return for the byte-match (RESEARCH "Don't Hand-Roll" row: no `atob`/`Buffer`/`TextDecoder`).

#### Enumeration logic to port (from `diagnose2.txt`, single line)
`diagnose2.txt` already scans the *exact* surfaces SPIKE-01 names. Port it into `enumerateSurface(): ProbeReport`, converting the fire-and-forget `out.push(string)` into structured fields. The proven scan covers:
- `globalThis.nativeModuleProxy` → `Object.keys(nmp).filter(k => re.test(k))` with `re = /crypt|sodium|nacl|argon|pwhash|kdf|scrypt|pbkdf|dave|hash/i`.
- `globalThis.__turboModuleProxy` → call with candidates `["NativeCryptoModule","DCDCrypto","Sodium","NativeSodium","RNSodium","DCDSodiumManager","NativeDAVE","DCDDAVEManager","NativeMLS","Aes"]`; for each hit record `Object.keys(m).slice(0,20)`.
- `vendetta.metro.findByProps` → probe `["crypto_pwhash","argon2id","argon2","crypto_pwhash_ALG_ARGON2ID13","scrypt","pbkdf2","subtle","secretbox"]`; record `found` + `Object.keys(mod).slice(0,10)`.
- `globalThis.crypto?.subtle` → boolean.

RESEARCH.md "Pattern 1" (lines 222-260) is the already-structured TypeScript port of this snippet — use it as the starting skeleton.

> **HARD Hermes constraint — array index loops only.** `diagnose2.txt` uses `for (const n of cands)` over arrays (OK under `iterableIsArray`), but **never iterate a `Map`/`Set` with `for...of`** in new probe code — the swc iterator lowering drops the first element under Discord's Hermes (`build.mjs:87-91`, CONCERNS.md). Use `for (let i = 0; i < arr.length; i++)` as RESEARCH Pattern 1 already does. The on-load `selfTest` exists precisely to catch this class of bug.

#### Armed-flag poison detection (NEW mechanism — no repo precedent, from D-05)
No analog exists; build from RESEARCH "Pattern 2" (lines 264-303). Key rules:
- Persist `settings().nativeProbeArmed = name` **before** the native call; clear in `finally`. Access via `settings()` accessor — **never raw `plugin.storage`** (anti-pattern guard).
- On load, `reconcileArmedFlag()`: a still-set flag ⇒ that candidate hard-crashed last run → mark `crashed/unsafe`, skip, clear flag.
- Wrap the JS-level throw in `try/catch` and the hang in a timeout race (`withTimeout`). Catch shape mirrors `index.ts:36` / `random.ts`: `(e as Error)?.message ?? String(e)`.
- **Open question the spike must answer (A1 / Pitfall 4):** does the reactive `plugin.storage` proxy flush the armed write to disk *before* the native call? Verify on-device (write → force-quit → relaunch → check). MEDIUM confidence — document the result.

#### Lazy re-resolution — avoid the `_msgActions` stale-handle bug
`metro.ts:10` caches `_msgActions ??= …` and never invalidates it (a known bug class, CONCERNS.md). The probe must **re-resolve** native handles on each manual `/encrypt diag --test`, not cache-and-trust. Resolve lazily like `MessageActions()` but do NOT memoize across probe runs.

#### D-09 byte-match — reuse `eqBytes` + sync `deriveKey`
- Reference key: the existing **sync** `deriveKey(password, channelId)` from `crypto/argon.ts:27` (already byte-compat-proven against stegcloak-rs in CI). On-device derivation is the recommended source (Open Question 3).
- Comparison: reuse `eqBytes` from `src/selfTest.ts:12-16` (index-loop, Hermes-safe) — do not write a new comparator.
- Real-length salt: `"1234567890123456789"` (19-byte snowflake), exactly as `harness.ts:35` (`CHANNEL`). A 16-byte-salt-coercing candidate mismatches → RED.

---

### `src/crypto/argon.ts` (crypto / KDF — instrument in place)

**Analog:** itself. Extend; preserve `OPTS` / `ASYNC_OPTS` (they encode the GoofCord-compat params — DO NOT change `t:3, m:65536, p:1, version:0x13, dkLen:32`).

**Existing surface to extend** (lines 40-49):
```typescript
const ASYNC_OPTS = { ...OPTS, asyncTick: 50 };
export async function deriveKeyAsync(password: string, channelId: string): Promise<Uint8Array> {
    return argon2idAsync(utf8Encode(password), utf8Encode(channelId), ASYNC_OPTS);
}
export async function benchOnce(): Promise<number> {
    const t0 = Date.now();
    await argon2idAsync(utf8Encode("benchpassword"), utf8Encode("benchsaltvalue"), ASYNC_OPTS);
    return Date.now() - t0;
}
```

**Instrumentation to add** (RESEARCH Pattern 3, lines 306-339; D-06/D-08):
- `assertMacrotaskYield()` — `String(nextTick)` and assert it is NOT the empty-async-arrow microtask form (the caret-regression tripwire). Import the patched symbol: `import { nextTick } from "@noble/hashes/utils";`.
- A debug-flagged instrumented wrapper that early-returns the plain `deriveKeyAsync` when `!settings().debugInstrument` (zero overhead in normal use — D-08). Measure wall-time + first-yield via a `setInterval(0)` sampler (noble's internal yield count is not directly observable — A4; the sampler proves macrotasks *fire* vs thread-starved).
- Optionally enrich `benchOnce()` to return `{ totalMs, firstYieldMs, ...assertMacrotaskYield() }` for the `/encrypt bench` readout.

> **Layering note:** `argon.ts` is crypto-layer and **cannot import `settings()`** without violating `discord → core → crypto`. `settings.ts` is core-adjacent (imported by core/keycache). Check the actual edge: `settings.ts` imports only a *type* from `core/keycache`, and crypto currently never imports settings. **Recommended:** keep the debug-flag *gate* in the discord/command layer and pass a boolean/flag *into* the instrumented function, OR inject the debug flag as a parameter (mirroring `random.ts`'s `rng: RandomBytes` DI-by-parameter convention). Do not add a `crypto → settings` import. (Planner: resolve this explicitly; the RESEARCH Pattern 3 sketch reads `settings().debugInstrument` inside `argon.ts`, which would be an up-graph edge — prefer parameter injection.)

---

### `src/discord/flux.ts` (discord / Flux hook — observe the storm; optional debug counter)

**Analog:** itself. Observe `backgroundDecrypt` and the `LOAD_MESSAGES_SUCCESS` path; do not change behavior (the fix is Phase 3).

**The storm to instrument** (lines 40-72, 80-84): `LOAD_MESSAGES_SUCCESS` loops every message and calls `decryptInPlace` → `backgroundDecrypt`, launching **N async coroutines** guarded per-`messageId` (the `deriving` Set), NOT per-channel. Argon2 itself is deduped one level down by `keycache.deriveKey`'s `pending` Map, but N coroutines + N `MESSAGE_UPDATE` re-dispatches still contend (Pitfall 3).
```typescript
case "LOAD_MESSAGES_SUCCESS":
    if (Array.isArray(payload.messages)) {
        for (const m of payload.messages) decryptInPlace(m, m?.channel_id ?? payload.channelId);
    }
    break;
```
**Observation hook (behind the debug flag):** count concurrent `backgroundDecrypt` launches (increment on `deriving.add`, decrement in the `.finally`) and re-dispatch fan-out. Keep it debug-gated and zero-overhead (D-08). **Note the `deriveKey` here is the ASYNC one from `core/keycache` (line 10), not the sync `crypto/argon` one** — this is the crux of the sync-leak audit below.

> **Error-handling convention in this file (reuse for any new instrumentation):** the dispatch hook wraps `handle` in `try/catch` and logs via `vendetta.logger.error` (lines 98-102); silent hot-path failures go through `noteError("deriveFails", e)` (line 55), surfaced by `/encrypt status`. Any new counter must accumulate, never throw inside the Flux hook.

---

### `src/discord/send.ts` (discord / send patch — observe cold-path only)

**Analog:** itself. Pure observation — the first-encrypt cold-path is the freeze the spike diagnoses.

**Cold-path to observe** (lines 47-62):
```typescript
const key = getCachedKey(channelId, pw);
if (key) { /* encrypt synchronously + send */ return orig.apply(this, args); }
// Cold cache: warm in the background, keep the text, ask to resend.
deriveKey(channelId, pw)
    .then(() => showToast("GoofCrypt: key ready — send again"))
    .catch((e) => noteError("deriveFails", e));
return fail("GoofCrypt: preparing key (~10s). Text kept — send again shortly.");
```
This is the user's reported "still freezes" path: a cache miss fires `deriveKey` (async, from `core/keycache`) and rejects the send. The spike's job is to confirm the send path **reliably takes the async route** (it should — `deriveKey` here is `keycache.deriveKey`, the async one) and to measure where the wall-clock freeze actually lands (nextTick form? `asyncTick:50` coarseness? front-loaded first pass?). **Observe only — no behavior change.** The `fail()` / `noteError("sendAborts" | "deriveFails", e)` conventions (lines 25-29) are the established silent-failure path.

---

### `src/discord/commands.ts` (discord / slash command — add `diag` verb + extend `status`/`bench`)

**Analog:** itself — the existing `status` and `bench` verbs are the direct template.

**Command registration shape** (lines 30-65): one `vendetta.commands.registerCommand` call, `options[]` of `type: STRING` (`STRING = 3`), a `switch (action)` in `execute`. Add the `diag` surface here. Per Claude's discretion (D-02/D-05), either a new `diag` action with sub-args (`--probe` / `--test`) or distinct verbs — must be discoverable and **must not auto-invoke native crypto**.

**`status` verb to extend** (lines 118-125) — append the persisted ProbeReport summary:
```typescript
case "status":
    showToast(
        `GoofCrypt: ${settings().enabled ? "ON" : "OFF"} · ${getPasswordList().length} pw ` +
            `(raw ${settings().passwords.length} chars) · pw ${maskPassword(chosenPassword())} · ` +
            `RNG ${secureRngAvailable() ? rngSource() : "none"}` +
            healthSummary(),
    );
    break;
```
Mirror `healthSummary()` (`core/health.ts:19-23`) for a compact-append helper that renders the ProbeReport (e.g. `probeSummary()` returning `" · probe: <verdict>, <n> candidates"`).

**`bench` verb to extend** (lines 92-97) — surface first-yield / longest-block from the enriched `benchOnce`:
```typescript
case "bench":
    showToast("GoofCrypt: timing Argon2 (this is the per-chat cost)…");
    benchOnce()
        .then((ms) => showToast(`GoofCrypt: Argon2 took ${ms} ms`))
        .catch((e) => showToast("GoofCrypt bench error: " + (e?.message ?? e)));
    break;
```
> **`diag --probe` / `--test` wiring:** the probe enumeration and candidate test live in `nativeProbe.ts` (discord layer — commands.ts may import it directly, same layer). The `--test` path is the **only** caller of candidate invocation (D-05). Fire-and-forget + toast feedback, exactly as `warm()` (lines 24-28) and the `bench` `.then/.catch` pattern. **Pre-derive/import convention:** `warm()` shows the fire-and-forget DI pattern for never blocking the UI.

---

### `src/index.ts` (plugin entry — extend `__goofcrypt.diag()` + wire on-load probe)

**Analog:** itself — the `safe()` wrapper and the existing `__goofcrypt` hook are the integration points.

**`safe(label, fn)` wrapper** (lines 29-38) — wrap the on-load probe in its own `safe(...)` so a probe failure cannot break plugin init:
```typescript
const safe = (label: string, fn: () => void) => {
    try { fn(); } catch (e) {
        try { vendetta.logger.error(`GoofCrypt: ${label} failed`, e); } catch {}
        showToast(`GoofCrypt: ${label} failed — ${(e as Error)?.message ?? e}`);
    }
};
```
Add e.g. `safe("native-probe", maybeRunProbe);` — `maybeRunProbe` does enumeration-only (D-03), and only when the stored report is missing or the build tag changed (D-02). It runs `reconcileArmedFlag()` first. It **never invokes native crypto** on load.

**`__goofcrypt.diag()` hook to extend** (lines 56-65) — add the persisted ProbeReport (non-secret only — module names + booleans + timing; **no key bytes, no passwords**, per the existing rule at line 54):
```typescript
(globalThis as any).__goofcrypt = {
    version: 1,
    diag: () => ({
        enabled: settings().enabled,
        passwords: getPasswordList().length,
        rng: secureRngAvailable() ? rngSource() : "none",
        selfTest: selfTest(),
        // ADD: nativeProbe: settings().nativeProbe ?? null,
    }),
    selfTest,
};
```
> **Pre-existing concern (don't worsen):** `__goofcrypt` is left on `globalThis` after unload (CONCERNS.md). Phase 3 owns the formal fix, but if the spike enriches the hook, consider `onUnload` cleanup symmetry (lines 81-86). Bump `version` if the diag shape changes.

---

### `src/core/keycache.ts` (core / persistence — READ-ONLY reference; do not modify)

**Analog:** itself — the persistence + dedup pattern the ProbeReport and armed-flag mirror.

**Persistence pattern to mirror** (the ProbeReport round-trips through `plugin.storage` the same way the key cache does):
- `KeyCacheStore` extends into `Settings` (`settings.ts:7`); `initKeyCache(persisted)` seeds `store.keys ??= {}` (lines 32-35). The ProbeReport adds `nativeProbe` + `nativeProbeArmed` (+ `debugInstrument`) fields to `settings.ts` `DEFAULTS` the same way (see Shared Patterns below).
- **Dedup precedent** for the candidate-test inflight guard, if needed (lines 86-97): the `pending` Map dedupes concurrent derivations and clears in `.finally`. The armed-flag is a *persisted* analog of this in-memory guard.
- `getCachedKey` returns `null` on miss, never throws (lines 66-78) — the "return-null-not-throw on a Flux/hot path" convention.

**Reference for D-09 byte-match:** `passwordId()` (lines 42-44) shows the on-device `sha256` + `toBase64` + slice pattern; the byte-match instead compares the candidate's raw 32 bytes to the noble `deriveKey` reference via `eqBytes`. **Do not modify this file** — it is `core`, and the probe is `discord`; a probe import into keycache would be fine (discord→core), but keycache must not import the probe.

---

### `scripts/build.mjs` (build tooling — add metafile + sync-derive import-graph guard, D-07)

**Analog:** itself — the existing class/generator/iterator regex gates are the exact template.

**Existing gate pattern to mirror** (lines 81-91) — loud `throw` on a forbidden construct:
```javascript
if (/\bclass\s*[A-Za-z0-9_$]*\s*(\{|extends\b)/.test(lowered)) {
    throw new Error("class syntax survived swc lowering — Hermes eval would reject it");
}
if (/function\s*\*/.test(lowered) || /\byield\b/.test(lowered)) {
    throw new Error("generator syntax survived swc lowering — Hermes eval would reject it");
}
if (/_iteratorNormalCompletion/.test(lowered)) {
    throw new Error("iterator-protocol for...of lowering present — Hermes drops the first element; check swc iterableIsArray");
}
```

**Guard to add** (RESEARCH "Code Examples", lines 437-465; D-07) — add `metafile: true` to the esbuild `build({...})` call (lines 45-60; it currently does NOT pass it), then walk `result.metafile.inputs[].imports[]` AFTER bundle, BEFORE swc; throw if any `src/discord/` module transitively reaches `src/core/stegcloak.ts` via a **value** import:
```javascript
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
> esbuild erases `import type {…}` before producing the metafile, so `encrypt.ts`'s `import type { RandomBytes }` will **not** false-trip the guard (A2 — confirm during implementation; add a regression test that the guard *would* fire on a real value import). Use array index loops in this script too for consistency (it's Node, so `for...of` is actually fine here — the iterator-lowering risk is Hermes-only — but matching the convention costs nothing).

---

### `tests/harness.ts` (test — add Wave 0 assertions)

**Analog:** itself — the existing `check(name, cond, detail)` helper and numbered sections are the template.

**Assertion helper to reuse** (lines 25-33):
```typescript
function check(name: string, cond: boolean, detail = "") {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
}
```

**Wave 0 assertions to add** (RESEARCH "Wave 0 Gaps", lines 578-584):
1. **ProbeReport serialization round-trip** — build a ProbeReport → `JSON.stringify` → parse → deep-equal. Proves the schema persists off-device. New numbered section `[7]`.
2. **`nextTick` macrotask-form assertion** — `import { nextTick } from "@noble/hashes/utils"`; assert `String(nextTick)` is NOT the empty-async-arrow microtask form. Catches the caret regression in CI, not just on-device. (Note: under the test bundle the build-time patch may or may not apply — coordinate with how `scripts/test.mjs` bundles; the on-device `assertMacrotaskYield()` is the runtime counterpart.)
3. **D-09 reference-key vector** — `deriveKey(VEC_PW, "1234567890123456789")` equals a committed 32-byte expected value, cross-checked against stegcloak-rs. Reuse the existing `CHANNEL = "1234567890123456789"` (line 35) — the 19-byte snowflake salt is already the harness convention. (Overlaps Phase-2 GATE-01 — Phase 1 needs only the reference *value*, not the full structural gate. Coordinate to avoid duplication; if the planner defers the committed vector to Phase 2, compute the noble reference on-device at test time instead.)

---

## Shared Patterns

### Persistence via `settings()` + `DEFAULTS` (NOT raw `plugin.storage`)
**Source:** `src/settings.ts:22-44`, `src/core/keycache.ts:32-35`
**Apply to:** ProbeReport, `nativeProbeArmed`, `debugInstrument`
The reactive proxy persists JSON across restarts. Add new fields to `DEFAULTS` so they default cleanly and round-trip; read/write via the `settings()` accessor only (the established anti-pattern guard — raw `plugin.storage` access is forbidden).
```typescript
export interface Settings extends KeyCacheStore {
    enabled: boolean;
    passwords: string;
    // … existing fields …
    allowInsecureRng: boolean;
    // ADD (planner finalizes the schema — Claude's discretion):
    // nativeProbe?: ProbeReport | null;
    // nativeProbeArmed?: string | null;
    // debugInstrument?: boolean;
}
export const DEFAULTS: Settings = {
    enabled: false, passwords: "", cover: "", mark: "🔒 ",
    chosenIndex: 0, allowInsecureRng: false, keys: {},
    // ADD: nativeProbe: null, nativeProbeArmed: null, debugInstrument: false,
};
```
`initSettings` (lines 34-39) back-fills any `undefined` field from `DEFAULTS`, so existing installs migrate with no data loss.

### Error handling — `safe()` wrap, `noteError()` counters, return-null-on-miss
**Source:** `src/index.ts:29-38` (`safe`), `src/core/health.ts:12-23` (`noteError` / `healthSummary`), `src/core/keycache.ts:67-78` (return null)
**Apply to:** all new probe/instrumentation code
- Wrap every on-load subsystem init in `safe(label, fn)` — one failure can't cascade.
- Silent hot-path / dispatch-hook failures → `noteError(kind, e)` (accumulate, surface via `/encrypt status`), never throw inside a Flux hook.
- Functions that miss on a hot path return `null`, not throw.
- Unknown catch params: `(e as Error)?.message ?? String(e)` (used in `index.ts`, `random.ts`, RESEARCH Pattern 2).
- Best-effort teardown: `try { unpatch() } catch {}` (`flux.ts:106-114`, `send.ts:77-86`, `commands.ts:138-147`).

### Hermes-safe build constraints (HARD — enforced by `build.mjs` gates)
**Source:** `scripts/build.mjs:79-91`, `src/selfTest.ts`, CLAUDE.md
**Apply to:** ALL new `src/` code (probe, instrumentation)
- **No `class`** — module-level `let` + functions (mirror `random.ts`).
- **No generators / `yield`.**
- **No `for...of` over a `Map`/`Set`** — array index loops only (`for (let i = 0; i < arr.length; i++)`); the iterator-protocol lowering drops the first element under Discord's Hermes.
- **`Uint8Array` only** — no `Buffer`.
- **No `TextEncoder`/`TextDecoder`/`atob`/`btoa` assumption** — use `utf8Encode`/`utf8Decode` (`crypto/deflate.ts`) and `toBase64`/`fromBase64` (`util/base64.ts`).
- Verification: `npm run build` throws loudly on a violation; `npm test` keeps the byte-compat harness green. Run both per task commit.

### Byte comparison — reuse `eqBytes`
**Source:** `src/selfTest.ts:12-16`
**Apply to:** D-09 byte-match in `nativeProbe.ts`
Index-loop, length-checked, Hermes-safe. Do not write a new comparator.
```typescript
function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
```

### Lazy host resolution — but re-resolve, don't cache-and-trust
**Source:** `src/discord/metro.ts:7-24` (the pattern) + its `_msgActions` bug (CONCERNS.md anti-pattern)
**Apply to:** native handle resolution in `nativeProbe.ts`
Resolve host surfaces lazily (`vendetta.metro.findByProps(...)`, `globalThis.__turboModuleProxy(...)`) wrapped in `try/catch`, but **re-resolve on each manual `/encrypt diag --test`** — the `_msgActions ??=` memoization (`metro.ts:10`) is a known stale-handle bug to avoid.

---

## Completed Audit: Sync-`deriveKey` Import Graph (SPIKE-03 / D-07 deliverable)

**Verified this session against the live tree** — the audit RESEARCH.md claimed is reconfirmed:

| Question | Finding |
|----------|---------|
| Who value-imports `crypto/argon`'s **sync** `deriveKey`? | **Only `src/core/stegcloak.ts:12`** (`import { deriveKey }`). `keycache.ts:17` imports the **async** `deriveKeyAsync`; `commands.ts:9` imports only `benchOnce`. |
| Who value-imports `core/stegcloak.ts`? | **Nobody in `src/`.** `core/encrypt.ts:9` imports only `import type { RandomBytes }` (type-only — erased at build). `hide`/`reveal` are called only by `tests/harness.ts:12` (off-device CI). |
| Does any `src/discord/` hot path reach the sync 64 MiB derive? | **NO.** Both `flux.ts:10` and `send.ts:12` call `keycache.deriveKey` (the **async** one). The name collision (`deriveKey` exists in both `crypto/argon` sync and `core/keycache` async) is the trap; the imports resolve to the async variant. |

**Conclusion (HIGH confidence):** the first-encrypt freeze is **NOT a sync-derive leak in the current tree**. The diagnosis must focus on the other four candidates: nextTick macrotask regression (caret risk), coarse `asyncTick:50`, the `LOAD_MESSAGES_SUCCESS` concurrency storm, and a front-loaded first pass. The D-07 build guard makes this clean invariant **permanent** (blocks a future stray `discord → core/stegcloak` value import).

---

## No Analog Found

| File / Mechanism | Role | Data Flow | Reason | Planner source |
|------------------|------|-----------|--------|----------------|
| Armed-flag poison detection (`testCandidate` / `reconcileArmedFlag` in `nativeProbe.ts`) | discord / crash-safety | event-driven (persist-before-call) | No crash-safe persisted-flag pattern exists in the repo. The `pending` Map dedup (`keycache.ts:86-97`) is the closest *shape* but is in-memory, not crash-survival. | RESEARCH "Pattern 2" (lines 264-303) + D-05; verify storage flush timing on-device (A1 / Pitfall 4). |
| `setInterval(0)` yield sampler (`deriveKeyAsync` instrumentation) | crypto / measurement | streaming (timing samples) | No timing-sampler precedent; `benchOnce` only measures total wall-time. | RESEARCH "Pattern 3" (lines 306-339); noble's internal yield count is not directly observable (A4) — sampler proves "macrotasks firing" vs "thread starved". |

---

## Metadata

**Analog search scope:** `src/discord/` (nativeProbe target + commands/flux/send/index/metro), `src/crypto/` (argon, random), `src/core/` (keycache, health, stegcloak, encrypt), `src/` (settings, selfTest), `scripts/` (build.mjs), `tests/` (harness.ts), repo root (`diagnose2.txt`).
**Files scanned (read in full):** 14 source/build/test files + `diagnose2.txt` + both planning inputs.
**Import-graph audit:** re-verified via grep this session (sync `deriveKey` reachability — clean).
**Pattern extraction date:** 2026-05-30
