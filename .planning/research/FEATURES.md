# Feature Research

**Domain:** Native-speed Argon2id KDF for a Hermes/Kettu Discord-mobile crypto plugin (performance milestone — eliminate the ~10s first-encrypt UI freeze while preserving byte-compatibility with stegcloak-rs/GoofCord)
**Researched:** 2026-05-30
**Confidence:** HIGH (grounded in the existing codebase map + source; native-reachability claims verified against libsodium docs/source)

> Scope note: This is a SUBSEQUENT milestone on a working plugin. Every capability below is specific to the *speed/freeze* problem and its de-risking. Generic plugin features (send patch, ZWC stego, multi-password, wire-format compat) already ship and are NOT re-litigated here — they are constraints, not features.

> Framing: "Native reachability is uncertain." The feature set is therefore organised around a **spike → gate → fast-path → fallback** spine. The fallbacks must be fully shippable *even if the native path never lands*. That is the single most important design fact in this document.

## Feature Landscape

### Table Stakes (Milestone fails without these)

These are non-negotiable. Missing any one means either the milestone goal is unmet (UI still freezes) or the core value (byte-exact GoofCord interop) is silently broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Byte-equality self-check gate** (fixed test vector → 32-byte key) | A native KDF that is even one byte off silently corrupts every message; it must NEVER be trusted without proof | MEDIUM | One hardcoded vector `(password, channelId) → expected 32B base64`, computed once by the trusted `@noble/hashes` path / `derive-keys.mjs`. Any candidate derivation path must reproduce it *exactly* before it is allowed to produce real keys. This is the linchpin — see Anti-Features for what happens without it. |
| **Path-gating: candidate paths are quarantined until verified** | The self-check is worthless if the unverified path can still write to the key cache | MEDIUM | The active derivation function is selected once, after the gate passes, behind a single seam (e.g. `selectDeriveImpl()`). `deriveKeyAsync` keeps calling the verified impl; on gate failure it stays on the noble JS path. No code path may reach a native impl that hasn't passed the vector check. |
| **Non-freezing first-encrypt UX** ("deriving… / send again" never blocks the event loop) | The literal milestone goal: "first-encrypt no longer freezes the UI". Hermes is single-threaded; a sync 64 MiB Argon2 = ~10s frozen render loop | MEDIUM | A send path already rejects-and-warms (`src/discord/send.ts:59-62`) and a flux path already background-derives (`src/discord/flux.ts:40-72`). The freeze is *still reported*, so this is **diagnose + harden**, not greenfield. Must guarantee no sync `deriveKey` (the `stegcloak.ts`/`argon.ts` sync variant) ever runs on a Discord-thread code path. |
| **Active-path status visibility** (`/encrypt status` shows which KDF is live) | Trust requirement: the user (and the developer debugging the freeze) must be able to tell whether keys are coming from native / JS / imported, and whether the gate passed | LOW | Extend the existing `/encrypt status` toast (`src/discord/commands.ts:118-125`) with `KDF: native(verified) | js | imported`. Cheap, high-trust-value. |
| **Persisted on-device native-crypto probe** (capture, don't just ask) | The current `diagnose2.txt` probe records nothing — "we have the question, not the answer". Without captured results the spike cannot conclude | LOW–MEDIUM | Turn the one-liner in `diagnose2.txt` into a reusable function whose result is *persisted* (to `plugin.storage`) and surfaced (toast/`/encrypt diag`/copyable). Must enumerate: `nativeModuleProxy` keys, TurboModules (DAVE/MLS, `Sodium`, `Aes`), `metro.findByProps('crypto_pwhash'|'argon2id'|'scrypt')`, `crypto.subtle`. Output is the *input* to every native decision. |
| **Derivation benchmark that measures the real cost** (`/encrypt bench`) | A `/encrypt bench` already exists but times only one fixed async noble call. To compare paths it must time *each available path* | LOW | Extend `benchOnce()` (`src/crypto/argon.ts:45-49`). Measure: (a) noble async path ms, (b) native path ms *if gate passed*, (c) ideally first-yield latency / longest-block, since "still janks" implies a long synchronous chunk despite `asyncTick:50`. Bench must use the **real params** (m=65536, t=3, p=1) — a cheaper bench understates the cost. |
| **Compatibility regression gate stays green** (CI harness) | Byte-exact interop is the stated core value; "when speed and compatibility conflict, compatibility wins" | LOW (already exists) | The existing test harness cross-checks both directions vs stegcloak-rs. The milestone's job is to keep it green, and ideally to add the fixed KDF vector to it so the gate is testable off-device too. |

### Differentiators (High-value, not strictly required to clear the freeze)

These make the solution genuinely good rather than merely unfrozen. They are where the milestone competes.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Native Argon2 fast-path** (verified) | The headline win: same derivation at native speed → ~10s collapses to ~tens of ms, no freeze *and* no resend dance | HIGH (and reachability is UNCERTAIN) | Gated strictly behind the byte-equality self-check. **Reachability risk is real:** libsodium's high-level `crypto_pwhash` mandates a *fixed 16-byte salt*, but the channelId salt is ~18–19 bytes. Variable-length salt exists only in the low-level `argon2id_hash_raw()` entry point, which RN sodium bindings typically do NOT expose. So even a reachable native libsodium may be unable to reproduce the exact derivation. Treat as **spike-gated**: build only if the probe + a salt-length test prove a reachable path can hit the exact vector. |
| **Frictionless key-sync (QR / deep-link / clipboard auto-detect)** | The robust fallback. Today key-sync needs a manual base64 bundle pasted into `/encrypt import`. Making it one-tap turns "import keys" from a power-user chore into the default mitigation | MEDIUM | Concrete options, all buildable **without native crypto**: (1) **Clipboard auto-detect** — on Settings open / `/encrypt import` with no arg, sniff clipboard for a `goofcrypt:`-prefixed bundle and offer one-tap import (lowest effort, highest payoff). (2) **QR import** — desktop `derive-keys.mjs` renders a QR; mobile scans. Needs a camera/QR module reachable from Kettu (uncertain — probe it). (3) **Deep-link** — `goofcrypt://import?b=<bundle>` handled by the app; depends on Kettu URL-handler support (uncertain). Recommend clipboard auto-detect for v1; QR/deep-link deferred. |
| **Auto-import / bundle-shape validation on import** | Makes key-sync trustworthy: a malformed bundle today silently writes garbage keys (CONCERNS: `importKeys` has no shape validation; `base64.ts` mishandles non-ASCII) | LOW–MEDIUM | Validate each value is 43–44 char base64 and shape is `cid → pid → b64` before writing. Directly fixes a known correctness bug on the fallback path. Cheap insurance that makes "frictionless" safe. |
| **Optimised async JS path** (smaller `asyncTick`, chunk profiling, warm-on-save) | If native is blocked, this is the *only* lever on raw derivation responsiveness. "Still janks despite asyncTick:50" suggests the yield isn't actually breaking up the work | MEDIUM | Investigate whether noble's `argon2idAsync` + the build-time `nextTick` macrotask patch genuinely yields per `asyncTick`, or whether a single memory-fill block hogs the thread. Also wire `warm()` after Settings "Save" (known bug: Settings UI doesn't re-derive after save — `src/ui/Settings.tsx:80-84`), so derivation starts *before* the user sends, hiding latency. |
| **Proactive channel warming** (derive on channel-open, not on first-send) | Moves the unavoidable cost off the critical send moment — by the time the user sends, the key is likely cached | LOW–MEDIUM | `warm(channelId)` already exists (`commands.ts:24-28`) and is called on enable/cycle. Extend to fire on channel switch (a flux event) so the cold-cache resend toast becomes rare. Pure UX latency-hiding; no crypto change. Watch the `LOAD_MESSAGES_SUCCESS` coroutine-storm pitfall (CONCERNS) when batching. |

### Anti-Features (Tempting, but deliberately NOT built)

These would either break the core value, weaken security, or burn the milestone on dead ends.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Unverified native fast-path** ("it's native libsodium, surely it matches") | Native is fast; skipping the byte-check ships sooner | A native Argon2 that differs by *one byte* (wrong salt handling, wrong version flag, off-by-one param) silently produces keys that GoofCord can't decrypt and that can't decrypt GoofCord — corrupting interop invisibly. This is the catastrophic failure mode the milestone exists to avoid. | **Byte-equality self-check gate** (table stakes). Native is ONLY ever used after it reproduces the fixed vector exactly. |
| **Changing KDF algorithm / params to something JS-fast** (e.g. fewer iterations, scrypt, PBKDF2, smaller memory) | Pure-JS Argon2 is slow *because* of 64 MiB; weaker params would be instant | Breaks byte-compat with GoofCord, which is fixed/third-party. Out of scope per PROJECT.md. Also silently weakens the security model. | Keep params identical; attack *execution speed* (native) or *latency hiding* (warming/key-sync), never the algorithm. |
| **Server-side / remote derivation** | A server with native code could derive instantly and hand back keys | Defeats the privacy model, violates the fully-static no-server constraint, and turns a casual-privacy plugin into a key-escrow service. | Desktop `derive-keys.mjs` key-sync — derivation happens on the *user's own* trusted desktop, never a server. |
| **Bundling a native module / WASM Argon2 into the plugin** | Would give a fast KDF the plugin controls | Kettu plugins can't ship native code (only reach host-provided modules); Hermes has no WebAssembly. Both are hard platform walls. | Probe for *host-provided* native crypto; otherwise fall back to JS + key-sync. |
| **Silent fallback that hides a failed/blocked native path** | "Just keep working" — degrade quietly | Silently weakening or switching crypto paths violates the trust requirement and makes the freeze/interop bugs undiagnosable. The user can't tell a verified-native session from a degraded one. | **Active-path status visibility** (table stakes): always surface which path is live and whether the gate passed. Fall back *loudly*. |
| **v2 wire format / migration to "fix" the salt-length problem** | A 16-byte salt would let the high-level libsodium `crypto_pwhash` be used directly | Introducing a v2 format breaks interop with every existing GoofCord message and the desktop client — the exact thing the core value forbids. | Find a low-level native entry point that accepts the real salt, or don't use native at all. The wire format is immutable. |
| **Blocking "please wait 10s" spinner on send** | Simpler than the resend dance; at least it's honest | Still freezes/blocks the user at the worst moment (mid-send) and the milestone's literal goal is *no freeze*. | Non-blocking deriving/resend UX + proactive warming so the wait is invisible, not just visible. |

## Feature Dependencies

```
Persisted native-crypto probe (capture results)
    └──gates──> Native fast-path reachability decision
                    └──requires──> Byte-equality self-check gate
                                       └──requires──> Fixed KDF test vector
                                       └──requires──> Path-gating (quarantine until verified)
                    └──requires──> Salt-length compatibility confirmation (18-19B salt)

Derivation benchmark (per-path) ──informs──> "is native worth it / is JS path good enough"

Byte-equality self-check gate ──feeds──> Active-path status visibility

Frictionless key-sync ──requires──> Bundle-shape validation on import (safety)
                      ──enhances──> the no-native fallback story

Optimised async JS path ──enhances──> Non-freezing UX (the fallback if native blocked)
Proactive channel warming ──enhances──> Non-freezing UX (hides latency on every path)

[Native fast-path] ──conflicts(if unverified)──> [Byte-exact interop]   # the gate resolves this
```

### Dependency Notes

- **Probe gates the native decision:** No native work should start before the probe is captured and persisted on a real device. The probe is the cheapest item and unblocks the most expensive one — sequence it first.
- **Self-check gate requires the fixed vector:** The vector (one `password + channelId → 32-byte key`, precomputed by the trusted noble/desktop path) is the ground truth the gate compares against. Build the vector before the gate.
- **Native fast-path requires BOTH the gate AND salt-length confirmation:** Reachability is two independent risks — (1) is *any* native Argon2 reachable from Kettu, and (2) can it take a ~18–19-byte salt (high-level libsodium can't; only low-level `argon2id_hash_raw` can). Both must clear or the fast-path is dead and the fallbacks carry the milestone.
- **Frictionless key-sync requires shape validation:** Making import one-tap multiplies how often bad bundles get imported; the existing silent-garbage-write bug must be fixed first or "frictionless" becomes "frictionless corruption".
- **Status visibility depends on the gate:** It can only report `native(verified)` if the gate produced a verdict. Build the gate, then expose its result.
- **JS-path optimisation conflicts with nothing** and is the safe floor: it ships regardless of whether native is ever reached.

## MVP Definition

### Launch With (v1) — the milestone's must-haves

The de-risking + a guaranteed-shippable fallback. This clears the freeze *even if native is blocked*.

- [ ] **Persisted native-crypto probe** — captures and stores the answer the milestone needs; cheapest, unblocks everything
- [ ] **Fixed KDF test vector** — ground truth for any future native trust decision
- [ ] **Byte-equality self-check gate + path quarantine** — non-negotiable safety; ensures no unverified path ever produces real keys (even if v1 ships with native OFF, the gate must exist before native is ever flipped on)
- [ ] **Hardened non-freezing UX** — diagnose *why* it still janks despite the async path; guarantee no sync derive on a Discord thread; this is the literal milestone goal
- [ ] **Per-path derivation benchmark** — so the "native worth it?" / "JS good enough?" call is data-driven
- [ ] **Active-path status visibility** — `/encrypt status` reports the live KDF + gate verdict
- [ ] **Bundle-shape validation on import** — makes the fallback path trustworthy (fixes a known silent-corruption bug)
- [ ] **CI harness stays green** (+ add the KDF vector to it) — compatibility hard gate

### Add After Validation (v1.x)

Add once the spike verdict is known and the floor is solid.

- [ ] **Native Argon2 fast-path** — *only if* the probe + salt-length test prove a reachable, vector-passing path. Trigger: gate goes green on a real device. (HIGH complexity; genuinely may be impossible.)
- [ ] **Clipboard auto-detect key-sync** — turns the JS fallback into a near-instant experience with minimal effort. Trigger: ship after import validation lands.
- [ ] **Optimised async JS path** (smaller asyncTick / chunked fill) — Trigger: if native is blocked, this becomes the primary responsiveness lever.
- [ ] **Proactive channel-open warming** — Trigger: once `warm()` is reliable and the coroutine-storm batching is handled.

### Future Consideration (v2+)

- [ ] **QR-based key-sync** — defer: depends on an uncertain camera/QR module reachable from Kettu; clipboard covers 90% of the value first.
- [ ] **Deep-link import (`goofcrypt://import`)** — defer: depends on uncertain Kettu URL-handler support.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Persisted native-crypto probe | HIGH (unblocks the spike) | LOW | P1 |
| Fixed KDF test vector | HIGH (safety ground truth) | LOW | P1 |
| Byte-equality self-check gate + quarantine | HIGH (catastrophic-bug prevention) | MEDIUM | P1 |
| Non-freezing UX (diagnose + harden) | HIGH (the milestone goal) | MEDIUM | P1 |
| Per-path benchmark | MEDIUM (decision support) | LOW | P1 |
| Active-path status visibility | MEDIUM (trust) | LOW | P1 |
| Bundle-shape validation on import | MEDIUM (fallback safety) | LOW | P1 |
| Native Argon2 fast-path | HIGH (the dream) | HIGH + uncertain | P2 |
| Clipboard auto-detect key-sync | HIGH (frictionless fallback) | MEDIUM | P2 |
| Optimised async JS path | MEDIUM | MEDIUM | P2 |
| Proactive channel-open warming | MEDIUM | LOW–MEDIUM | P2 |
| QR key-sync | MEDIUM | MEDIUM + uncertain | P3 |
| Deep-link import | LOW–MEDIUM | MEDIUM + uncertain | P3 |

**Priority key:** P1 = must have for the milestone (the de-risking + guaranteed fallback) · P2 = high-value, add once spike verdict / floor is in · P3 = defer (uncertain platform dependency)

## Competitor Feature Analysis

Closest analogues are the desktop client this plugin must interoperate with, and the broader pattern of expensive-KDF mobile apps.

| Feature | GoofCord / stegcloak-rs (desktop) | Typical native mobile app (e.g. Signal-style) | Our Approach |
|---------|-----------------------------------|-----------------------------------------------|--------------|
| Argon2id execution | Native Rust/WASM — instant | Native libsodium binding — instant | Probe for host-provided native; gate behind byte-check; else JS + key-sync |
| Salt | channelId bytes (~18–19B), arbitrary length | App-generated 16B random salt (fits libsodium high-level API) | Must match GoofCord's variable-length salt → needs low-level native entry or JS |
| Cold-key UX | N/A (native is instant) | N/A (native is instant) | Non-blocking deriving/resend + proactive warming + key-sync to *eliminate* the cold path |
| Cross-device key transfer | Same client / shared password | Account-based sync server | Desktop→mobile bundle (no server); make it frictionless (clipboard/QR) |
| Trust signalling | Implicit (one impl) | Implicit (one impl) | Explicit active-path status because we run a *fallback ladder*, not one impl |

## Sources

- `.planning/PROJECT.md` — milestone goal, constraints, out-of-scope, key decisions (the salt-length compatibility risk is called out here)
- `.planning/codebase/ARCHITECTURE.md` — key-cache, key-sync, send/flux data flow, secure-RNG gating, sync-vs-async anti-pattern
- `.planning/codebase/CONCERNS.md` — `importKeys` shape-validation gap, `base64.ts` non-ASCII bug, "Settings UI doesn't re-derive after save" bug, `LOAD_MESSAGES_SUCCESS` coroutine-storm, ~10s Argon2 performance bottleneck
- `src/crypto/argon.ts`, `src/core/keycache.ts`, `src/discord/send.ts`, `src/discord/flux.ts`, `src/discord/commands.ts`, `diagnose2.txt` — current probe / bench / derive / key-sync / non-blocking-UX implementations (grounding for "harden, not greenfield")
- libsodium `crypto_pwhash` salt-length constraint (high-level fixed 16B vs low-level `argon2id_hash_raw` variable salt) — confirms native fast-path reachability is genuinely uncertain:
  - [The pwhash* API — Libsodium documentation](https://libsodium.gitbook.io/doc/password_hashing/default_phf)
  - [crypto_pwhash_argon2id.h — jedisct1/libsodium](https://github.com/jedisct1/libsodium/blob/master/src/libsodium/include/sodium/crypto_pwhash_argon2id.h)
  - [argon2.h (argon2id_hash_raw, variable saltlen) — jedisct1/libsodium](https://github.com/jedisct1/libsodium/blob/master/src/libsodium/crypto_pwhash/argon2/argon2.h)

---
*Feature research for: native-speed Argon2id KDF (performance/de-risking milestone)*
*Researched: 2026-05-30*
