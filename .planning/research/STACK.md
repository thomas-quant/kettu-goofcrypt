# Stack Research

**Domain:** Native-crypto reachability for byte-compatible Argon2id inside a Kettu/Vendetta Discord-mobile (Hermes) plugin
**Researched:** 2026-05-30
**Confidence:** HIGH on the blocking facts (libsodium salt/param/encoding, Hermes/WASM, DAVE primitives); MEDIUM-LOW on exact on-device module reachability (undocumented; the probe must confirm)

---

## TL;DR Verdict

**RED for a native, byte-compatible Argon2id that reproduces the channelId-as-salt through any *documented/public* native API.**

The single hard blocker is **salt length**, not parameters or output encoding:

- The exact `(t=3, m=65536 KiB, p=1, v0x13, dkLen=32)` is **exactly expressible** by libsodium's public `crypto_pwhash` (`opslimit=3`, `memlimit=67108864`, ALG_ARGON2ID13, out=32). **Verified against source.**
- But `crypto_pwhash` **hardcodes a 16-byte salt** (`crypto_pwhash_SALTBYTES`). The GoofCord/stegcloak-rs salt is the **raw channelId UTF-8 (~18–19 bytes, variable)**. There is **no public libsodium function that accepts a custom salt length**. **Verified against source + docs.**
- The internal `argon2id_hash_raw()` *does* accept arbitrary salt (`ARGON2_MIN_SALT_LENGTH=8` … `ARGON2_MAX_SALT_LENGTH=0xFFFFFFFF`) and returns a raw key — but it is **not part of libsodium's exported public ABI**, so even a reachable libsodium almost certainly will not expose it through Discord's native-module bindings.

So: even in the best case where Discord's app ships a reachable libsodium, the standard reachable surface (`crypto_pwhash`) cannot reproduce the GoofCord derivation byte-for-byte because of the salt length.

**The single most important thing the spike must verify first:** run the existing `diagnose2.txt` probe on-device and **record its output** — specifically whether any reachable module exposes a `crypto_pwhash`/`argon2id`-family function AND whether that function lets you pass a non-16-byte salt and get a raw (non-PHC) 32-byte key. The realistic expected answer is "no reachable Argon2 at all," with "reachable libsodium but 16-byte-salt-only" as the optimistic ceiling.

**If RED (expected): the roadmap should branch to the JS-execution + UX/key-sync fallbacks (see "What NOT to Use" and "Stack Patterns by Variant").** Native Argon2 is not a viable byte-compatible speedup path inside this sandbox.

---

## Recommended Stack

### Core Technologies (on-device reachability candidates, priority order)

| Technology | Version | Purpose | Why Recommended / Verdict |
|------------|---------|---------|---------------------------|
| **Reachable host libsodium via `crypto_pwhash`** | whatever Discord ships | Native Argon2id KDF | **PROBE FIRST, but RED for byte-compat.** Params t=3/m=64MiB/v0x13/out=32 are exactly expressible (`opslimit=3`, `memlimit=67108864`). **Salt is fixed at 16 bytes — cannot accept the ~18–19-byte channelId.** Output is raw key (good), but salt blocks it. Confidence: HIGH that salt blocks; MEDIUM-LOW that any libsodium is even reachable. |
| **Reachable host libsodium via internal `argon2id_hash_raw`** | — | Native Argon2id with arbitrary salt | Algorithmically perfect: accepts salt 8…4 GiB, returns raw key, supports v0x13 via `ARGON2_VERSION_13`. **But not in libsodium's exported public ABI** — Discord's TurboModule/JSI bindings will not surface it. Confidence: HIGH it is unreachable. Treat as "would work if it existed; it won't." |
| **`@noble/hashes` argon2id (pure JS) — INCUMBENT** | 1.8.0 | Argon2id KDF, fully byte-compatible | **The only thing that actually reproduces the derivation today.** Keep it. It is correct; it is just slow on Hermes (root cause below). Optimize *around* it (UX, caching, key-sync), not *replace* it. Confidence: HIGH. |
| **Desktop key-sync (`tools/derive-keys.mjs` + import)** | existing | Move the derivation off-device entirely | **The strongest real fix.** Native-speed Argon2 happens on desktop (where the salt is a non-issue), keys are imported. Already shipped; make it seamless/automatic. Confidence: HIGH. |

### Supporting Libraries / APIs (assessed and ruled out)

| Library / API | Purpose probed | Verdict | Salt | Output | Confidence |
|---------------|----------------|---------|------|--------|------------|
| **Discord DAVE / MLS native stack** (`DCDDAVEManager`/`NativeDAVE`/`NativeMLS`) | Reachable libsodium-grade crypto | **No reachable Argon2.** DAVE = MLS 1.0 (ciphersuite 2: DHKEM-P256/AES128-GCM/SHA256/P256) + **scrypt** (N=16384,r=8,p=2) for identity verification only. No Argon2, no `crypto_pwhash`. Its KDFs are HKDF/MLS-Exporter; its only password-hash is scrypt with fixed params ≠ ours. | n/a | n/a | HIGH (protocol whitepaper) that DAVE itself has no Argon2; MEDIUM that its underlying lib (if libsodium) is even module-reachable |
| **`crypto.subtle` (WebCrypto)** | Argon2 or fast KDF | **Not native in Hermes/RN at all** (needs a polyfill the plugin cannot install). Even where present, WebCrypto has **PBKDF2 but NOT Argon2** — cannot help byte-compat. Record finding only. | n/a | n/a | HIGH |
| **RN "Aes"-style crypto module** (`Aes`/`DCDCrypto`) | Any KDF | If reachable, typical surface is `pbkdf2/sha256/sha512/hmac/aes` — **never Argon2**. PBKDF2 ≠ Argon2, breaks byte-compat. | n/a | n/a | MEDIUM (module presence undocumented) |
| **`hash-wasm`, `openpgpjs/argon2id`, `argon2-browser`** | Faster Argon2 in JS | **All require WebAssembly. Hermes has NO WASM.** Every fast Argon2 author states pure-JS is "unacceptable" and resorts to WASM. Out. | — | — | HIGH |
| **`@openpgp/noble-hashes`, hand-optimized JS** | Faster pure-JS Argon2 | No materially faster pure-JS Argon2 exists for Hermes. Argon2 is dominated by 64-bit ops; **JS has no fast `Uint64Array`**, and **Hermes is ~15× slower than JSC at the `rotr64`-style bitwise ops** that dominate the inner loop. Micro-opts won't move ~10s to "instant." | — | — | HIGH |

### Development / Spike Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `diagnose2.txt` probe | Enumerate reachable native crypto modules on-device | **Already written; output never captured. Capturing it is the #1 spike task.** It already scans `nativeModuleProxy`, the TurboModule candidates (DAVE/MLS/Sodium/Aes), `metro.findByProps('crypto_pwhash'|'argon2id'|'scrypt'|'pbkdf2'|'subtle'|'secretbox')`, and `crypto.subtle`. |
| Probe extension (add to spike) | Confirm salt + encoding on any hit | If a module exposes a pwhash-like fn, the probe MUST additionally test: (a) does it accept a 19-byte salt without erroring, (b) does it return a 32-byte raw buffer (not a `$argon2id$…` PHC string), (c) does a known `(pw, 19-byte salt)` vector match the noble/GoofCord reference. |
| `/encrypt bench` (existing) | Quantify on-device derivation time | Baseline the real on-device ms; informs whether UX-async alone is acceptable. |

## Installation

```bash
# No new runtime deps recommended for the native path — it is RED.
# Keep the incumbent byte-compatible KDF:
#   @noble/hashes  (argon2id, already pinned at 1.8.0)
#
# No native module can be installed into a Kettu plugin (host-provided only).
# No WASM Argon2 can be added (Hermes has no WebAssembly).
#
# Fallback work uses code already in the repo:
#   tools/derive-keys.mjs   (desktop native-speed derivation -> key-sync)
#   src/core/keycache.ts    (two-level cache + importKeys)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Keep `@noble/hashes` (byte-compat) + improve UX/key-sync | Reachable native `crypto_pwhash` | **Never for byte-compat** — fixed 16-byte salt cannot encode the channelId. Only viable if GoofCord's wire format itself changed to a 16-byte salt (explicitly Out of Scope). |
| Desktop key-sync (derive off-device) | On-device native Argon2 | Only if the probe surfaces a reachable Argon2 with arbitrary-salt + raw-output (algorithmically possible via `argon2id_hash_raw`, but that symbol is not exported — treat as unreachable). |
| Pure-JS noble on-device | Faster JS/WASM Argon2 | Never on Hermes — no WASM, no fast 64-bit ints, ~15× bitwise penalty vs JSC. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| libsodium `crypto_pwhash` (even if reachable) | Hardcoded 16-byte salt; channelId is ~18–19 bytes → cannot reproduce GoofCord derivation. Output is fine, params are exact, **salt kills it.** | noble/hashes for byte-compat; key-sync for speed |
| Discord DAVE/MLS crypto for KDF | No Argon2; only HKDF/MLS-Exporter + scrypt(N=16384,r=8,p=2) with fixed non-matching params | — |
| `crypto.subtle` PBKDF2 | Not Argon2 → not byte-compatible; also not native in Hermes | — |
| `hash-wasm` / `argon2-browser` / `openpgpjs/argon2id` | Require WebAssembly; **Hermes has no WASM** | — |
| Changing KDF params/salt to fit a 16-byte-salt native API | Breaks GoofCord byte-compat (the core value; Out of Scope) | — |
| Hand-optimizing the JS Argon2 inner loop for "native speed" | Hermes 64-bit bitwise penalty (~15× vs JSC) caps any pure-JS gain; won't reach "instant" | Async/UX + key-sync |

## Stack Patterns by Variant

**If the on-device probe finds NO reachable Argon2/pwhash (EXPECTED — plan for this):**
- Native byte-compatible Argon2 is **RED**. Do not pursue it further.
- Ship the **fallback stack**: (1) seamless/automatic desktop→mobile **key-sync** so the 64 MiB derivation never runs on-device; (2) keep `@noble/hashes` async path strictly off the synchronous send/flux hot paths; (3) fix the regression where first-encrypt still freezes (the async route isn't reliably taken — likely the send patch calls a sync path or awaits derivation inline); (4) non-blocking UX (progress toast / "deriving key…" state) so the one-time cost is tolerable.
- Rationale: the only ways to make the *same* derivation fast are to run it where 64-bit ops are fast (desktop, via key-sync) or to not block the UI while it runs (UX), since on-device pure-JS speed is capped by Hermes.

**If the probe finds a reachable `crypto_pwhash` (libsodium present) but only the 16-byte-salt public API:**
- Still **RED for byte-compat** (salt mismatch). Do not adopt it.
- Record the finding precisely (module name, function names, version) for future reference, but branch to the fallback stack above.

**If the probe finds a reachable Argon2 that accepts a 19-byte salt AND returns a raw 32-byte key (UNLIKELY — would require an exposed `argon2id_hash_raw`-equivalent):**
- This is the only GREEN path. Before trusting it, the spike MUST validate a **byte-for-byte vector** against the noble/GoofCord reference for a real channelId salt, with `t=3, m=65536 KiB, p=1, v0x13`. Only adopt after the CI harness stays green with the native path swapped in behind a feature flag, with the JS path retained as fallback.

## Verified Facts (the load-bearing details)

- **`crypto_pwhash` param mapping (libsodium source, `pwhash_argon2id.c`):** `t_cost = (uint32_t) opslimit` → `opslimit=3` gives **t=3**; `m_cost = (uint32_t)(memlimit / 1024)` → `memlimit=67108864` gives **m=65536 KiB = 64 MiB**. Algorithm `crypto_pwhash_ALG_ARGON2ID13` = **Argon2id v1.3 (0x13)**. Output is a **raw key of caller-chosen length** (32 bytes OK) — NOT a PHC string (that's `crypto_pwhash_str`). So **params + output encoding are an exact match.** [HIGH]
- **Salt is the blocker:** `crypto_pwhash()` takes the salt with **no length argument** and uses fixed `crypto_pwhash_SALTBYTES = crypto_pwhash_argon2id_SALTBYTES = 16`. **No public function in the `crypto_pwhash` family accepts a custom salt length** (`crypto_pwhash`, `_str`, `_str_verify`, `_str_needs_rehash` — all fixed 16). [HIGH]
- **Lower-level escape hatch exists but is not public:** internal `argon2id_hash_raw(t_cost, m_cost, parallelism, pwd, pwdlen, salt, saltlen, hash, hashlen)` honors `ARGON2_MIN_SALT_LENGTH=8 … ARGON2_MAX_SALT_LENGTH=0xFFFFFFFF` and returns raw bytes — so the **algorithm itself accepts the channelId salt**. But it is **not exported via `SODIUM_EXPORT`** (internal implementation detail), so it is not reachable through libsodium's public ABI or any TurboModule binding built on it. Maintainer position (issue #717): the public salt is fixed at 128 bits by design. [HIGH on signatures/constants; HIGH on "not public ABI"]
- **Discord DAVE = no Argon2:** MLS 1.0, ciphersuite 2 (DHKEMP256_AES128GCM_SHA256_P256), ECDSA-P256, AES-128-GCM frames, HKDF/MLS-Exporter for keys, and **scrypt (N=16384, r=8, p=2, 64-byte out)** for identity verification only. None of this is Argon2 or our params. [HIGH — protocol whitepaper/daveprotocol.com]
- **Hermes has no WebAssembly** and **`crypto.subtle` is not a native global** in RN/Hermes (needs a polyfill the plugin cannot ship). WebCrypto offers **PBKDF2, not Argon2** regardless. [HIGH]
- **Why noble is ~10s on Discord mobile specifically:** Argon2's inner loop is 64-bit-rotation-heavy; JS lacks a fast `Uint64Array`, and **Hermes processes these bitwise ops ~15× slower than JSC** (`rotr64`-class op ~15ms on Hermes vs <1ms on JSC). This is engine-level and **not fixable by JS micro-optimization**; it's why every fast Argon2 went WASM. [HIGH — facebook/hermes#569, noble-hashes docs]
- **Module reachability is the genuine unknown:** whether Discord's app surfaces a libsodium (or any Argon2) through `nativeModuleProxy`/TurboModuleProxy is undocumented publicly. Discord's voice stack historically uses libsodium-class crypto, but exposure to the JS layer is not guaranteed and not documented. **This is exactly what the on-device probe must settle — but even a positive result is capped by the 16-byte-salt public API.** [LOW-MEDIUM]

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@noble/hashes@1.8.0` argon2id | stegcloak-rs / GoofCord wire format | Byte-exact; keep pinned. CI harness is the gate. |
| Any reachable host libsodium `crypto_pwhash` | GoofCord wire format | **INCOMPATIBLE** via public API (16-byte salt). Do not swap in. |
| Hermes (Discord mobile) | WASM Argon2 | **INCOMPATIBLE** — no WebAssembly engine. |

## Sources

- libsodium `pwhash_argon2id.c` (jedisct1/libsodium, master) — verified `t_cost=opslimit`, `m_cost=memlimit/1024`, fixed `SALTBYTES=16`, ALG_ARGON2ID13, raw output. https://github.com/jedisct1/libsodium/blob/master/src/libsodium/crypto_pwhash/argon2/pwhash_argon2id.c — HIGH
- libsodium `argon2.h` (jedisct1/libsodium, master) — `argon2id_hash_raw` signature, `ARGON2_MIN_SALT_LENGTH=8`/`MAX=0xFFFFFFFF`, not `SODIUM_EXPORT`. https://github.com/jedisct1/libsodium/blob/master/src/libsodium/crypto_pwhash/argon2/argon2.h — HIGH
- libsodium pwhash API docs — fixed `crypto_pwhash_SALTBYTES`, public function list, raw vs str output. https://libsodium.gitbook.io/doc/password_hashing/default_phf — HIGH
- libsodium issue #717 (configurable salt length) — maintainer keeps public salt fixed at 128 bits. https://github.com/jedisct1/libsodium/issues/717 — MEDIUM
- Discord DAVE protocol whitepaper — MLS 1.0 ciphersuite 2, AES-128-GCM, scrypt(16384,8,2), no Argon2. https://daveprotocol.com/ and https://github.com/discord/dave-protocol/blob/main/protocol.md — HIGH
- facebook/hermes #569 — Hermes ~15× slower than JSC on 64-bit bitwise/`rotr64` ops in hashing. https://github.com/facebook/hermes/issues/569 — HIGH
- noble-hashes / openpgpjs argon2id / hash-wasm — pure-JS Argon2 "unacceptable", all fast paths require WASM. https://github.com/paulmillr/noble-hashes , https://github.com/openpgpjs/argon2id — HIGH
- react-native-aes-crypto — representative RN crypto native module surface (pbkdf2/sha/hmac/aes, no Argon2). https://github.com/MuevoApp/react-native-aes-crypto — MEDIUM
- WebCrypto/Hermes — `crypto.subtle` not native in RN; PBKDF2 not Argon2. https://github.com/iwater/react-native-nitro-crypto , https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto — HIGH

---
*Stack research for: native-crypto reachability for byte-compatible Argon2id in a Hermes Discord-mobile plugin*
*Researched: 2026-05-30*
