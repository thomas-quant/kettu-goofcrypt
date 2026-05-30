# Project Research Summary

**Project:** GoofCrypt (mobile) — native-speed Argon2id milestone
**Domain:** Native-crypto reachability + fallback chain for a Hermes/Kettu Discord-mobile plugin, byte-exact with stegcloak-rs/GoofCord
**Researched:** 2026-05-30
**Confidence:** HIGH on the blocking verdict; MEDIUM-LOW only on whether ANY native Argon2 is reachable on-device (the probe must settle this — and even a positive result is salt-blocked)

## Executive Summary

**The verdict is RED, and it is consistent across all four research dimensions: a byte-compatible native Argon2id is almost certainly NOT achievable in this sandbox.** The blocker is not parameters or output encoding — those are exactly expressible by libsodium's public `crypto_pwhash` (`opslimit=3` → t=3, `memlimit=67108864` → m=64 MiB, `ALG_ARGON2ID13` → v0x13, 32-byte raw output, all verified against source). The blocker is **salt length**: `crypto_pwhash` hardcodes a fixed 16-byte salt, while stegcloak-rs/GoofCord uses the raw channelId (~18–19-byte snowflake) as the salt. The only Argon2 entry point that accepts an arbitrary-length salt is the internal `argon2id_hash_raw`, which is **not in libsodium's exported public ABI** and therefore will not surface through any React-Native sodium binding. Separately, Discord's DAVE/MLS stack uses no Argon2 (HKDF/MLS-Exporter + scrypt only), Hermes has no WebAssembly (ruling out every fast JS Argon2), and Hermes is ~15× slower than JSC at the 64-bit rotation ops Argon2's inner loop is dominated by — so no pure-JS path reaches "instant" either.

**Therefore the milestone's real shape is: SPIKE → GATE → FALLBACKS, with native treated as a verified-or-rejected branch, not the expected deliverable.** The roadmap must front-load (1) a spike that definitively settles native reachability by *capturing* the existing `diagnose2.txt` probe output on-device AND diagnoses why the already-"fixed" async path still freezes on first encrypt; and (2) a byte-equality test-vector GATE, built first, as the single load-bearing safeguard — never trust ANY derivation path (native, JS, or imported) until it reproduces a committed `(password, channelId) → 32-byte key` vector. The expected primary delivery is the **fallback stack**: seamless/automatic desktop→mobile key-sync (run the 64 MiB derivation where 64-bit ops are fast — the user's own desktop), fixing the first-encrypt freeze (diagnose + harden the async route so no synchronous derive ever runs on a Discord thread), non-blocking UX (warming, progress), and hardening key-sync (base64 non-ASCII bug + import shape validation) so it is safe to rely on as the main mitigation.

**Key risk and mitigation:** the catastrophic failure mode is a native (or imported) path that produces the *wrong 32 bytes* — silently, because CI stays green (it only exercises the JS path) and mobile↔mobile self-consistency hides it; only real GoofCord interop reveals the break, by which point poisoned keys are persisted on users' devices. The mitigation is structural: the byte-equality vector gate is built *before* any native path can write to the key cache, native is gated on `verified` (not `found`), and `injectNativeArgon` forcibly resets the verified flag so the gate is unbypassable.

## Key Findings

### Recommended Stack

The native path is **RED for byte-compatibility** and should not be pursued as the milestone's deliverable; it is only a spike-gated branch that activates if (and only if) the on-device probe surfaces a reachable Argon2 that both accepts a ~19-byte salt and returns a raw 32-byte key — an outcome the research rates as unlikely because it would require an exposed `argon2id_hash_raw`-equivalent. The recommended stack is the **incumbent plus fallbacks**: keep `@noble/hashes` (the only thing that reproduces the derivation byte-for-byte today) and make the *same* derivation fast by running it off-device (desktop key-sync) or by hiding its latency (warming/async UX), never by changing the algorithm. See STACK.md.

**Core technologies:**
- **`@noble/hashes@1.8.0` argon2id (INCUMBENT, pinned)** — byte-compatible Argon2id KDF — the only path that actually reproduces the GoofCord derivation; correct but Hermes-slow. Keep it; optimize *around* it. **Pin exact (drop the caret)** — a minor bump can regress the build-time `nextTick` macrotask patch and silently re-freeze.
- **Desktop key-sync (`tools/derive-keys.mjs` + `/encrypt import`)** — moves the 64 MiB derivation off-device entirely — the strongest real fix; native-speed Argon2 happens on desktop where the salt is a non-issue, keys are imported. Already shipped; make it seamless/automatic.
- **Reachable host libsodium `crypto_pwhash`** — native Argon2id — **PROBE FIRST, but RED for byte-compat** (fixed 16-byte salt cannot encode the channelId). Record findings; do not adopt.
- **Ruled out:** Discord DAVE/MLS (no Argon2 — HKDF/MLS-Exporter + scrypt(16384,8,2)), `crypto.subtle` (not native in Hermes; PBKDF2 ≠ Argon2), `hash-wasm`/`argon2-browser`/`openpgpjs argon2id` (all need WASM — Hermes has none), hand-optimized JS (capped by Hermes's ~15× 64-bit-op penalty).

### Expected Features

The feature set is organized around a **spike → gate → fast-path → fallback** spine, and the fallbacks must be fully shippable *even if the native path never lands*. See FEATURES.md.

**Must have (table stakes — milestone fails without these):**
- **Persisted native-crypto probe** — capture and store the `diagnose2.txt` answer (currently fire-and-forget); cheapest item, unblocks everything.
- **Fixed KDF test vector + byte-equality self-check gate + path quarantine** — non-negotiable safety; no unverified path may ever produce a real key. The linchpin.
- **Non-freezing first-encrypt UX (diagnose + harden)** — the literal milestone goal; guarantee no sync `deriveKey` ever runs on a Discord thread.
- **Per-path derivation benchmark** + **active-path status visibility** (`/encrypt status` shows `native(verified) | js | imported`) — data-driven decisions + trust.
- **CI harness stays green** (+ add the KDF vector to it) — the hard compatibility gate.

**Should have (differentiators):**
- **Native Argon2 fast-path (verified)** — the headline win, but reachability is UNCERTAIN and likely impossible; strictly gated behind the byte-equality check. P2, may never land.
- **Frictionless key-sync (clipboard auto-detect first)** — turns "import keys" from a power-user chore into the default mitigation; buildable with no native crypto.
- **Bundle-shape validation on import** — makes key-sync trustworthy (fixes a known silent-corruption bug).
- **Optimised async JS path + proactive channel warming** — the only levers on raw on-device responsiveness if native is blocked.

**Defer (v2+):**
- **QR-based key-sync** — depends on an uncertain camera/QR module reachable from Kettu.
- **Deep-link import (`goofcrypt://import`)** — depends on uncertain Kettu URL-handler support.

**Anti-features (explicitly NOT built):** unverified native fast-path, changing KDF params/salt to fit a 16-byte API, v2 wire format, server-side derivation, raw-password-as-key, silent degraded fallbacks, blocking "wait 10s" spinner.

### Architecture Approach

Slot the native path and fallback chain into the existing strictly-layered graph (`discord → core → {crypto, stego, util}`) **without breaking the layering**: the discord layer (`nativeProbe.ts`) is the only code that touches `vendetta.*`/`nativeModuleProxy`/metro; it resolves a candidate and **injects a plain function** into a pure crypto-layer registry (`nativeArgon.ts`) — dependency injection, mirroring the existing `random.ts` precedent. Selection is split by responsibility: cache/import tiers stay in `keycache.deriveKey` (already there), engine tiers (native vs JS) live entirely inside `deriveKeyAsync` in `argon.ts`, which keeps its signature. The native path is **architecturally un-trustable until a byte-equality gate passes**. See ARCHITECTURE.md.

**Major components:**
1. **`discord/nativeProbe.ts` (NEW)** — scans the native surface, builds a candidate adapter, builds + persists a durable `ProbeReport` (fixing the lost-`diagnose2.txt` problem); surfaced via `__goofcrypt.diag()` and `/encrypt status`.
2. **`crypto/nativeArgon.ts` (NEW, PURE)** — holds the injected adapter + a `_verified` flag; `injectNativeArgon` forcibly resets `_verified=false` so the gate is structurally unbypassable; `nativeArgonReady()` (= injected AND verified) is the only predicate selection may trust.
3. **`selfTest.ts` + `tests/harness.ts` (CHANGED)** — the load-time fixed-vector gate (`markNativeVerified`) and its CI-proven source-of-truth vector (cross-checked against stegcloak-rs WASM so the expected key can't be a trusted typo).
4. **`crypto/argon.ts` + `core/keycache.ts` (CHANGED)** — `deriveKeyAsync` consults `nativeArgonReady()` with try/catch fall-through to noble; keycache cold-path selection chain (native → imported → optimized-JS). New code must pass the build's class/generator/iterator regex gates (no `class`, no `for...of` over Map/Set in hot paths, `Uint8Array` only).

### Critical Pitfalls

1. **Trusting any derivation that hasn't passed an on-device byte-equality check (the master gate)** — every other pitfall is a way to silently produce the wrong 32 bytes. Build a committed `(password, real-length channelId) → 32-byte key` vector FIRST, generated by the proven sync `deriveKey()`, triple-anchored against stegcloak-rs; make it a hard runtime gate before any cache/persist AND a CI assertion. This is the keystone — built before native-impl, not after.
2. **Salt-length mismatch** — `crypto_pwhash` enforces a fixed 16-byte salt; a wrapper that pads/truncates/hashes the ~19-byte channelId "succeeds" and returns a *different* key → silent interop break. Avoid: probe specifically for a `saltlen`-flexible/raw entry point; if only fixed-16-byte is reachable, **disqualify libsodium for native derivation**. A real-length test vector is the only proof the salt passed through untouched.
3. **Param/version & output-encoding mismatch** — `opslimit/memlimit` are NOT `t/m` (only the raw API sets `t=3` directly), and v0x13 vs v0x10 silently differ; many APIs return a PHC string, not a raw 32-byte key. Avoid: use only a raw-output entry point with explicit `t,m,p,version`; the vector catches all of these at once (wrong length or full mismatch).
4. **"Already fixed" async path STILL freezes** — diagnose, don't guess: is a sync `deriveKey` (via `core/stegcloak.ts`) reached on a hot path? Did the build-time `nextTick` macrotask regex patch regress (caret on noble)? Is `asyncTick:50` too coarse? Is it N concurrent derivations on `LOAD_MESSAGES_SUCCESS` flooding macrotasks? Instrument yield-count on-device; pin noble exactly + runtime-assert `nextTick` is the macrotask form.
5. **Native-module fragility + security-weakening silent fallbacks** — present-but-wrong modules, stale metro handles (the `_msgActions` bug class), failing *toward corruption* instead of toward JS; raw-password-as-key and `Math.random` nonces must NEVER be fallbacks. Avoid: gate every native derivation behind the per-session vector re-check, resolve lazily and re-validate on use, fall back to JS loudly-in-status on any failure, and always surface the active derivation path + RNG source.

## Implications for Roadmap

Based on research, the suggested phase structure is **de-risk-first**: front-load the spike and the verification machinery, then ship the fallbacks (the expected primary delivery), treating native as a verified-or-rejected branch.

### Phase 1: Spike — capture the probe output + diagnose the freeze
**Rationale:** Native-module reachability is the single biggest unknown, and the probe output "was never recorded" — the milestone literally cannot conclude the native decision without it. The freeze diagnosis is independent and can run in parallel. Cheapest items, highest unblocking value. (FEATURES: persisted probe is P1/LOW and "unblocks everything"; ARCHITECTURE build order step 1 + step 6; PITFALLS spike phase.)
**Delivers:** A durable, persisted `ProbeReport` (via `discord/nativeProbe.ts`) surfaced on `__goofcrypt.diag()` + `/encrypt status`; a per-path `/encrypt bench` using the real params; and a written diagnosis of *why* first-encrypt still janks (sync-path audit, `nextTick`-is-macrotask runtime assertion, yield-count instrumentation, concurrency check).
**Addresses:** Persisted native-crypto probe; per-path benchmark; non-freezing UX diagnosis (table stakes).
**Avoids:** Pitfall 4 (salt-length — answered by the probe's salt-acceptance test) and Pitfall 5 (the still-freezes mystery — measured, not assumed).

### Phase 2: The byte-equality gate (built FIRST, before any native use)
**Rationale:** PITFALLS is explicit — the master gate is "Hardening, built FIRST," and ARCHITECTURE makes it a hard predecessor to native selection ("never wire selection before the gate exists"). The adapter is untrustable without a proven target; build the target first.
**Delivers:** A committed `(password, real-length channelId) → 32-byte key` vector in `tests/harness.ts`, asserted against both noble and stegcloak-rs WASM (so the expected key can't be a trusted typo); a CI assertion gating the build; and the `crypto/nativeArgon.ts` injected registry + `selfTest.verifyNativeArgon()` gate (`injectNativeArgon` resets `_verified=false`; `nativeArgonReady` = injected AND verified).
**Uses:** Existing `selfTest.ts` byte-equality (`eqBytes`) surface; existing `tests/harness.ts` WASM cross-check (STACK: CI harness is the gate).
**Implements:** ARCHITECTURE components 2 + 3 (native registry, vector gate); the unbypassable verified-flag invariant.
**Avoids:** Pitfalls 1, 2, 3, 8 (every wrong-32-bytes failure mode at once).

### Phase 3: Fallback delivery — the milestone's primary deliverable
**Rationale:** Native is RED for byte-compat (STACK verdict); the fallbacks must carry the milestone and be shippable *even if native never lands* (FEATURES "single most important design fact"). This is where the freeze actually gets fixed.
**Delivers:** (a) Harden the non-freezing send path so no sync derive runs on a Discord thread + the diagnosed fix from Phase 1 (lower `asyncTick`, serialize cold-channel derivations, pin noble exactly); (b) seamless/automatic key-sync — clipboard auto-detect of a `goofcrypt:`-prefixed bundle for one-tap import; (c) key-sync hardening — fix the `base64.ts` non-ASCII bounds bug and add `importKeys` shape validation + a round-trip harness test; (d) proactive channel-open warming + `warm()` after Settings Save; (e) active-path status visibility (`/encrypt status` shows KDF path + RNG source).
**Addresses:** Frictionless key-sync, optimised async JS path, proactive warming, bundle-shape validation, status visibility (FEATURES P1/P2 fallbacks).
**Avoids:** Pitfalls 5 (freeze), 6 (silent security-weakening — surface the active path; never raw-password-as-key), 7 (key-sync correctness bugs becoming load-bearing).

### Phase 4 (conditional): Native fast-path — ONLY if the spike turns it GREEN
**Rationale:** Activated *iff* Phase 1's probe surfaced a reachable Argon2 that accepts a ~19-byte salt AND returns a raw 32-byte key (research rates this unlikely). Strictly gated behind Phase 2.
**Delivers:** `deriveKeyAsync` consults `nativeArgonReady()` with try/catch fall-through to noble; native used only after it reproduces the committed vector on-device, behind a feature flag with the JS path retained.
**Uses:** A reachable arbitrary-salt raw-output native entry point (STACK: would require an exposed `argon2id_hash_raw`-equivalent).
**Avoids:** Pitfall 4/5 (lazy-resolve + per-session re-validation + fall-back-to-JS-loudly; never persist an unverified native key).

### Phase Ordering Rationale

- **De-risk the unknown first:** native reachability is the only MEDIUM-LOW input; capture the probe (Phase 1) before committing any native work. The freeze diagnosis runs in parallel because it is native-independent and may make native moot.
- **Verification machinery is a hard predecessor to native selection** (ARCHITECTURE + PITFALLS agree): the byte-equality gate (Phase 2) must exist before any native path can write a real key (Phase 4). Building native without the gate is the central risk this milestone exists to avoid.
- **Fallbacks before (conditional) native:** native is RED for byte-compat and likely unreachable, so the fallbacks (Phase 3) are the actual deliverable and ship regardless. Phase 4 is a branch the spike either opens or closes.
- **Layering preserved throughout:** discord-layer probe injects into pure crypto-layer registry; no edge points up the graph. New code passes the build regex gates by construction (functions + `let` singletons + array-index loops).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Spike):** Native-module reachability inside the Discord/Hermes sandbox is undocumented (MEDIUM-LOW confidence) — `/gsd-plan-phase --research-phase` not needed (the spike *is* the research), but planning must treat the probe output as a true unknown and design both branches.
- **Phase 4 (Native fast-path):** Only reachable if the spike turns GREEN; if it does, planning needs deeper research into the specific reachable module's signature, return type (PHC vs raw), and salt handling. Defer this research until the spike verdict is known.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Gate):** Reuses the existing `selfTest.ts` byte-equality surface and `tests/harness.ts` WASM cross-check — well-understood, codebase-grounded.
- **Phase 3 (Fallbacks):** Key-sync, base64 fix, import validation, warming, and async-yield tuning are all codebase-grounded ("harden, not greenfield") — standard patterns against known files.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Blocking facts (salt length, param mapping, no-WASM, Hermes 64-bit penalty, DAVE=no-Argon2) verified against libsodium/noble/Hermes/DAVE sources. Only MEDIUM-LOW on whether ANY native Argon2 is even reachable — and even a hit is salt-capped. |
| Features | HIGH | Grounded in the existing codebase map + source; the spike->gate->fast-path->fallback spine is consistent with the stack verdict. |
| Architecture | HIGH | Codebase-grounded (mirrors the `random.ts` DI precedent, reuses `selfTest.ts`/`harness.ts`); the one MEDIUM input (native reachability) is handled by design as a runtime gate, not an assumption. |
| Pitfalls | HIGH | Interop/crypto mechanics verified against libsodium + noble source; MEDIUM only on native reachability (the same uncaptured-probe unknown). |

**Overall confidence:** HIGH on the verdict and the build order; the one genuine unknown (native reachability) is precisely what Phase 1 settles, and the architecture makes a wrong answer safe by design.

### Gaps to Address

- **Native-module reachability on real devices:** the `diagnose2.txt` probe output was never captured — this is the milestone's central unknown. Handle in Phase 1 by persisting the `ProbeReport`; design Phase 3 (fallbacks) to ship regardless and Phase 4 (native) to activate only on a GREEN spike.
- **Why the "already fixed" async path still freezes:** five candidate root causes (sync-path leak, `nextTick` regex regression, coarse `asyncTick`, concurrency flooding, front-loaded first pass). Handle in Phase 1 by instrumenting (yield-count, `nextTick.toString()` assertion, sync-path import audit) before fixing in Phase 3.
- **Key-sync determinism contract:** the undocumented `passwordId()`/base64/sha256 coupling between `tools/derive-keys.mjs` and the plugin — pin it with a round-trip harness test (Phase 3) before key-sync is relied on as the primary fallback.
- **If the spike turns GREEN (unlikely):** the reachable module's exact signature, return encoding (PHC vs raw), and salt handling are unknown until the probe lands — defer to Phase 4 planning.

## Sources

### Primary (HIGH confidence)
- libsodium `pwhash_argon2id.c` / `argon2.h` / pwhash API docs — verified `t_cost=opslimit`, `m_cost=memlimit/1024`, fixed `SALTBYTES=16`, ALG_ARGON2ID13 raw output, and that `argon2id_hash_raw` (arbitrary salt) is not `SODIUM_EXPORT`. https://libsodium.gitbook.io/doc/password_hashing/default_phf
- Discord DAVE protocol whitepaper — MLS 1.0 ciphersuite 2, AES-128-GCM, scrypt(16384,8,2), no Argon2. https://daveprotocol.com/ , https://github.com/discord/dave-protocol/blob/main/protocol.md
- facebook/hermes #569 — Hermes ~15x slower than JSC on 64-bit bitwise/`rotr64` ops. https://github.com/facebook/hermes/issues/569
- noble-hashes `argon2idAsync` yield mechanics + default microtask `nextTick`. https://github.com/paulmillr/noble-hashes/blob/main/src/argon2.ts
- Codebase primary source: `src/crypto/argon.ts`, `src/crypto/random.ts`, `src/core/keycache.ts`, `src/discord/send.ts`, `src/discord/flux.ts`, `src/discord/commands.ts`, `src/selfTest.ts`, `tests/harness.ts`, `src/util/base64.ts`, `scripts/build.mjs`, `diagnose2.txt`; `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`.

### Secondary (MEDIUM confidence)
- libsodium issue #717 — maintainer keeps the public salt fixed at 128 bits by design. https://github.com/jedisct1/libsodium/issues/717
- react-native-sodium / react-native-aes-crypto — representative RN crypto module surfaces (how `crypto_pwhash`/pbkdf2/aes get exposed; none expose Argon2 with arbitrary salt). https://github.com/lyubo/react-native-sodium , https://github.com/MuevoApp/react-native-aes-crypto

### Tertiary (LOW confidence — needs on-device validation)
- Whether Discord's mobile bundle surfaces ANY Argon2/libsodium through `nativeModuleProxy`/`__turboModuleProxy`/metro — undocumented; the Phase 1 probe must settle it. Even a positive hit is capped by the 16-byte-salt public API.

---
*Research completed: 2026-05-30*
*Ready for roadmap: yes*
