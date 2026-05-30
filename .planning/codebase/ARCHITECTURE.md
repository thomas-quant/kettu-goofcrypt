<!-- refreshed: 2026-05-30 -->
# Architecture

**Analysis Date:** 2026-05-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Discord / Vendetta API                       │
│  (FluxDispatcher, MessageActions, metro modules, plugin.storage) │
└────────┬────────────────────────────┬───────────────────────────┘
         │ patched before dispatch    │ patched instead of send
         ▼                            ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌────────────┐
│  discord/flux.ts    │   │  discord/send.ts    │   │ discord/   │
│  (inbound decrypt)  │   │  (outbound encrypt) │   │ commands.ts│
│                     │   │                     │   │ /encrypt   │
└────────┬────────────┘   └────────┬────────────┘   └──────┬─────┘
         │                         │                        │
         ▼                         ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                         core/                                    │
│  decrypt.ts (sync, cached keys)    encrypt.ts (sync, key in)    │
│  keycache.ts (mem + persisted key store, async derive)          │
│  stegcloak.ts (pure single-password pipeline for harness)       │
│  payload.ts  (frame/unframe: version byte + nonce + ct)         │
│  health.ts   (in-memory error counters)                         │
└────────┬────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────┐
         ▼                                      ▼
┌──────────────────┐               ┌────────────────────────────┐
│   crypto/        │               │   stego/                   │
│ argon.ts  KDF    │               │ zwc.ts  base-8 ZWC stego   │
│ aead.ts   cipher │               │ (conceal / extract / embed)│
│ deflate.ts codec │               └────────────────────────────┘
│ random.ts RNG    │
└──────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│   Persisted plugin.storage (JSON)  │
│   settings + key cache (base64)    │
└────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Plugin entry | Lifecycle (onLoad/onUnload), safe-subsystem init, debug hook | `src/index.ts` |
| Settings | Typed settings proxy, password list parsing, chosen-password selection | `src/settings.ts` |
| Flux hook | Inbound message intercept, sync decrypt, async key-derive-and-redispatch | `src/discord/flux.ts` |
| Send patch | Outbound message intercept, encrypt-or-reject pattern | `src/discord/send.ts` |
| Commands | `/encrypt` slash command: toggle, cycle, status, bench, set, import | `src/discord/commands.ts` |
| Metro | Lazy-resolved vendetta metro module references, toast helper | `src/discord/metro.ts` |
| Key cache | Two-level key store (in-memory Map + persisted base64), async derive, winner hint | `src/core/keycache.ts` |
| Decrypt (core) | Sync decryption using cached keys only; never derives | `src/core/decrypt.ts` |
| Encrypt (core) | Synchronous encryption given an already-derived key | `src/core/encrypt.ts` |
| Payload | Binary framing: `[0x01][24B nonce][ct+tag]` — matches stegcloak-rs wire format | `src/core/payload.ts` |
| StegCloak compat | Pure single-password pipeline mirroring stegcloak-rs; used by test harness | `src/core/stegcloak.ts` |
| Health | Lightweight in-memory error counters surfaced by `/encrypt status` | `src/core/health.ts` |
| AEAD | XChaCha20-Poly1305 via @noble/ciphers; AAD = version byte | `src/crypto/aead.ts` |
| Argon2 KDF | Argon2id(m=64MiB,t=3,p=1) via @noble/hashes; sync + async variants | `src/crypto/argon.ts` |
| Deflate | Raw-DEFLATE compress/decompress + UTF-8 encode/decode via fflate | `src/crypto/deflate.ts` |
| Random | CSPRNG probe chain (Web Crypto → Metro → Math.random fallback) | `src/crypto/random.ts` |
| ZWC stego | Base-8 zero-width-character encode/decode; cover-whitespace distribution | `src/stego/zwc.ts` |
| Base64 | Dependency-free Uint8Array↔base64 (no Buffer/atob/btoa assumption) | `src/util/base64.ts` |
| UI | React Native settings screen: passwords, cover, mark, key import | `src/ui/Settings.tsx` |
| Self-test | On-load Hermes regression checks (no Argon2; tests iterator/stego/base64) | `src/selfTest.ts` |

## Pattern Overview

**Overall:** Vendetta (Discord mobile modding) plugin — patch-based interceptor architecture.

**Key Characteristics:**
- All subsystems are isolated inside a `safe()` wrapper in `onLoad`; one failure cannot prevent the others from initialising
- The critical path for decryption (flux hook) is always synchronous and uses only already-cached keys; it never blocks the Hermes event loop
- Expensive work (Argon2id key derivation) is always deferred to an async background task and performed at most once per `(channelId, password)` pair
- The encryption algorithm is byte-compatible with stegcloak-rs (the Rust/WASM lib GoofCord desktop ships); interop is enforced by the CI test harness

## Layers

**Discord integration layer:**
- Purpose: Intercept Discord's internal send/receive mechanisms via vendetta patcher
- Location: `src/discord/`
- Contains: Flux patch, send patch, slash command, metro module resolution
- Depends on: core layer, settings, crypto/random
- Used by: plugin entry point (`src/index.ts`)

**Core orchestration layer:**
- Purpose: Multi-password, key-caching encrypt/decrypt logic; no UI or Discord specifics
- Location: `src/core/`
- Contains: decrypt.ts, encrypt.ts, keycache.ts, payload.ts, stegcloak.ts, health.ts
- Depends on: crypto layer, stego layer, util/base64
- Used by: discord layer, selfTest.ts, test harness

**Cryptography layer:**
- Purpose: Primitive implementations — AEAD cipher, KDF, compression, randomness
- Location: `src/crypto/`
- Contains: aead.ts (XChaCha20-Poly1305), argon.ts (Argon2id), deflate.ts (raw-DEFLATE), random.ts (CSPRNG probe)
- Depends on: `@noble/ciphers`, `@noble/hashes`, `fflate`
- Used by: core layer

**Steganography layer:**
- Purpose: Zero-width-character hiding/extraction; port of stegcloak-rs message.rs
- Location: `src/stego/`
- Contains: zwc.ts
- Depends on: nothing (pure string arithmetic)
- Used by: core layer

**Settings/state layer:**
- Purpose: Typed proxy over `vendetta.plugin.storage`; password list utilities
- Location: `src/settings.ts`
- Contains: Settings interface, defaults, password parse/cycle/mask helpers
- Depends on: `src/core/keycache` (KeyCacheStore extends into Settings)
- Used by: all layers (settings is a singleton accessor)

**UI layer:**
- Purpose: React Native settings screen registered as the plugin's `settings` export
- Location: `src/ui/Settings.tsx`
- Contains: SettingsComponent (passwords, cover, mark fields, key-import field)
- Depends on: settings, crypto/random, core/keycache, util/base64, crypto/deflate
- Used by: `src/index.ts` (registered as `settings:` in the plugin export)

## Data Flow

### Outgoing Message (Encrypt)

1. User sends a message — `discord/send.ts` intercepts via `vendetta.patcher.instead("sendMessage", ...)` (`src/discord/send.ts:31`)
2. Checks `settings().enabled` and `chosenPassword()` — bails silently if either absent (`src/discord/send.ts:36-46`)
3. `getCachedKey(channelId, pw)` — synchronous cache lookup (`src/core/keycache.ts:67`)
4. **Cache hit:** calls `encryptWithKey(content, key, cover, rng)` (`src/core/encrypt.ts:21`)
   - `compress(utf8Encode(plaintext))` — raw-DEFLATE (`src/crypto/deflate.ts`)
   - `rng(24)` — 24-byte XChaCha nonce (`src/crypto/random.ts`)
   - `aeadEncrypt(key, nonce, compressed)` — XChaCha20-Poly1305 (`src/crypto/aead.ts`)
   - `frame(nonce, ctAndTag)` — version+nonce+ct binary packet (`src/core/payload.ts`)
   - `embed(cover, conceal(payload))` — ZWC encode + distribute over whitespace (`src/stego/zwc.ts`)
5. **Cache miss:** fire-and-forget `deriveKey(channelId, pw)`, reject the send (keeps text in composer), toast "send again"
6. Encrypted content replaces `message.content`; original send function proceeds

### Incoming Message (Decrypt)

1. FluxDispatcher fires — `discord/flux.ts` intercepts via `vendetta.patcher.before("dispatch", ...)` (`src/discord/flux.ts:96`)
2. Handles `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `LOAD_MESSAGES_SUCCESS`, `MESSAGE_START_EDIT` (`src/discord/flux.ts:74`)
3. `isCloaked(content)` — fast ZWC presence check (`src/stego/zwc.ts:136`)
4. `decryptWithCachedKeys(content, channelId, passwords)` — sync, cached keys only (`src/core/decrypt.ts:19`)
   - `extract(content)` — ZWC decode to bytes (`src/stego/zwc.ts:64`)
   - `unframe(bytes)` — split nonce from ct+tag (`src/core/payload.ts:22`)
   - Try each password (winner-hinted order): `getCachedKey` → `aeadDecrypt` → `decompress` → `utf8Decode`
5. **Cache hit / success:** mutate `message.content` to `mark + plaintext`; add id to `decryptedIds` guard
6. **Cache miss:** `backgroundDecrypt()` — derive all missing keys async, then re-dispatch `MESSAGE_UPDATE` with decrypted content (`src/discord/flux.ts:40`)

### Key Derivation (async, one-time per channel+password)

1. `deriveKey(channelId, pw)` called from background task (`src/core/keycache.ts:81`)
2. Check mem cache → check persisted `store.keys[channelId][passwordId(pw)]`
3. If miss: `deriveKeyAsync(password, channelId)` — Argon2id(64MiB,t=3,p=1) with `asyncTick:50ms` macrotask yield (`src/crypto/argon.ts:40`)
4. Result stored in mem Map and written to `plugin.storage.keys` as base64 (`src/core/keycache.ts:92`)
5. Pending map deduplicates concurrent derivations for the same key (`src/core/keycache.ts:85`)

### Key Sync (desktop → mobile, skip Argon2)

1. On desktop: `tools/derive-keys.mjs` runs `deriveKey(pw, channelId)` synchronously (native speed)
2. Output is `{ v:1, keys: { channelId: { passwordId: base64Key } } }` encoded as base64 bundle
3. On mobile: `/encrypt import:<bundle>` or Settings "Import keys" → `importKeys(obj.keys)` (`src/core/keycache.ts:51`)
4. Imported keys are merged into `plugin.storage.keys` under the same `passwordId(pw)` indexing

**State Management:**
- All persistent state lives in `vendetta.plugin.storage` (a reactive JSON proxy), accessed via the typed `Settings` wrapper in `src/settings.ts`
- In-memory volatile state: key Map (`mem`), pending derivation Map (`pending`), winner hint Map (`winners`), decryptedIds Set, deriving Set — all module-level singletons cleared in `onUnload`

## Key Abstractions

**Key cache (two-level):**
- Purpose: Avoid repeating the expensive 64MiB Argon2id derivation per message
- Files: `src/core/keycache.ts`
- Pattern: mem Map (hot path) backed by `plugin.storage.keys` (persisted base64); `passwordId()` hashes passwords to stable identifiers safe for storage

**Wire format (stegcloak-rs compat):**
- Purpose: Byte-exact interoperability with the GoofCord desktop Rust implementation
- Files: `src/core/payload.ts`, `src/stego/zwc.ts`, `src/crypto/aead.ts`, `src/crypto/argon.ts`, `src/crypto/deflate.ts`
- Pattern: Each primitive is a direct port of the corresponding stegcloak-rs source; test harness cross-checks both directions

**Sync-on-cache-hit / async-on-miss split:**
- Purpose: Keep the synchronous Flux dispatch hook non-blocking while still deriving keys on demand
- Files: `src/discord/flux.ts`, `src/core/decrypt.ts`, `src/core/keycache.ts`
- Pattern: Hot path uses only `getCachedKey` (sync, returns null on miss); cold path fires background async derivation then re-dispatches

## Entry Points

**Plugin load:**
- Location: `src/index.ts` — `export default { onLoad, onUnload, settings }`
- Triggers: Kettu evaluates the bundle and calls `onLoad()` on plugin activation
- Responsibilities: Detect RNG, init settings, init key cache, run self-test, patch Flux, patch send, register commands, expose `__goofcrypt` debug hook

**Plugin unload:**
- Location: `src/index.ts` — `onUnload()`
- Triggers: Plugin deactivation
- Responsibilities: Unpatch send, unpatch Flux, unregister commands, clear in-memory key/winner state

**Settings screen:**
- Location: `src/index.ts` — `settings: SettingsScreen` / `src/ui/Settings.tsx`
- Triggers: User opens plugin settings in Kettu
- Responsibilities: Render password/cover/mark fields, key import field, insecure-RNG toggle

## Architectural Constraints

- **Threading:** Hermes is single-threaded. All Flux/send patches are synchronous (no blocking I/O). Argon2id is deferred via `argon2idAsync` with `asyncTick:50ms` to yield macrotasks to the render loop.
- **Global state:** Module-level singletons in `src/core/keycache.ts` (`mem`, `pending`, `winners`), `src/discord/flux.ts` (`deriving`, `decryptedIds`), `src/discord/send.ts` (`disposers`), `src/discord/commands.ts` (`dispose`), `src/crypto/random.ts` (`rngFn`, `secure`), `src/settings.ts` (`store`). All are reset on `onUnload`.
- **No TextEncoder/TextDecoder:** Hermes does not guarantee these globals. All UTF-8 and base64 handling uses fflate's `strToU8/strFromU8` and the hand-rolled `src/util/base64.ts`.
- **No `class` syntax in output:** Hermes `eval` rejects class syntax at parse time. The build pipeline down-levels to ES5 via swc with `iterableIsArray:true` to avoid iterator-protocol for...of lowering (which drops the first element under Discord's Hermes).
- **No circular imports:** Import graph is strictly layered: `discord` → `core` → `crypto/stego/util`.
- **Encryption gated on secure RNG:** The send patch only encrypts if `secureRngAvailable()` is true (or `allowInsecureRng` is explicitly opted in). Decryption is never gated.

## Anti-Patterns

### Calling `deriveKey` (sync) on the hot path

**What happens:** `src/core/stegcloak.ts` uses the synchronous `deriveKey` from `src/crypto/argon.ts` — a 64MiB Argon2id call that blocks the JS thread for ~10 seconds.
**Why it's wrong:** On the Hermes event loop this freezes all UI rendering during derivation.
**Do this instead:** Use `deriveKeyAsync` (from `src/crypto/argon.ts`) + the two-level cache via `src/core/keycache.ts`. The sync `stegcloak.ts` path is intentionally limited to the device-free test harness (`tests/harness.ts`) and the desktop `tools/derive-keys.mjs` tool where blocking is acceptable.

### Accessing `vendetta.plugin.storage` directly

**What happens:** Other code might read/write the storage object without going through `settings()`.
**Why it's wrong:** Defaults are only applied by `initSettings`; raw access bypasses the type-safe `Settings` interface and skips default initialisation.
**Do this instead:** Always access via `settings()` from `src/settings.ts` after `onLoad`.

## Error Handling

**Strategy:** Swallow-and-count on hot paths; toast user-visible messages for actionable failures; hard-reject (return `Promise.reject`) for the send patch to keep the text in the composer.

**Patterns:**
- `safe(label, fn)` in `onLoad` (`src/index.ts:29`) — wraps each subsystem init so one failure cannot cascade
- `try { unpatch() } catch {}` pattern on all dispose/unpatch calls — unpatching on unload is best-effort
- `noteError(kind, e)` (`src/core/health.ts:12`) — increments counters for silent failures visible via `/encrypt status`
- `getCachedKey` returns `null` on miss (never throws) — lets the Flux hook proceed without try/catch on every message
- `aeadDecrypt` throws on authentication failure — intentional, used as the wrong-password signal in `src/core/decrypt.ts:36`

## Cross-Cutting Concerns

**Logging:** `vendetta.logger.log/error` for structured plugin logs; `showToast` (`src/discord/metro.ts:26`) for user-visible feedback. `showToast` falls back to `vendetta.logger.log` if toasts are unavailable.
**Validation:** Input validation is minimal by design (PSK crypto for casual privacy). `isCloaked()` gates the decode path. `unframe()` validates minimum length and version byte.
**Authentication:** Pre-shared-password model. No user authentication layer — all protection is AEAD tag verification (XChaCha20-Poly1305 throws on tampered/wrong-key data).

---

*Architecture analysis: 2026-05-30*
