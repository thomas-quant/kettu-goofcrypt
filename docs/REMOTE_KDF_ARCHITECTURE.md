# Authenticated Remote KDF Architecture

- **Status:** Proposed implementation specification
- **Date:** 2026-07-18
- **Primary client:** GoofCrypt for Kettu/Discord mobile
- **Server:** the separately maintained `goofcord-cloudserver` fork
- **Compatibility target:** current GoofCord/stegcloak-rs message format

**Platform applicability:** Kettu currently exists only on Android, so all
Kettu real-device acceptance in this architecture is Android-only. References
to iOS secure storage are hypothetical future-client considerations and do not
create an iOS Kettu release requirement.

## Goal Mode handoff

This document is the canonical implementation handoff for the remote-KDF work.
A future Codex Goal Mode run should read this file before planning or editing.

Suggested goal:

> Implement `docs/REMOTE_KDF_ARCHITECTURE.md` across `kettu-goofcrypt` and the
> sibling `goofcord-cloudserver` repository, preserving byte-exact GoofCord
> compatibility and the security invariants in this specification.

Expected repositories in the development workspace:

| Repository | Role | Expected relative location |
|---|---|---|
| `kettu-goofcrypt` | Mobile plugin and persistent channel-key cache | `.` |
| `goofcord-cloudserver` | Authentication, opaque GoofCord settings storage, and remote KDF endpoint | `../goofcord-cloudserver` |
| `stegcloak-rs` | Read-only compatibility reference and test-vector source | `../stegcloak-rs` |
| GoofCord checkout | Read-only cloud-format reference | `../stegcloak-rs/GoofCord` |

Goal Mode must inspect both writable repositories for their own `AGENTS.md` and
dirty-worktree state before editing. Existing unrelated changes belong to the
user and must be preserved.

## Locked decisions

1. **Do not modify GoofCord.** GoofCrypt consumes the cloud data GoofCord already
   uploads; GoofCord source, its WASM API, and its in-memory key cache are out of
   scope.
2. **Do not change the message protocol or KDF.** Byte-exact compatibility with
   GoofCord/stegcloak-rs remains a hard gate.
3. **Use the existing GoofCord cloud authentication and stored settings blob.**
   The authenticated account, not a client-supplied user ID, selects the blob.
4. **Require the GoofCord cloud encryption key.** GoofCord excludes message
   passwords when cloud encryption is disabled, so remote derivation must fail
   closed if no key or no encrypted password list is available.
5. **Do not return or persist plaintext message passwords on mobile.** On a
   channel cache miss, the worker decrypts the user's existing cloud blob,
   extracts the current password list, derives the channel keys, and returns
   only ordered 32-byte keys.
6. **Persist channel-scoped keys, not universal secrets.** The cloud encryption
   key is memory-only by default unless a genuine OS-backed Keychain/Keystore API
   is positively identified. Kettu plugin storage must not be described as
   secure storage.
7. **The remote service derives keys only.** Discord ciphertext and plaintext
   remain on the phone. There is no server-side message encryption/decryption
   endpoint.
8. **HTTPS plus the existing authenticated session is the initial transport.**
   Do not introduce HPKE, custom ticket systems, confidential-computing
   infrastructure, or a new device-pairing protocol in the first implementation.
9. **One remote derivation is allowed per channel at a time.** Rapid message
   events share the same pending operation and use the resulting cache entry.
10. **The WebView/WASM sidecar was already probed and is unavailable.** Do not
    reopen it during this work.

## Trust model

This is an explicit trusted-server feature, not a zero-knowledge protocol.

During a successful cold-channel request, the KDF worker can observe in memory:

- the user's cloud encryption key;
- the decrypted GoofCord settings object;
- the configured message passwords;
- the requested Discord channel ID;
- the resulting 32-byte channel keys.

The design reduces the duration and persistence of that exposure; it cannot
cryptographically hide those values from a compromised worker or host while
still producing the exact Argon2 output.

The worker must never persist or log those values. Database compromise alone
continues to reveal only the existing client-encrypted GoofCord settings blob,
hashed cloud authentication tokens, and ordinary server metadata.

## Non-goals

- Hiding secrets from the KDF worker or server host.
- Protecting a rooted/compromised phone.
- Implementing a new end-to-end password-sync protocol.
- Modifying GoofCord or exporting its in-memory key cache.
- Replacing the GoofCord cloud settings format.
- Changing Argon2 parameters to improve speed.
- Providing offline first-use derivation without a cached key.
- Claiming guaranteed memory erasure in JavaScript or managed runtimes.

## Existing compatibility requirements

The worker must derive the same key as
`src/crypto/argon.ts` and `../stegcloak-rs/src/encrypt.rs`:

| Parameter | Required value |
|---|---|
| Algorithm | Argon2id |
| Version | `0x13` / version 19 |
| Memory | 65,536 KiB (64 MiB) |
| Passes | 3 |
| Parallelism | 1 |
| Output | 32 bytes |
| Password input | Exact UTF-8 bytes; no normalization or trimming |
| Salt | Exact Discord channel ID UTF-8 bytes |

These values are not request parameters. They are compiled into the worker.
The worker must pass a committed byte-exact vector at startup and fail readiness
if it does not match.

All message operations remain local and retain the existing pipeline:

```text
Argon2id key -> raw DEFLATE -> XChaCha20-Poly1305 -> versioned payload -> ZWC
```

## Existing GoofCord cloud format

The current GoofCord client encrypts the settings blob before upload. The worker
must implement the same decoding operation as
`../stegcloak-rs/GoofCord/src/windows/settings/cloud/encryption.ts`:

1. Strict base64 decode.
2. Split `[32-byte salt][12-byte IV][16-byte GCM tag][ciphertext]`.
3. Derive a 32-byte key using scrypt:
   - `N = 32768`
   - `r = 8`
   - `p = 3`
4. Authenticate/decrypt with AES-256-GCM.
5. Brotli-decompress the authenticated plaintext.
6. Parse JSON.
7. Validate `encryptionPasswords` as a non-empty, bounded array of non-empty
   strings.

If GoofCord saved without a cloud encryption key, sensitive settings including
`encryptionPasswords` are excluded and the remaining blob is only
Brotli/base64-encoded. The remote-KDF endpoint must reject that case; it must not
silently accept a passwordless blob.

The worker must bound both encrypted and decompressed sizes before processing to
avoid memory/decompression abuse. The server's existing 1 MiB save limit is an
outer bound; the KDF decoder should also impose a conservative decompressed
settings limit.

## System overview

```text
GoofCord desktop
    |
    | existing /v1/save: client-encrypted settings blob
    v
GoofCord Cloud database
    ^
    | authenticated account lookup
    |
KDF worker <----- HTTPS request: cloud key + channel ID ----- Kettu mobile
    |
    | decrypt cloud blob in memory
    | extract ordered password list
    | derive all active keys for channel sequentially
    | return revision + ordered 32-byte keys
    v
Kettu mobile persistent channel-key cache
    |
    +--> all later message encryption/decryption stays local
```

## Cold-channel flow

### Outgoing message

1. Resolve the current channel and selected remote password slot.
2. Look for a current, send-capable cached key.
3. On a hit, encrypt and send synchronously using the existing local pipeline.
4. On a miss or stale entry, join/start the per-channel remote derivation.
5. Reject the current send while retaining the user's text, matching the current
   "key preparing; send again" behavior. Do not silently send plaintext.
6. When derivation succeeds, persist the keys and notify the user to resend.

Do not automatically queue and replay plaintext sends. Automatic replay risks
duplicates, reordering, and sending text after the user's intent changed.

### Incoming message

1. Perform a cheap structural payload check before requesting derivation:
   - recognized ZWC payload exists;
   - decoded frame is at least version + nonce + authentication tag length;
   - version byte is supported.
2. Try current cached keys synchronously.
3. On a miss, add the message ID to the channel's waiting set and join/start the
   single per-channel remote derivation.
4. When derivation succeeds, retry all waiting messages locally and redispatch
   successful decryptions.
5. On failure, leave ciphertext unchanged and start a short per-channel failure
   cooldown so repeated malformed/history events do not hammer the worker.

### Concurrency invariant

The pending-operation key is at least `(channelId, settingsRevision)`; until a
revision is known, use the current client revision state plus `channelId`.

```text
first message  -> creates remote Promise
later messages -> join the same Promise
success        -> cache populated, pending cleared
later traffic  -> synchronous cache hit
failure        -> pending cleared, cooldown recorded
```

The server must also bound per-account and global concurrency because each
derived slot consumes 64 MiB during Argon2.

## API contract

### Authentication

Reuse the existing cloud token and authentication middleware. The server derives
the user/account identity exclusively from the authenticated session. Requests
must not accept `userId` or any equivalent account selector.

The KDF route must never derive using only possession of the cloud bearer token.
Every request also requires the non-empty cloud encryption key. Otherwise a
stolen token would become a derivation oracle for every stored password.

### `POST /v2/kdf/derive`

Initial request:

```json
{
  "version": 1,
  "channelId": "1234567890123456789",
  "cloudEncryptionKey": "user-supplied cloud passphrase"
}
```

Rules:

- Require HTTPS in deployed mode.
- Bound the request body and cloud-key UTF-8 byte length.
- Treat `channelId` as an ASCII decimal string; never parse it through a
  JavaScript number.
- Fetch the stored settings blob for the authenticated account.
- Derive every active password slot sequentially in the array's existing order.
- Never include passwords or a password-derived identifier in the response.

Successful response:

```json
{
  "version": 1,
  "settingsRevision": "base64url-sha256-of-stored-opaque-blob",
  "keys": [
    { "slot": 0, "key": "canonical-base64-32-byte-key" },
    { "slot": 1, "key": "canonical-base64-32-byte-key" }
  ]
}
```

`slot` is the password's array index for this settings revision. Do not expose
the current `passwordId()` value (truncated SHA-256 of the password), because it
can act as a cheap offline password-guessing verifier.

`settingsRevision` is initially the SHA-256 hash of the exact opaque settings
blob stored by the server. It intentionally reveals nothing beyond equality and
changes. Because GoofCord uses random salt/IV for each save, unrelated settings
saves may change this revision and cause harmless extra derivations. Avoid a
more complex password-only revision protocol in the first implementation.

### Optional lightweight revision endpoint

`GET /v2/kdf/revision` may return the authenticated user's current opaque-blob
revision without decrypting it:

```json
{ "version": 1, "settingsRevision": "..." }
```

Use it on plugin load, explicit refresh, and at a conservative TTL before
outgoing encryption. Do not call it per message. A revision change marks current
send keys stale; previous keys remain decrypt-only until evicted by policy.

### Errors

Return stable machine-readable codes without echoing request material:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Invalid version, channel, bounds, or encoding |
| 401 | `UNAUTHORIZED` | Existing cloud session is absent/invalid |
| 404 | `CLOUD_SETTINGS_MISSING` | No stored settings blob for the account |
| 409 | `PASSWORDS_NOT_SYNCED` | Blob is passwordless or lacks a usable password list |
| 422 | `CLOUD_DECRYPT_FAILED` | Wrong cloud key, corrupted blob, or unsupported format |
| 429 | `KDF_BUSY` | Per-account/global rate or concurrency limit reached |
| 500 | `KDF_FAILED` | Generic internal derivation failure |

The client should show actionable but non-secret messages, including telling the
user to configure a cloud key and save GoofCord settings when passwords are not
present.

## Mobile state and storage

### Session-only universal secret

`cloudEncryptionKey` is required to enable/use remote derivation, but it is
memory-only by default:

- keep it in a module-level session holder;
- clear it on plugin unload;
- never include it in diagnostics, errors, health counters, or storage exports;
- prompt again after Discord/plugin restart when a new uncached channel needs it.

A future implementation may remember it only after positively identifying a
real Android Keystore/iOS Keychain-backed native API. Do not implement a fake
vault by encrypting the key with another key stored beside it in plugin storage.

If an explicit "remember insecurely" option is later added, it must be opt-in
and accurately state that Kettu storage is plaintext. It is not part of the
initial goal.

The revocable cloud authentication token may be persisted under the project's
existing casual-privacy limitations if needed for usability, but must never be
logged or exported. Prefer OS-backed storage if a genuine API becomes available.

### Persistent channel-key cache

Remote cache entries use ordered slots rather than raw passwords or
`passwordId()`:

```ts
interface RemoteChannelKeySet {
    settingsRevision: string;
    keys: string[]; // canonical base64, each exactly 32 bytes
    sendCapable: boolean;
}

interface RemoteKeyCache {
    [channelId: string]: RemoteChannelKeySet[]; // current + bounded old revisions
}
```

Requirements:

- Strictly validate canonical base64 and exactly 32 decoded bytes before write.
- The newest current-revision slots are send-capable.
- Older revisions are decrypt-only so password rotation does not make historical
  messages immediately unreadable.
- Bound retained old revisions per channel and provide a clear-cache action.
- A settings revision change never causes silent plaintext sending.
- Remote mode must not require raw password strings to look up keys.

The existing manual/local password mode may remain available as a distinct
fallback. Remote failure must not silently switch modes or weaken encryption.

## Cloud-key enforcement in Kettu

Remote KDF cannot be enabled as ready until all of these are present:

- configured HTTPS cloud host (allow explicit localhost HTTP only for development);
- valid existing cloud authentication session/token;
- non-empty session cloud encryption key;
- successful worker response proving that the stored blob decrypts and contains
  at least one message password.

Kettu must not write a partial settings object back through GoofCord's existing
`/v1/save`; doing so could overwrite unrelated GoofCord configuration. This
architecture treats that blob as read-only. Kettu-specific state belongs in
plugin storage or separate versioned server endpoints.

## Worker implementation requirements

The "worker" is a logical isolation boundary. The initial implementation may use
a worker thread or bounded subprocess inside the existing server deployment; it
does not require a separately operated microservice. It must not run 64 MiB
Argon2 synchronously on the primary HTTP event loop.

Required controls:

- fixed compiled-in cloud-decryption and Argon2 parameters;
- startup byte-vector self-test;
- no database writes from the derive path;
- no password/key response caching on the server;
- no request/response body logging, tracing, APM capture, or crash-report fields;
- bounded cloud-key length, password count/length, blob size, decompressed size,
  and response size;
- one active derivation batch per authenticated account;
- a small global concurrency cap based on available memory;
- sequential slot derivation within a request;
- best-effort zeroization of mutable password, KDF-memory, and key buffers;
- generic error handling that does not serialize caught secret-bearing values.

"Entirely in memory" means no intentional persistence of the cloud key,
plaintext settings, passwords, or derived keys. It does not promise that a
managed runtime, TLS stack, kernel, swap, or crash dump can never retain a copy.

## Security and abuse cases

| Case | Required behavior |
|---|---|
| Stolen cloud token without cloud key | Cannot derive; worker rejects missing/invalid cloud key |
| Wrong cloud key | AES-GCM authentication fails; no Argon work; return `CLOUD_DECRYPT_FAILED` |
| Cloud sync saved without encryption | No passwords exist; return `PASSWORDS_NOT_SYNCED` |
| Malformed single-ZWC message | Client structural check prevents remote request |
| Many cloaked messages loaded at once | One pending request per channel; waiting messages share it |
| Many distinct-channel requests | Client cooldown plus server per-account/global limits |
| Password order/change in GoofCord | New settings revision; new slots become send-capable, old slots decrypt-only |
| Unrelated GoofCord cloud save | Revision may change and cause safe extra derivation |
| Server/database compromise at rest | Stored GoofCord blob remains client-encrypted; no KDF secrets intentionally stored |
| Worker/host compromise during request | Cloud key, passwords, and derived keys may be captured; accepted trust boundary |
| Remote service unavailable | Do not send plaintext; retain outgoing text and leave incoming ciphertext unchanged |

## Observability

Allowed aggregate metrics:

- accepted/rejected request counts;
- stable error-code counts;
- derivation batch and slot counts;
- duration histogram;
- queue depth and busy responses.

Forbidden telemetry:

- request or response bodies;
- cloud keys or password values;
- password hashes/identifiers;
- channel IDs;
- derived keys;
- decrypted settings;
- authentication headers/tokens.

## Implementation sequence for Goal Mode

### Stage 1: Freeze protocol vectors and contracts

- Add/confirm a committed exact Argon2 vector shared by mobile and server tests.
- Add GoofCord cloud-blob fixtures for encrypted, wrong-key, passwordless, and
  malformed cases without committing real secrets.
- Define request/response/error schemas in each repository.
- Decide the simplest server worker engine that stays off the HTTP event loop and
  passes the exact vector. Engine choice is subordinate to vector equality.

### Stage 2: Implement server read/decrypt/derive path

- Add authenticated settings lookup that never accepts a client account ID.
- Add strict current-format cloud-blob decoder with size limits.
- Add the bounded in-memory KDF worker.
- Add `/v2/kdf/derive` and optional `/v2/kdf/revision`.
- Add rate/concurrency controls and secret-safe logging tests.

Likely server integration points:

- `../goofcord-cloudserver/src/routes/v2.ts`
- `../goofcord-cloudserver/src/services/settings/settingsService.ts`
- `../goofcord-cloudserver/src/contracts.ts`
- `../goofcord-cloudserver/src/security/index.ts`
- new focused KDF/cloud-decoder service modules and tests

### Stage 3: Implement Kettu cloud session and remote cache

- Add cloud host/auth settings and token acquisition/import UX.
- Add session-only cloud-key holder and clear-on-unload behavior.
- Add remote API client with bounded timeouts and stable error mapping.
- Introduce versioned ordered-slot cache storage and migration without corrupting
  the existing manual key cache.
- Add explicit refresh/status/clear controls.

Likely mobile integration points:

- `src/settings.ts`
- `src/core/keycache.ts` or a separate `src/core/remoteKeycache.ts`
- new `src/cloud/` modules for API/session/schema handling
- `src/ui/Settings.tsx`
- `src/discord/commands.ts`
- `src/index.ts`

### Stage 4: Wire cold paths safely

- Replace per-message background derivation storms with one channel-level pending
  operation and waiting-message set.
- Require structural cloaked-payload validation before remote work.
- Wire outgoing reject/retain/resend behavior to the shared pending operation.
- Add failure cooldown and no-silent-fallback behavior.

Likely files:

- `src/discord/flux.ts`
- `src/discord/send.ts`
- `src/core/decrypt.ts`
- `src/core/encrypt.ts`
- `src/stego/zwc.ts` or a new lightweight payload-validation helper

### Stage 5: Cross-repository verification

- Unit-test server authentication, account binding, format validation, bounds,
  rate limits, and exact key output.
- Unit-test mobile schema validation, cache migration, pending deduplication,
  cooldown, revision behavior, and strict 32-byte key acceptance.
- Run the existing stegcloak-rs compatibility harness unchanged.
- Add an integration test using a synthetic GoofCord cloud blob and verify that a
  returned server key decrypts/encrypts through the existing GoofCrypt pipeline.
- Perform real-device checks for authentication UX, session-only cloud key,
  multiple rapid incoming messages, multiple rapid send attempts, wrong cloud
  key, missing cloud passwords, server unavailability, and restart cache hits.

## Acceptance criteria

The implementation is complete only when all of the following hold:

- [ ] No GoofCord source or dependency changes are required.
- [ ] The existing byte-compatibility harness remains green.
- [ ] Server startup refuses KDF readiness on an exact-vector mismatch.
- [ ] Remote KDF cannot run with only a stolen/valid cloud bearer token.
- [ ] The worker derives from the authenticated user's stored blob and supplied
      cloud key without persisting plaintext settings, passwords, or keys.
- [ ] Kettu does not receive or persist plaintext message passwords in remote mode.
- [ ] Kettu does not persist the cloud encryption key by default.
- [ ] Every returned key is canonical-base64 validated and exactly 32 bytes before
      it reaches persistent cache storage.
- [ ] Multiple rapid messages in one cold channel cause one server request.
- [ ] Malformed ZWC content cannot trigger Argon work.
- [ ] Multiple password slots are returned and tried in stable order.
- [ ] Current-revision keys are used for sending; bounded older revisions are
      decrypt-only.
- [ ] Remote failure never causes plaintext sending or a silent crypto downgrade.
- [ ] Server request bodies, secrets, channel IDs, and returned keys do not appear
      in logs, traces, health reports, or error responses.
- [ ] Per-account and global concurrency limits prevent unbounded 64 MiB jobs.
- [ ] Wrong-key, passwordless-cloud, stale-revision, busy-worker, offline-server,
      and restart-cache-hit paths have explicit tested behavior.

## Decision gates that do not change the architecture

Goal Mode may resolve these during implementation without revisiting the locked
decisions above:

1. **Worker engine:** choose the least complex server-side implementation that
   stays off the HTTP event loop, supports bounded memory/concurrency, and passes
   the exact vector.
2. **Mobile authentication UX:** reuse the existing token format; begin with a
   safe token import flow if a polished mobile OAuth callback is not reachable.
3. **Secure storage probe:** if a genuine OS-backed module is reachable, it may
   store the cloud key only after explicit opt-in. Failure to find one keeps the
   required memory-only behavior.
4. **Revision polling interval and old-revision cap:** choose conservative bounded
   defaults and surface them in status/clear UX.

Any proposal to change the message KDF, send passwords without a cloud key,
persist universal secrets in ordinary Kettu storage by default, modify GoofCord,
or add server-side message decryption is outside this specification and requires
an explicit architecture revision.
