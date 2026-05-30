# Pitfalls Research

**Domain:** Byte-compatible Argon2id key derivation for a Kettu/Vendetta Discord-mobile plugin (Hermes engine), interoperating byte-exactly with stegcloak-rs / GoofCord
**Researched:** 2026-05-30
**Confidence:** HIGH on the interop/crypto mechanics (verified against libsodium source + noble-hashes source); MEDIUM on native reachability inside the Discord sandbox (the probe's on-device output was never captured, so the ecosystem here is hypothesis-only)

> **The single load-bearing safeguard for this entire milestone:** never accept a key from *any* derivation path — native, JS, or imported — until it has reproduced a **committed, fixed `(password, channelId) → 32-byte key` test vector on-device**. Every pitfall below is ultimately a way that a derivation silently produces the *wrong 32 bytes* or *weaker 32 bytes*; the test-vector gate is the one mechanism that catches all of them at once. Generate this vector with the existing sync `deriveKey()` (which is already proven byte-compatible by the CI harness), commit it, and make it a hard runtime gate before any native path is allowed to write into the key cache.

---

## Critical Pitfalls

### Pitfall 1: Salt-length mismatch — libsodium's high-level `crypto_pwhash` silently rejects (or mangles) the channelId salt

**What goes wrong:**
stegcloak-rs uses the Discord `channelId` (a ~18–19-character snowflake, e.g. `"112233445566778899"`) **as the Argon2 salt**, UTF-8 encoded, with no transformation. libsodium's high-level `crypto_pwhash()` API requires a salt of **exactly `crypto_pwhash_SALTBYTES` = 16 bytes** (verified: the constant is `16U` and the API enforces it; PHP/binding layers document "exactly 16 bytes"). A native libsodium reached through this standard entry point cannot accept the 18–19-byte salt at all — and a wrapper that "helpfully" pads, truncates, or hashes the salt to 16 bytes will run successfully and return a **different 32-byte key**. Interop breaks silently: messages encrypt fine on mobile but are undecryptable on GoofCord (and vice-versa), with no error anywhere.

**Why it happens:**
The high-level `crypto_pwhash` is the *only* Argon2 surface most people know exists in libsodium, and it's the one most likely exposed by a React-Native Sodium binding. The fixed-salt constraint is a libsodium API decision, **not** an Argon2 limitation — the underlying `argon2id_hash_raw` C function takes an explicit `saltlen` parameter and accepts 8 … 2^32−1 bytes. So the *capability* exists in the same shared library, just not through the high-level door. A developer who finds `crypto_pwhash` and sees it "work" assumes done, never realizing the salt was silently coerced.

**How to avoid:**
- During the spike, **probe specifically for a salt-length-flexible entry point**: `crypto_pwhash_argon2id` low-level variants, or any binding exposing `saltlen`. If only the fixed-16-byte `crypto_pwhash` is reachable, **libsodium is disqualified for native derivation** — record that and move to fallback. Do not attempt to make a 18-byte salt "fit"; there is no compatible way to do so.
- The test vector (`channelId` of exactly the real length) is the only thing that proves the salt went through untouched. A 16-byte salt would *pass* a naive smoke test but *fail* the real-length vector.

**Warning signs:**
- The native call returns a key but only when you feed it a 16-byte salt; feeding the real channelId either throws (`bad salt length`) or — worse — succeeds (meaning it's silently coercing).
- Decrypt works mobile↔mobile but never mobile↔GoofCord. (Self-consistent but not interoperable = a transformed salt or param.)
- The CI harness is green (it uses the JS path) while real-device GoofCord interop fails — the harness does **not** exercise the native path, so green CI is *not* evidence the native path is correct.

**Phase to address:** **Spike** (reachability + salt-length acceptance is the gating question; if no flexible-salt entry point exists, native-via-libsodium is dead before any implementation effort).

---

### Pitfall 2: Output-encoding mismatch — PHC string vs raw 32-byte key

**What goes wrong:**
Many Argon2 APIs (including libsodium's `crypto_pwhash_str`, and most "hash a password" convenience functions) return a **PHC-format encoded string** like `$argon2id$v=19$m=65536,t=3,p=1$<b64salt>$<b64hash>`, not the raw derived bytes. GoofCrypt needs the **raw 32-byte derived key** to feed into XChaCha20-Poly1305. If the native path returns (or the wrapper defaults to) the PHC string and code base64-decodes the whole string, or hashes it, or uses it directly as a key, the cipher key is wrong → interop breaks, or (if both sides somehow agree on the wrong thing) only mobile↔mobile works.

**Why it happens:**
"Hash" APIs default to the verifiable PHC string because their primary use case is password *storage*, not key *derivation*. The KDF use case (raw output, caller-supplied salt) is the secondary `crypto_pwhash()` / `argon2id_hash_raw()` surface. It's easy to grab the wrong one.

**How to avoid:**
- Use only the **raw-output** derivation entry point (`crypto_pwhash` raw, or `argon2id_hash_raw`), never the `_str` / encoded variant.
- If a PHC string is unavoidable, **parse out and base64-decode only the final hash segment** — but treat this as a code smell: also re-verify `v=19`, `m=65536`, `t=3`, `p=1` *from the string itself* before trusting it (the string conveniently states the params it actually used — use that to detect Pitfall 3).
- The test vector catches this trivially: a PHC string is not 32 bytes.

**Warning signs:**
- The native return value is a printable ASCII string starting with `$argon2id$` rather than a 32-byte buffer.
- Key length isn't exactly 32.

**Phase to address:** **Native-impl** (it's an integration detail of whichever raw API the spike found), but the **test-vector gate** (hardening, built first) is what makes it impossible to ship the mistake.

---

### Pitfall 3: Param / version mismatch — OPSLIMIT/MEMLIMIT and Argon2 version don't map to t=3 / m=64 MiB / v0x13

**What goes wrong:**
The exact params are non-negotiable (`src/crypto/argon.ts`): **Argon2id, t=3 (iterations), m=65536 KiB = 64 MiB, p=1, dkLen=32, version=0x13**. Two specific traps:
1. **OPSLIMIT/MEMLIMIT are not t/m.** libsodium's high-level API takes `opslimit` (a time cost) and `memlimit` (memory in **bytes**), and internally maps them to Argon2 (t, m) — and that mapping is **not** a direct passthrough. `OPSLIMIT_INTERACTIVE`/`MODERATE`/`SENSITIVE` and `MEMLIMIT_*` presets correspond to *their own* (t, m) values that are **not** (3, 65536 KiB). Passing `memlimit = 64*1024*1024` does get you 64 MiB, but `opslimit` does **not** equal `t`; only the low-level/raw API lets you set `t=3` directly. Get this wrong → different key, silent.
2. **Argon2 version: 0x13 (19, v1.3) vs 0x10 (16, v1.0).** These produce completely different outputs. stegcloak-rs pins `Version::V0x13`. An older or differently-configured native lib defaulting to 0x10 is a silent break.

**Why it happens:**
opslimit/memlimit is a deliberate libsodium abstraction meant to *discourage* hand-tuning (t, m); it actively hides the parameters you must pin. And version 0x13 vs 0x10 is invisible unless you read it back — both run, both return 32 bytes.

**How to avoid:**
- Only use an entry point that accepts **explicit `t`, `m`, `p`, and version** (raw / low-level). If only opslimit/memlimit is exposed, treat it as Pitfall-1-equivalent: likely incompatible, disqualify unless you can prove the mapping yields exactly (t=3, m=65536, v0x13).
- Assert the **version is 0x13** explicitly (read it from the PHC string if that's what you get, or from the API's version constant).
- The committed test vector pins all of this at once — a wrong t, m, p, or version changes the 32 bytes.

**Warning signs:**
- API only offers `opslimit`/`memlimit`, no `t`/`m`/`p`.
- A version constant of 16/0x10 anywhere in the reachable module.
- Key differs from the vector by everything (full 32-byte mismatch) rather than a prefix — indicates a param/version difference, not a salt-encoding glitch.

**Phase to address:** **Spike** (can the reachable API even express t=3/m=64MiB/v0x13?) → confirmed by the **test-vector gate** in hardening.

---

### Pitfall 4: Discord native-module fragility — present-but-wrong, stale metro lookups, signature drift; failing *unsafe* instead of falling back

**What goes wrong:**
The native surface (`nativeModuleProxy`, `__turboModuleProxy`, `metro.findByProps`, DAVE/MLS/Sodium/Aes candidates from `diagnose2.txt`) differs across Discord app versions, OS (iOS vs Android), and even build channels. Four distinct failure modes:
1. **Module absent on this build** → code must fall back to JS, not crash or (worse) skip derivation and send plaintext.
2. **Module present but method signature differs** (arg order, sync vs callback vs Promise, base64 vs Uint8Array return) → call "succeeds" with garbage or throws mid-encrypt.
3. **Stale metro reference** — `metro.findByProps` results cached at load can go stale after a Discord hot-reload/reconnect (the codebase already has this exact bug class: `_msgActions` in `metro.ts` is cached via `??=` and never invalidated). A native KDF resolved once and cached could point at a torn-down module.
4. **Wrong module matched** — `findByProps("argon2")` / `findByProps("crypto_pwhash")` could match an unrelated or partial module that has the prop name but not the real implementation.

The dangerous outcome is **failing toward corruption or weaker security** instead of toward the known-good JS path: e.g. a native call returns the *wrong* key and that wrong key gets cached and persisted, permanently poisoning that `(channelId, password)` slot for interop.

**How to avoid:**
- **Gate every native derivation behind the on-device test-vector check, every session** (or at least every time the module reference is (re)resolved). If the native module fails the vector for ANY reason — absent, wrong signature, stale, mismatched — **discard it and fall back to JS**. Never cache or persist a key from an unverified native path.
- **Resolve the native module lazily and re-validate on use**, not once-at-load-and-cache-forever (learn from the `_msgActions` staleness bug). Clear any cached native handle on `onUnload`.
- Wrap every native call in `try/catch` and treat *any* throw, *any* non-32-byte result, *any* vector mismatch as "native unavailable → use JS." The fallback must be **automatic and silent-to-the-user-as-degradation but loud-in-status** (see Pitfall 6 on surfacing the active path).
- **Note on DAVE/MLS specifically:** the probe scans DAVE/MLS crypto. Verified: Discord's DAVE protocol uses **MLS for group key exchange** with HPKE/AES-based MLS ciphersuites — it is an *audio/video E2EE* system and there is **no reason it exposes a password-based Argon2 KDF**. Treat DAVE/MLS/`Sodium`/`Aes` candidates as *low-probability* for our exact derivation; the most likely positive hit, if any, is a general-purpose `Sodium`/libsodium binding — and that one is governed entirely by Pitfalls 1–3.

**Warning signs:**
- Probe shows a candidate module but its key output fails the test vector.
- Intermittent interop failures correlated with app updates / reconnects (staleness).
- A native key got persisted and now a specific channel never interops even after reinstall (poisoned cache slot — see Recovery).

**Phase to address:** **Spike** (enumerate what's actually reachable on real devices — the probe output that was never recorded) → **Native-impl** (resolve/validate/fallback wiring) → **Hardening** (the per-session vector re-check and cache-poison guard).

---

### Pitfall 5: The "already fixed" async + macrotask-yield path STILL freezes on first encrypt

**What goes wrong:**
Commit `b98fdd7` claimed the freeze was fixed ("still ~10s but responsive"), yet first encrypt still freezes. Verified mechanics of `@noble/hashes` `argon2idAsync`: it processes blocks in the innermost segment loop and, **after each `processBlock()`**, checks elapsed time; when elapsed ≥ `asyncTick` it does `await nextTick()`. The build (`scripts/build.mjs`) patches noble's `nextTick` from `async () => {}` (a **microtask**, which RN's renderer never gets between) to `() => new Promise(r => setTimeout(r, 0))` (a **macrotask**, which lets the UI paint). So the responsiveness depends on a **fragile build-time regex** *and* on the work actually flowing through `argon2idAsync`. Likely root causes, in priority order to investigate:

1. **The send path isn't async at all for the freeze.** `send.ts` line 47–62: on a cache *miss* it calls `deriveKey(...).then(...)` (async, correct) and rejects the send — so the *send itself* shouldn't block. BUT verify no path reaches the **synchronous `deriveKey` in `crypto/argon.ts`** via `core/stegcloak.ts` (the architecture explicitly flags `stegcloak.ts` as using the *sync* 64 MiB derive — it's meant to be harness/desktop-only, but a stray import on the hot path would freeze for the full 10s with zero yields).
2. **The regex patch silently regressed.** The build *throws* if the regex misses the exact string `export const nextTick = async () => { };` — but `@noble/hashes` is pinned with a **caret** (`^1.7.1`), so a patch/minor bump could change whitespace and either (a) fail the build loudly (good) or (b), if the build was last run against the old version and the lockfile drifted, ship a bundle where `nextTick` is the microtask version again → "async" derivation that never yields to the renderer = full freeze.
3. **`asyncTick` chunks too coarse.** `ASYNC_OPTS.asyncTick = 50` means up to 50 ms of synchronous block-processing between yields. On a slow device, 50 ms hitches are individually visible and, summed, feel like jank even though the thread *is* yielding. Lowering to ~16 ms (one frame) trades total wall-time for smoothness.
4. **Macrotask starvation / batching.** Even with `setTimeout(0)` macrotasks, if the surrounding code (e.g. 50 concurrent `backgroundDecrypt` coroutines on `LOAD_MESSAGES_SUCCESS`, per CONCERNS.md) floods the macrotask queue, render frames still starve. The freeze on *first channel open* may be N concurrent derivations contending, not one.
5. **First-pass cost is front-loaded.** noble does not special-case the first memory-fill pass; with m=64 MiB the first pass allocates and fills a large buffer — if allocation itself hitches before the loop's time-checks kick in, the very first hitch can be large.

**How to avoid / investigate (this is a diagnosis spike, not a guess):**
- **Instrument before fixing.** Add timing around: (a) is `deriveKeyAsync` (not sync `deriveKey`) on every reachable encrypt/decrypt route? (b) is `nextTick` actually the `setTimeout` version at runtime? (expose it via the `__goofcrypt` debug hook and read it on-device). (c) how many `await nextTick()` yields actually fire during one derivation? (count them).
- **Pin `@noble/hashes` to an exact version** (drop the caret) and add a **runtime assertion** that `nextTick` is the macrotask form (e.g. self-test checks `nextTick.toString()` doesn't match the empty-async-arrow), so a regressed patch fails *loudly on device* rather than silently freezing.
- **Audit the import graph** to prove no hot path reaches `core/stegcloak.ts`'s sync derive.
- Consider lowering `asyncTick` toward one frame and **serializing** cold-channel derivations (one at a time) to stop macrotask flooding.

**Warning signs:**
- Bench (`/encrypt bench`) reports ~10s but the UI is *smooth* during bench, yet *first real encrypt* freezes → the freeze is on a different (sync) route than bench uses.
- Yield-count instrumentation shows 0 or very few `nextTick` fires → microtask regression or sync path.
- Freeze severity scales with number of cloaked messages in the opened channel → concurrency flooding, not single-derivation cost.

**Phase to address:** **Spike** (diagnose which of the five it actually is — the probe-was-never-recorded lesson applies: measure, don't assume) → fix lands in whichever path the spike implicates (native-impl removes the cost; or a hardening fix to the yield/serialization if staying on JS).

---

### Pitfall 6: Security-weakening fallbacks that degrade *silently*

**What goes wrong:**
Two fallbacks already exist or are tempting, both of which weaken security if they engage without the user knowing:
1. **Raw-password-as-key (no KDF).** If a future "fast path" or a panicked fallback ever skips Argon2 and uses the password (or a cheap hash of it) directly as the XChaCha key, an attacker with ciphertext can brute-force the password with *trivial* offline cost — the entire point of the 64 MiB / t=3 KDF (making each guess expensive) is gone. This must **never** be a fallback. There is no acceptable "skip the KDF to be fast" — that's not the same algorithm and it's catastrophically weaker.
2. **`Math.random` nonces (`allowInsecureRng`).** Already present (`random.ts` line 104–107). `Math.random` is not a CSPRNG; on some engines its 24-byte XChaCha nonces are predictable and, critically, **may repeat**. XChaCha20-Poly1305 is catastrophically broken by **(key, nonce) reuse** (loss of confidentiality *and* forgeable tags). A predictable/repeating nonce undermines the cipher even though the key is strong.

The core danger for *both*: the user can't tell which path is active. A plugin that "works" gives no signal that it silently dropped to a weaker mode.

**How to avoid:**
- **Never** implement raw-password-as-key, even as an emergency fallback. The only acceptable fallbacks for the KDF-too-slow problem are: (a) native-speed derivation of the *same* Argon2id, (b) **imported keys** (key-sync — the same derivation done at native speed on desktop), or (c) JS Argon2id with better UX (it's slow but *correct and equally strong*). All three preserve the security level.
- Keep `allowInsecureRng` off-by-default and **gate the send path on `secureRngAvailable()`** (already done — preserve this). Strengthen the warning to a modal/explicit confirm before enabling (CONCERNS.md already recommends this). Decryption stays ungated (no randomness needed).
- **Surface the active path, always.** `/encrypt status` and the `__goofcrypt` diag hook must report: which derivation path is live (native / JS / imported), and which RNG source (`crypto.getRandomValues` / metro / **insecure Math.random**). Make degraded modes *visible*, never silent.

**Warning signs:**
- Encryption suddenly becomes instant on a cold channel with no key import and no native module → suspect a KDF-skipping shortcut crept in.
- Status shows RNG source = `Math.random` / insecure.
- Two ciphertexts of different plaintexts share a nonce (catastrophic; check the 24-byte nonce field in framed payloads).

**Phase to address:** **Hardening** (status/diagnostics surfacing, modal RNG warning) — but enforced as a **design invariant from day one**: any fallback proposed in spike/native-impl must be checked against "does this weaken the security level? if yes, reject."

---

### Pitfall 7: Key-sync correctness bugs become critical when key-sync is the *primary* fallback

**What goes wrong:**
If native derivation is blocked, **key-sync (desktop-derived keys imported to mobile) becomes the main way users avoid the freeze** — promoting three currently-latent bugs (from CONCERNS.md) to load-bearing:
1. **base64 non-ASCII bounds bug** (`util/base64.ts` line 39): `LOOKUP` is `Int16Array(128)`; `LOOKUP[str.charCodeAt(i)]` for any code point ≥ 128 returns `undefined`, and the guard `if (v < 0) continue;` does **not** skip it (`undefined < 0` is `false`). A pasted bundle containing a smart-quote, stray non-ASCII char, or surrounding text corrupts the decoded key **silently** — producing a wrong key that then poisons the cache and breaks interop for that channel. Fix: `if (v == null || v < 0) continue;` or clamp index `i < 128 ? LOOKUP[...] : -1`.
2. **No shape validation on imported bundles** (`importKeys`, `keycache.ts` line 51): every value is written into `store.keys` with no check that it's valid 43–44-char base64, that channelIds are snowflake-shaped, or that passwordIds are 22-char base64. A malformed bundle silently writes garbage keys that then *take precedence over* on-device derivation (because `getCachedKey` returns the persisted slot first), permanently breaking those channels until manually cleared.
3. **`passwordId` / base64 determinism coupling:** `passwordId()` = `toBase64(sha256(pw)).slice(0,22)` and the desktop tool **imports this exact function**. Any divergence — a base64 change, a sha256 change, an encoding change — makes desktop keys land under a *different* passwordId than mobile looks up, so imported keys are present but never found. This determinism is an undocumented hard contract between `tools/derive-keys.mjs` and the plugin.

**How to avoid:**
- Fix the base64 bounds bug **before** key-sync is relied on as the fallback (it's a one-line guard).
- Add **shape validation to `importKeys`**: reject values that aren't 43–44-char standard-base64 32-byte keys; reject non-snowflake channelIds and non-22-char passwordIds; count and report rejected entries rather than writing them.
- Add a **key-sync round-trip test to the harness** (currently untested per CONCERNS.md): `derive-keys.mjs` output → `importKeys` → `getCachedKey` must return bytes byte-identical to the on-device `deriveKey` for the same `(pw, channelId)`. This *also* re-uses the master test vector (Pitfall 8) and pins the `passwordId` contract.
- Consider validating an imported key against the **test vector** when the bundle includes the known `(password, channelId)` pair, giving users immediate "import worked / import corrupted" feedback.

**Warning signs:**
- Imported keys "succeed" (toast says N imported) but the channel still derives/freezes or fails to decrypt → passwordId mismatch or silently-corrupted base64.
- A channel that worked before an import now never interops → poisoned slot from an unvalidated bundle.

**Phase to address:** **Fallback** (key-sync hardening is part of making key-sync shippable as the primary fallback) — base64 fix and `importKeys` validation are prerequisites; the round-trip harness test is the verification.

---

### Pitfall 8: Trusting *any* derivation that hasn't passed an on-device byte-equality check (the master gate)

**What goes wrong:**
Every pitfall above (1–4, 7) is a different way to silently produce the *wrong 32 bytes*. The catastrophic version is shipping a native (or imported) key that was never checked against ground truth — it caches, persists, and **poisons interop** invisibly. CI is green (JS path), mobile↔mobile works (self-consistent), and only real cross-client use reveals the break — by which point poisoned keys are persisted on users' devices.

**How to avoid — the recommended, explicit safeguard:**
1. **Generate and COMMIT a fixed test vector** using the *already-proven-compatible* sync `deriveKey()` (the one the CI harness validates against stegcloak-rs):
   - Choose a fixed `password` (e.g. `"goofcrypt-test-vector"`) and a fixed, **real-length** `channelId` (a realistic 18–19-digit snowflake — length matters, see Pitfall 1).
   - Record the resulting **32-byte key** (hex and base64) in a committed file (e.g. `tests/vectors/argon2id.json`) and, ideally, cross-check it once against an independent Argon2id reference (stegcloak-rs itself, or a known Argon2 implementation) so the vector is *triple-anchored*: noble-JS, stegcloak-rs, reference.
2. **Make it a hard runtime gate:** before any native derivation result is cached/persisted/used, the native path must reproduce this exact vector on-device. Mismatch → discard native, fall back to JS. Re-check per session and whenever a native module handle is (re)resolved (defeats staleness, Pitfall 4).
3. **Make it a CI gate too:** the harness asserts `deriveKey(vector.password, vector.channelId) === vector.key` so any future change to params, salt handling, base64, or the noble version that alters the output **fails the build loudly**.
4. **Reuse it for key-sync** (Pitfall 7): the desktop tool deriving the vector's key, imported and looked up, must return the same bytes — pinning the whole `passwordId`/base64/import contract.

**Why this is the keystone:** it converts every *silent* interop break into a *loud, early, on-device or in-CI* failure. It is cheap (one derivation), it costs nothing at steady state (run once at validation, not per-message), and it's the only check that simultaneously covers salt-length, output-encoding, params, version, native correctness, staleness, and key-sync determinism.

**Warning signs (that you lack this gate):**
- The only interop test is the CI harness on the JS path; nothing checks the native or imported path against a fixed expected key.
- Native derivation results are cached/persisted before being verified.

**Phase to address:** **Hardening — but built FIRST**, before native-impl. The vector and its gate are scaffolding the native work plugs into; building native derivation without the gate in place is the central risk this milestone must avoid.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use libsodium high-level `crypto_pwhash` (opslimit/memlimit, fixed 16B salt) because it's the obvious API | Fast to wire up | Produces a **different key** (wrong salt length, wrong t-mapping) → silent interop break | **Never** for this milestone — disqualifies the path |
| Cache/persist a native key before vector-verifying it | Skips a derivation on the hot path | Poisons the persisted cache; break survives reinstall | **Never** — verify first, then cache |
| Pad/truncate/hash the channelId to make it a 16-byte salt | "Makes libsodium accept it" | Guarantees a non-matching key | **Never** — it's the opposite of compatibility |
| Raw-password-as-key fallback to dodge the slow KDF | Instant "encryption" | Trivial offline brute-force; not the same algorithm | **Never** |
| `^1.7.1` caret on `@noble/hashes` (current state) | Auto patch updates | The build-time `nextTick` regex patch can silently regress → re-freeze | **Never** — pin exact, re-validate on bump |
| Cache native module handle once at load (`??=` pattern, like `_msgActions`) | Avoids re-lookup cost | Stale handle after app reconnect/update → wrong/torn-down module | Only with re-validation against the vector on use |
| `importKeys` writes everything with no validation (current state) | Simpler import code | Garbage/poisoned keys persist and shadow real derivation | Only while import is a dev-only convenience, never as the primary fallback |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| libsodium `crypto_pwhash` | Assume it takes (t, m) and any-length salt | It takes opslimit/memlimit and a **fixed 16-byte** salt; use raw `argon2id_hash_raw`-style entry with explicit `t=3, m=65536, p=1, v0x13, saltlen=channelId.length`, or disqualify |
| Native `_str`/encoded Argon2 APIs | base64-decode or hash the whole PHC string as the key | Use raw-output API; if forced to parse PHC, decode only the final hash segment **and** verify `v=19,m=65536,t=3,p=1` from the string |
| Discord DAVE/MLS modules | Hope they expose a password KDF | They're A/V E2EE (MLS group keys, HPKE/AES) — no password Argon2; don't build around them |
| `metro.findByProps("argon2"/"crypto_pwhash")` | Trust the first match, cache it forever | Re-resolve lazily; validate the matched module against the test vector before use; clear on unload |
| `tools/derive-keys.mjs` ↔ plugin | Let `passwordId`/base64/sha256 drift between desktop and mobile | They share the exact function; pin with a round-trip harness test using the committed vector |
| Pasted key bundles | Decode base64 without bounds-checking non-ASCII | Fix `fromBase64` guard (`v == null || v < 0`); validate shape in `importKeys` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sync 64 MiB Argon2 reached via `core/stegcloak.ts` on a hot path | Full ~10s freeze, zero yields, even though "async exists" | Audit import graph; keep sync derive harness/desktop-only | The instant any hot path imports the sync derive |
| `nextTick` microtask regression (regex patch missed) | "Async" derivation freezes UI anyway; yield-count = 0 | Pin noble exactly; runtime-assert `nextTick` is the macrotask form | On any noble version bump that changes the patched line |
| `asyncTick: 50` chunks | Visible 50ms hitches; janky but not frozen | Lower toward one frame (~16ms); trades wall-time for smoothness | On slower devices, immediately |
| N concurrent `backgroundDecrypt` coroutines on `LOAD_MESSAGES_SUCCESS` | First channel-open freeze scales with cloaked-message count; macrotask flood | Guard by channelId not messageId; serialize cold derivations; batch re-dispatch | Opening a channel with many cloaked messages, cold cache |
| Re-running Argon2 because Settings doesn't warm after Save (known bug) | New password → next send/decrypt freezes ~10s | Call `warm(currentChannelId)` after `save()` | Every password change |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Raw-password-as-key fallback (no KDF) | Trivial offline password brute-force; defeats the whole KDF | Never implement; only same-algorithm or imported-key fallbacks |
| `Math.random` nonces (`allowInsecureRng`) | Predictable/**repeating** XChaCha nonces → confidentiality + tag-forgery break on (key,nonce) reuse | Off by default; gate send on `secureRngAvailable()`; modal warning to enable; surface RNG source in status |
| Silent degraded mode (native→JS, secure→insecure RNG, derived→imported) | User believes they're protected at the strong level when they're not | Always surface the active derivation path and RNG source in `/encrypt status` + diag hook |
| Persisting unverified native keys | Poisoned cache slot breaks interop permanently and silently | Vector-gate before any cache/persist |
| `__goofcrypt` debug hook persists after unload | Another eval/plugin can call `selfTest`/`diag` | `delete globalThis.__goofcrypt` in `onUnload` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Key ready — send again" reject-then-resend flow on cold channel | User types, hits send, message vanishes into composer, must resend after ~10s | Acceptable as fallback, but native/import makes it disappear; clearly toast progress; never silently drop the message |
| Import "succeeded" toast on a silently-corrupted bundle | User thinks keys synced; channel still freezes/fails | Validate bundle shape + (if vector pair present) verify a key against the test vector; report rejected entries |
| No visible indicator of which crypto path is active | User can't tell native vs slow-JS vs insecure-RNG | Status command shows derivation path + RNG source explicitly |
| Password field not masked (known) | Shoulder-surfing, autocomplete capture | `secureTextEntry` on password input |

## "Looks Done But Isn't" Checklist

- [ ] **Native Argon2 derivation:** Often missing the **real-length channelId salt** test — verify against a committed `(password, real-snowflake-channelId) → 32-byte` vector, NOT a 16-byte salt.
- [ ] **Native derivation output:** Often returns a **PHC string, not raw bytes** — verify result is exactly 32 bytes.
- [ ] **Native params:** Often **opslimit/memlimit instead of t=3/m=65536**, and **version 0x10 instead of 0x13** — verify the vector matches bit-for-bit.
- [ ] **"Async derivation is responsive":** Often the **`nextTick` patch regressed** or a **sync path** is reached — verify yield-count > 0 on-device and `nextTick` is the macrotask form; verify the freeze route is the same as the bench route.
- [ ] **Native fallback:** Often **fails toward corruption** (caches wrong key) instead of toward JS — verify any vector mismatch / throw / stale-module / wrong-signature falls back to JS and never persists.
- [ ] **Key-sync import:** Often **no shape validation** and **non-ASCII base64 corruption** — verify `importKeys` rejects malformed entries and `fromBase64` guards code points ≥ 128.
- [ ] **CI green:** Often only covers the **JS path** — verify a test-vector assertion gates the build, and remember CI does NOT exercise the native or imported path on-device.
- [ ] **Degraded modes:** Often **silent** — verify `/encrypt status` surfaces derivation path AND RNG source.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Poisoned persisted key (wrong native/imported key cached) | MEDIUM | Add a "clear cached keys for channel / all" action; on vector-gate failure auto-evict the suspect slot; re-derive via JS or re-import a validated bundle |
| `nextTick` patch regressed (re-freeze shipped) | LOW | Pin noble exactly, re-run `npm test && npm run build`; runtime assertion would have caught it on device |
| Native path produces wrong key (salt/param/version) | LOW if gated, HIGH if not | If vector-gate present: native silently disabled, JS used, no user-visible break. If absent: interop breaks shipped to users + persisted — requires cache clear + update |
| Imported bundle corrupted (base64/shape) | LOW–MEDIUM | Fixed `fromBase64` + `importKeys` validation rejects at import; for already-imported garbage, clear the channel's key slot and re-import |
| `Math.random` nonce reuse occurred | HIGH (cryptographic) | Cannot un-leak; rotate password (new key) for affected channel; ensure secure RNG gating prevents recurrence |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 8. Untrusted derivation (master gate) | **Hardening — built FIRST** | Committed `(pw, channelId) → key` vector; CI assertion + on-device runtime gate before any cache/persist |
| 1. Salt-length mismatch | **Spike** | Probe finds a `saltlen`-flexible / raw entry point, or path is disqualified; vector with real-length salt passes |
| 3. Param/version mismatch | **Spike** | Reachable API expresses t=3/m=65536/p=1/v0x13 explicitly; vector matches |
| 4. Native-module fragility | **Spike → Native-impl → Hardening** | Recorded on-device probe output; lazy-resolve + per-session vector re-check; fallback-to-JS on any failure; clear handle on unload |
| 2. Output-encoding (PHC vs raw) | **Native-impl** | Result is exactly 32 bytes; vector matches |
| 5. Still-freezes diagnosis | **Spike (diagnose) → fix in native-impl or hardening** | Instrumented yield-count > 0; sync-path audit clean; `nextTick` macrotask asserted; freeze route == bench route |
| 6. Silent security-weakening fallbacks | **Hardening (design invariant from day 1)** | Status surfaces derivation path + RNG source; send gated on secure RNG; no KDF-skipping path exists |
| 7. Key-sync correctness | **Fallback** | base64 bounds fix; `importKeys` shape validation; key-sync round-trip harness test using the vector |

## Sources

- libsodium `crypto_pwhash` fixed 16-byte salt (`crypto_pwhash_SALTBYTES = 16U`, enforced by high-level API) — [The pwhash* API, Libsodium docs](https://libsodium.gitbook.io/doc/password_hashing/default_phf), [crypto_pwhash_argon2id.h (jedisct1/libsodium)](https://github.com/jedisct1/libsodium/blob/master/src/libsodium/include/sodium/crypto_pwhash_argon2id.h), [PHP sodium_crypto_pwhash manual (documents "exactly 16 bytes")](https://www.php.net/manual/en/function.sodium-crypto-pwhash.php), [php/doc-en issue #3160 (salt length requirement)](https://github.com/php/doc-en/issues/3160) — HIGH confidence
- Underlying Argon2 (`argon2id_hash_raw`) accepts arbitrary `saltlen` (8 … 2^32−1) — [argon2.h (jedisct1/libsodium)](https://github.com/jedisct1/libsodium/blob/master/src/libsodium/crypto_pwhash/argon2/argon2.h), [Argon2 (Wikipedia)](https://en.wikipedia.org/wiki/Argon2) — HIGH confidence
- Argon2 version 0x13 (v1.3) vs 0x10 (v1.0) produce different outputs; `crypto_pwhash_ALG_ARGON2ID13` since 1.0.13 — [crypto_pwhash_argon2id.h](https://github.com/jedisct1/libsodium/blob/master/src/libsodium/include/sodium/crypto_pwhash_argon2id.h) — HIGH confidence
- noble-hashes `argon2idAsync` yields per innermost-segment iteration via time-checked `await nextTick()`; larger m = more yield opportunities; first pass not special-cased — [noble-hashes src/argon2.ts (paulmillr/noble-hashes)](https://github.com/paulmillr/noble-hashes/blob/main/src/argon2.ts) — HIGH confidence
- noble nextTick is a microtask (`async () => {}`) by default; macrotask yield needed for RN render — [noble-hashes README](https://github.com/paulmillr/noble-hashes), [RN issue #33006 (promises blocking event loop)](https://github.com/facebook/react-native/issues/33006), [React Native Hermes docs](https://reactnative.dev/docs/hermes) — HIGH confidence (corroborated by the project's own build patch in `scripts/build.mjs`)
- Discord DAVE = A/V E2EE using MLS for group key exchange (HPKE/AES MLS ciphersuites), no password KDF — [Discord DAVE blog](https://discord.com/blog/meet-dave-e2ee-for-audio-video), [dave-protocol/protocol.md (discord/dave-protocol)](https://github.com/discord/dave-protocol/blob/main/protocol.md), [DAVE whitepaper](https://daveprotocol.com/) — MEDIUM confidence (DAVE specifics verified; the negative claim "exposes no Argon2 to JS in the mobile bundle" is inference, not proven — the spike must confirm with the recorded probe output)
- Project sources: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `src/crypto/argon.ts`, `src/crypto/random.ts`, `src/discord/send.ts`, `src/discord/flux.ts`, `src/core/keycache.ts`, `src/util/base64.ts`, `scripts/build.mjs`, `diagnose2.txt` — HIGH confidence (direct read)

---
*Pitfalls research for: byte-compatible Argon2id KDF in a Hermes/Kettu Discord-mobile plugin*
*Researched: 2026-05-30*
