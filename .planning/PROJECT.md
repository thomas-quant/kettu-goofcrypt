# GoofCrypt (mobile)

## What This Is

GoofCrypt is a Kettu/Vendetta plugin for **Discord mobile** (Android/iOS, Hermes engine) that transparently encrypts outgoing messages and decrypts incoming ones, hiding the ciphertext inside zero-width characters so messages look like normal text. It is **byte-compatible with stegcloak-rs / GoofCord** (the desktop client), so a message encrypted on one client reads correctly on the other.

This milestone is about **speed**: the first-time-per-channel Argon2id key derivation currently freezes the UI for ~10 seconds. The goal is to run that *same* derivation at native (or near-native) speed — without breaking GoofCord compatibility.

## Core Value

A message encrypted on GoofCord desktop must decrypt on GoofCrypt mobile and vice-versa — **byte-exact interop is non-negotiable**. Speed work must never sacrifice it. When speed and compatibility conflict, compatibility wins.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from the existing codebase map (.planning/codebase/). -->

- ✓ Transparent outbound encryption via send patch — existing
- ✓ Transparent inbound decryption via FluxDispatcher patch (cached-key sync path) — existing
- ✓ Byte-compatible wire format with stegcloak-rs/GoofCord (XChaCha20-Poly1305 + Argon2id + ZWC stego), enforced by CI harness — existing
- ✓ Multi-password support with winner-hinted decrypt ordering — existing
- ✓ Two-level key cache (in-memory Map + persisted base64 store) — existing
- ✓ Desktop→mobile key-sync (`tools/derive-keys.mjs` + `/encrypt import` / Settings import) — existing
- ✓ `/encrypt` slash command (toggle, cycle, status, bench, set, import) — existing
- ✓ React Native settings UI (passwords, cover, mark, key import) — existing
- ✓ Hermes-safe build pipeline (esbuild → swc ES5; no class/generator/WASM) — existing
- ✓ Async Argon2 with build-time macrotask-yield patch — existing
- ✓ Encryption gated on secure RNG (insecure RNG opt-in only) — existing

### Active

<!-- This milestone. Building toward these. All are hypotheses until shipped & validated. -->

- [ ] First-encrypt-in-a-channel no longer freezes the UI
- [ ] Argon2id derivation runs at native or near-native speed on-device
- [ ] GoofCord byte-compatibility preserved (CI harness stays green) — hard gate
- [ ] **Spike:** capture the on-device results of the existing native-crypto probe (`diagnose2.txt`)
- [ ] **Spike:** determine whether any reachable native Argon2 / libsodium can match the exact params *and* the channelId-as-salt
- [ ] **Spike:** diagnose why the existing async + macrotask-yield path still janks on first encrypt
- [ ] Fallback path defined and shippable if native is blocked (seamless/automatic key-sync, and/or JS-path + non-blocking-UX improvements)

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- Changing the KDF algorithm or its params — breaks GoofCord byte-compat (GoofCord is fixed/third-party)
- Introducing a v2 wire format — same reason; compatibility is the core value
- Bundling a native module into the plugin — Kettu plugins can't ship native code, only reach host-provided modules
- WASM-based Argon2 on-device — Hermes has no WebAssembly
- Server-side / remote key derivation — defeats the privacy model and the fully-static, no-server constraint
- New cryptographic features (signing, key ratcheting, forward secrecy) — out of scope for a performance milestone
- General tech-debt cleanup from CONCERNS.md (e.g. `decryptedIds` pruning, duplicate `showToast`) — tracked separately unless it sits directly on the performance path

## Context

- **Brownfield.** A working plugin already ships; full analysis lives in `.planning/codebase/` (ARCHITECTURE, STACK, STRUCTURE, CONCERNS, etc.).
- **The bottleneck is exclusively the Argon2id KDF**, not the cipher. XChaCha20-Poly1305 encrypt/decrypt is effectively instant. Argon2id (64 MiB, t=3, pure-JS via `@noble/hashes`) takes ~10s and fires once per `(channelId, password)`, then is cached in memory and persisted.
- **Three prior fix rounds, freeze still reported:** async derivation (`54c9679`), build-time macrotask-yield patch of noble's `nextTick` (`b98fdd7`, "still ~10s but responsive"), and desktop key-sync (`7178826`). The user reports first encrypt *still freezes* — suggesting a regression or that the send path isn't reliably taking the async route.
- **A native-crypto probe already exists** (`diagnose2.txt`): scans `nativeModuleProxy`, TurboModules (incl. Discord **DAVE/MLS** E2EE crypto, `Sodium`, `Aes`), `metro.findByProps` for `crypto_pwhash`/`argon2id`/`scrypt`, and `crypto.subtle`. **Its on-device output was never recorded** — we have the question, not the answer.
- **Exact KDF** (`src/crypto/argon.ts`): Argon2id, m=65536 KiB (64 MiB), t=3, p=1, v0x13, dkLen=32, **salt = channelId UTF-8 bytes**, password UTF-8 — matches stegcloak-rs `src/encrypt.rs`.
- **Compatibility risk for the native path:** libsodium's high-level `crypto_pwhash` requires a *fixed 16-byte salt*; the channelId salt is ~18–19 bytes. So even a reachable native libsodium may be unable to reproduce the exact derivation through its standard API. The spike must confirm whether a lower-level entry point (or a different reachable lib) accepts an arbitrary-length salt.

## Constraints

- **Tech stack**: Discord mobile / Hermes JS engine; Kettu (Vendetta-compatible) plugin loaded via `eval`. No native module install, no WASM, no `TextEncoder`/`Buffer`, no `class` syntax in built output.
- **Compatibility**: byte-exact interop with stegcloak-rs/GoofCord is a hard gate — the CI test harness must stay green.
- **Delivery**: fully static (GitHub Pages); no server, no database, no API keys.
- **Security**: encryption gated on secure RNG; pre-shared-password "casual privacy" model.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Argon2id params and wire format unchanged | GoofCord is fixed; byte-compat is the core value | — Pending |
| Pursue native-speed *execution* of the same derivation, not a different algorithm | "Native" means a faster execution path, not new crypto | — Pending |
| Spike-first before committing a native rewrite | Native reachability + salt-length compat are unverified; probe results uncaptured | — Pending |
| Fallbacks: seamless key-sync + JS/UX optimization | The native path may be blocked by sandbox or API limits | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-30 after initialization*
