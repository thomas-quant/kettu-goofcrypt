---
quick_id: 260718-qlx
phase: quick
plan: 260718-qlx
type: execute
wave: 1
depends_on: [260718-prx]
status: planned
description: Stage 2 - implement authenticated remote KDF cloud decode, bounded workers, readiness gating, routes, and abuse controls
autonomous: true
requirements: [REMOTE-KDF-STAGE-2]
files_modified:
  - ../goofcord-cloudserver/src/kdf/cloudBlob.ts
  - ../goofcord-cloudserver/src/kdf/pool.ts
  - ../goofcord-cloudserver/src/kdf/service.ts
  - ../goofcord-cloudserver/src/kdf/contracts.ts
  - ../goofcord-cloudserver/src/config.ts
  - ../goofcord-cloudserver/src/contracts.ts
  - ../goofcord-cloudserver/src/auth/authenticationService.ts
  - ../goofcord-cloudserver/src/security/index.ts
  - ../goofcord-cloudserver/src/routes/routeSecurity.ts
  - ../goofcord-cloudserver/src/routes/v2.ts
  - ../goofcord-cloudserver/src/runtime/application.ts
  - ../goofcord-cloudserver/src/runtime/lifecycle.ts
  - ../goofcord-cloudserver/src/runtime/server.ts
  - ../goofcord-cloudserver/src/index.ts
  - ../goofcord-cloudserver/.env.example
  - ../goofcord-cloudserver/docker-compose.yml
  - ../goofcord-cloudserver/README.md
  - ../goofcord-cloudserver/test/kdf/cloudBlob.test.ts
  - ../goofcord-cloudserver/test/kdf/pool.test.ts
  - ../goofcord-cloudserver/test/kdf/service.test.ts
  - ../goofcord-cloudserver/test/auth/authenticationService.test.ts
  - ../goofcord-cloudserver/test/config.test.ts
  - ../goofcord-cloudserver/test/security/security.test.ts
  - ../goofcord-cloudserver/test/runtime/application.test.ts
  - ../goofcord-cloudserver/test/runtime/server.test.ts
  - ../goofcord-cloudserver/test/integration/v1.test.ts
  - ../goofcord-cloudserver/test/integration/applicationSecurity.test.ts
  - ../goofcord-cloudserver/test/integration/v2.test.ts
must_haves:
  truths:
    - "POST /v2/kdf/derive and GET /v2/kdf/revision are HTTPS-only authenticated endpoints; account identity comes exclusively from authenticatedSession.userId produced by read-only token authentication, and every body/query account selector including userId is rejected as INVALID_REQUEST rather than used"
    - "The derive endpoint requires the bounded cloudEncryptionKey, loads only that authenticated account's opaque settings blob, strictly decodes the current GoofCord scrypt/AES-256-GCM/Brotli format in memory, and recognizes the passwordless Brotli/base64 form only to return PASSWORDS_NOT_SYNCED"
    - "Cloud decoding enforces canonical base64, the 32-byte salt/12-byte IV/16-byte tag/ciphertext layout, exact async scrypt N=32768 r=8 p=3 dkLen=32 with 256 MiB maxmem, authenticated decryption before parsing, a 1 MiB outer blob bound, Bun-compatible asynchronous Brotli capped by maxOutputLength=256 KiB, 1-8 exact non-empty password strings, and 256 UTF-8 bytes per password without trimming or normalization"
    - "A configured pool of 1-4 dedicated Bun Workers (default 1) reuses src/kdf/worker.ts; every worker passes the committed exact-vector self-test before the server listens or reports ready, every worker derive has a validated 5-120 second timeout (default 30 seconds), and any startup mismatch or worker initialization failure leaves readiness false and prevents listen"
    - "Only one derivation batch can be active per authenticated account and only the configured memory-based global number can be active server-wide; excess work fails immediately with KDF_BUSY, while each admitted batch derives password slots sequentially in stable source order with the locked Argon2id parameters"
    - "Malformed requests, absent auth, missing settings, passwordless settings, corrupt/wrong-key cloud blobs, admission/rate exhaustion, and generic worker failures return only the frozen version-1 error bodies with their exact 400/401/404/409/422/429/500 mappings"
    - "GET /v2/kdf/revision hashes the exact opaque stored blob bytes as unpadded base64url SHA-256 without decrypting it, and derive returns only version, that revision, and ordered slot/key entries--never passwords, password hashes, passwordId, account identity, or adjustable KDF parameters"
    - "The KDF path performs no settings/session/key persistence writes, retains no server-side password or derived-key cache, best-effort clears mutable secret buffers, and never logs, traces, diagnoses, reflects, or labels requests with tokens, account IDs, channel IDs, cloud keys, passwords, blob bodies, or returned keys"
    - "KDF admission is ordered HTTPS -> shared IP limit 12/60s -> 4096-byte body stream/content-length limit -> read-only auth -> token-hash derive limit 4/60s -> JSON parse (revision uses token-hash 12/60s and no body); global HTTPS enforcement is KDF-path-aware under either ENFORCE_HTTPS value, and these controls compose without changing existing v1 behavior"
    - "A failed worker batch returns KDF_FAILED, quarantines that slot, and makes exactly one immediate self-tested replacement attempt; replacement failure leaves the slot unavailable with no retry loop so work sees KDF_BUSY when no healthy slot remains, while shutdown suppresses or awaits replacement and wins every race"
  artifacts:
    - path: "../goofcord-cloudserver/src/kdf/cloudBlob.ts"
      provides: "Strict bounded GoofCord cloud decoder plus opaque settings-revision hashing"
      contains: "32768"
    - path: "../goofcord-cloudserver/src/kdf/pool.ts"
      provides: "Bounded dedicated-worker lifecycle, startup self-test, lease/admission, timeout, and replacement"
      contains: "self-test"
    - path: "../goofcord-cloudserver/src/kdf/service.ts"
      provides: "Per-account/global batch admission and sequential ordered slot derivation without caching"
      contains: "KDF_BUSY"
    - path: "../goofcord-cloudserver/src/routes/v2.ts"
      provides: "Authenticated versioned derive and revision routes with stable error mapping"
      contains: "/kdf/derive"
    - path: "../goofcord-cloudserver/src/security/index.ts"
      provides: "KDF-path-aware HTTPS enforcement plus exact shared-IP/body/derive-token/revision-token admission controls"
      contains: "MAX_KDF_REQUEST_BODY_BYTES"
    - path: "../goofcord-cloudserver/src/config.ts"
      provides: "Validated 1-4/default-1 worker capacity, 5-120s/default-30s job timeout, and explicit local HTTP switch"
      contains: "KDF_JOB_TIMEOUT_MS"
    - path: "../goofcord-cloudserver/src/runtime/server.ts"
      provides: "KDF initialization gate before application listen/readiness and graceful worker shutdown"
      contains: "initializeKdf"
    - path: "../goofcord-cloudserver/test/integration/v2.test.ts"
      provides: "End-to-end account binding, HTTPS, exact contract, stable error, read-only, and secret-safety coverage"
      contains: "CLOUD_DECRYPT_FAILED"
  key_links:
    - from: "../goofcord-cloudserver/src/routes/v2.ts"
      to: "../goofcord-cloudserver/src/auth/authenticationService.ts"
      via: "route middleware authenticates the raw existing session token read-only and sets authenticatedSession before any settings lookup"
      pattern: "authenticateReadOnly|authenticatedSession"
    - from: "../goofcord-cloudserver/src/routes/v2.ts"
      to: "../goofcord-cloudserver/src/services/settings/settingsService.ts"
      via: "both endpoints call only settings.load with authenticatedSession.userId; client JSON/query data never supplies the lookup key"
      pattern: "settings.load"
    - from: "../goofcord-cloudserver/src/kdf/service.ts"
      to: "../goofcord-cloudserver/src/kdf/cloudBlob.ts"
      via: "an admitted batch strictly decrypts/validates the stored blob before dispatching any Argon request, so wrong keys never consume Argon work"
      pattern: "decodeCloudBlob|settingsRevision"
    - from: "../goofcord-cloudserver/src/kdf/pool.ts"
      to: "../goofcord-cloudserver/src/kdf/worker.ts"
      via: "a fixed-capacity pool spawns the Stage 1 worker, self-tests every instance, and sends one sequential derive request at a time per leased worker"
      pattern: "new Worker|worker.ts"
    - from: "../goofcord-cloudserver/src/runtime/server.ts"
      to: "../goofcord-cloudserver/src/runtime/readiness.ts"
      via: "startRuntime awaits KDF pool initialization after database/index setup and before serve/markReady; failure cleans up and never listens"
      pattern: "initializeKdf|markReady"
    - from: "../goofcord-cloudserver/src/runtime/application.ts"
      to: "../goofcord-cloudserver/src/routes/v2.ts"
      via: "the dependency-built v2 router receives auth, settings, KDF, and KDF-specific security middleware instead of using the placeholder singleton"
      pattern: "createV2Router"
    - from: "../goofcord-cloudserver/src/runtime/application.ts"
      to: "../goofcord-cloudserver/src/security/index.ts"
      via: "application-level path-aware enforceHttps runs before the mounted v2 router, emitting the frozen KDF error while retaining legacy non-KDF behavior"
      pattern: "enforceHttps"
    - from: "../goofcord-cloudserver/src/index.ts"
      to: "../goofcord-cloudserver/src/kdf/pool.ts"
      via: "production passes validated KDF_GLOBAL_CONCURRENCY and KDF_JOB_TIMEOUT_MS into the pool before runtime initialization"
      pattern: "kdfGlobalConcurrency|kdfJobTimeoutMs"
---

<objective>
Implement Stage 2 of `docs/REMOTE_KDF_ARCHITECTURE.md` entirely in `../goofcord-cloudserver`: strict current-format cloud decoding, an authenticated read-only v2 KDF boundary, bounded isolated Argon workers, startup vector readiness gating, stable derive/revision contracts, and layered abuse controls.

Purpose: Give later mobile stages a production-grade remote derivation service that is byte-exact with GoofCord while ensuring a stolen bearer token alone is insufficient, untrusted requests cannot select another account or amplify memory without bounds, and secrets never become server state or telemetry.

Output: A tested decoder, remote-KDF service and worker pool, authenticated `/v2/kdf/derive` and `/v2/kdf/revision` routes, runtime readiness/shutdown integration, security/configuration updates, and end-to-end Stage 2 coverage. No mobile cold-path/cache/UX work is part of this task.
</objective>

<execution_context>
@$HOME/.codex/gsd-core/workflows/execute-plan.md
@$HOME/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/STATE.md
@docs/REMOTE_KDF_ARCHITECTURE.md
@.planning/quick/260718-prx-stage-1-freeze-remote-kdf-contracts-exac/260718-prx-PLAN.md
@.planning/quick/260718-prx-stage-1-freeze-remote-kdf-contracts-exac/260718-prx-VERIFICATION.md
@../goofcord-cloudserver/src/kdf/contracts.ts
@../goofcord-cloudserver/src/kdf/worker.ts
@../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json
@../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json
@../goofcord-cloudserver/src/auth/authenticationService.ts
@../goofcord-cloudserver/src/services/settings/settingsService.ts
@../goofcord-cloudserver/src/security/index.ts
@../goofcord-cloudserver/src/runtime/server.ts
@../goofcord-cloudserver/docs/REMOTE_KDF_WORKER_DECISION.md
</context>

<constraints>
- Treat every locked decision, security invariant, Stage 2 item, acceptance criterion, and stable error mapping in `docs/REMOTE_KDF_ARCHITECTURE.md` as canonical. Compatibility wins over optimization.
- Reuse the Stage 1 `src/kdf/contracts.ts`, fixtures, exact-pinned `@noble/hashes` 1.8.0 dependency, and dedicated `src/kdf/worker.ts`; do not duplicate or adjust Argon2id parameters and do not replace the proven worker engine.
- Never accept an account ID, password list, salt, KDF options, output length, or worker/concurrency setting from the request. `authenticatedSession.userId` from the existing token store is the only settings-lookup identity; the required cloud key remains an independent client-held factor.
- The derive path may read authentication and settings records but must not touch session activity, call settings save/delete, persist plaintext passwords or returned keys, or introduce password/key/revision response caches. Refactor authentication to expose a named read-only lookup for v2 while preserving v1 session-touch behavior.
- Require HTTPS on both KDF endpoints even when legacy global enforcement is disabled. Permit direct loopback HTTP only behind an explicit development-only configuration switch; trusted proxy resolution remains the sole authority for forwarded HTTPS.
- Bound before allocation/work: the KDF derive body is exactly 4096 bytes maximum; cloud-key UTF-8 bytes, decimal channel length, outer stored blob, decoded layout, asynchronous Brotli output, password slot count/password UTF-8 size, concurrent batches, worker count, job duration, and rate-limiter key space use the frozen limits. Worker count defaults to 1 and validates 1-4; each worker derive defaults to 30,000 ms and validates 5,000-120,000 ms.
- The passwordless Brotli/base64 form is detection-only and can never supply derivation passwords. Invalid/noncanonical outer encoding maps to `INVALID_REQUEST`; canonical undersized/corrupt/authentication/decompression/JSON failures map to `CLOUD_DECRYPT_FAILED`; a valid settings object with no non-empty password list maps to `PASSWORDS_NOT_SYNCED`; an authenticated object with a present but malformed/over-bound list is rejected without derivation.
- Use asynchronous `node:crypto` scrypt with exact `N=32768,r=8,p=3,dkLen=32,maxmem=268435456` (256 MiB), and promisified asynchronous `node:zlib.brotliDecompress` with `maxOutputLength=262144` (256 KiB), so neither cloud-key derivation nor decompression runs synchronously on the request loop. Verify these exact APIs against pinned Bun 1.3.13. The 64 MiB Argon operation must remain synchronous only inside dedicated Bun Workers.
- Do not add request/body/header logging, per-account/channel metrics, APM payloads, diagnostic dumps, error-message reflection, or health detail. If aggregate counters are added, labels may contain only a bounded stable result/error category.
- Preserve existing v1 API bodies, auth behavior, rate limiting, OAuth/settings semantics, Mongo schemas/indexes, and all unrelated work. Do not modify `../stegcloak-rs`, GoofCord, the mobile message pipeline, or user-owned `CLAUDE.md`/`AGENTS.md` changes.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement the strict bounded cloud decoder and opaque revision</name>
  <files>../goofcord-cloudserver/src/kdf/cloudBlob.ts, ../goofcord-cloudserver/src/kdf/contracts.ts, ../goofcord-cloudserver/test/kdf/cloudBlob.test.ts</files>
  <behavior>
    - The Stage 1 encrypted fixture decodes only with its exact synthetic cloud key into the exact ordered `encryptionPasswords`, including leading/trailing whitespace and Unicode unchanged; `settingsRevision` equals unpadded base64url SHA-256 of the exact opaque stored blob string.
    - Before classification, the decoder enforces non-empty canonical padded base64 and the 1 MiB stored-string/decoded-data cap. It first attempts bounded asynchronous Brotli-only decoding: any output within 256 KiB that is strict UTF-8 JSON representing a passwordless-form object returns `PASSWORDS_NOT_SYNCED` and is never a password source. Only a non-passwordless input proceeds to the encrypted branch.
    - The encrypted branch requires `[32 salt][12 IV][16 GCM tag][non-empty ciphertext]`, derives only the cloud key with async scrypt `N=32768,r=8,p=3,dkLen=32,maxmem=268435456`, authenticates AES-256-GCM, and only then uses bounded asynchronous Brotli with `maxOutputLength=262144`.
    - AES-256-GCM authentication completes before Brotli, strict UTF-8, JSON, or password inspection. Wrong cloud key and canonical corrupt/short data return only `CLOUD_DECRYPT_FAILED` and never invoke Argon.
    - Brotli output is aborted at 256 KiB rather than decompressed unbounded. JSON must be an object; absent or empty `encryptionPasswords` maps to `PASSWORDS_NOT_SYNCED`, while a present non-array, over-slot, non-string, empty-entry, or over-byte list maps to `CLOUD_DECRYPT_FAILED`, always before KDF dispatch. No trimming, normalization, deduplication, sorting, hashing, or empty-slot skipping occurs.
    - A canonical Brotli-only GoofCord object is classification-only: regardless of any attacker-supplied password-looking property, it returns `PASSWORDS_NOT_SYNCED` and can never supply derivation passwords. If bounded Brotli-only recognition does not yield a valid JSON object, classification falls through to strict encrypted layout/decrypt/authenticate; noncanonical base64/outer bound violations return `INVALID_REQUEST` and encrypted-format corruption returns `CLOUD_DECRYPT_FAILED`.
  </behavior>
  <action>
    Write the failing production-decoder tests first, consuming the committed Stage 1 cloud fixture rather than regenerating it or importing the independent fixture reference decoder. Cover encrypted success and exact byte/order preservation, wrong key, passwordless-first detection, a Brotli-only object containing a fake `encryptionPasswords` property that still returns `PASSWORDS_NOT_SYNCED`, fall-through from failed passwordless recognition to encrypted layout, both committed malformed cases, empty and oversized input, canonical short layout, changed tag/ciphertext, strict UTF-8/JSON/object failures, absent/empty/malformed/too-many/oversized authenticated passwords, and a Brotli expansion that crosses 262,144 bytes. Keep Argon/worker imports entirely out of the decoder; Task 2's service boundary test will prove every decoder failure results in zero worker derives.

    Implement `cloudBlob.ts` using named constants from `src/kdf/contracts.ts`. Add `MAX_KDF_REQUEST_BODY_BYTES = 4096` and only a code-only domain error helper if needed; do not alter any frozen public shape, status, or other bound. Canonically validate/re-encode base64 before classification. Promisify Bun 1.3.13's asynchronous `node:zlib.brotliDecompress(input, { maxOutputLength: 262144 }, callback)`; do not call `brotliDecompressSync`, perform an unbounded decompress followed by a size check, or fall back to synchronous work. First use that bounded async helper only to recognize a strict-UTF-8 JSON object as the passwordless form and return `PASSWORDS_NOT_SYNCED` without inspecting or accepting passwords. If recognition fails, enforce encrypted layout and use asynchronous `node:crypto.scrypt` with exact `N=32768,r=8,p=3,dkLen=32,maxmem=268435456`, then AES-256-GCM with salt/IV/tag/ciphertext slices in frozen order. Authenticate before calling the same bounded async Brotli helper, then decode UTF-8 fatally, parse JSON, and validate the exact authenticated password array without normalization.

    Freeze the scrypt options in a named immutable internal/exported constant and assert in the decoder test that they are exactly `{N:32768,r:8,p:3,maxmem:268435456}` with output length 32; fixture success alone must not permit a smaller/different maxmem to slip through. The test must also prove Bun honors `maxOutputLength` by rejecting a highly compressible payload whose expansion crosses 256 KiB, and prove asynchronous event-loop progress by scheduling a zero-delay timer before awaiting a valid near-limit decompression and requiring the timer to run before resolution. Represent failures with a domain error carrying only a stable `KdfErrorCode`, never input or a caught crypto/parser message. Export a revision helper that hashes the exact opaque stored string with SHA-256 and returns canonical unpadded base64url without decrypting. In `finally`, best-effort overwrite mutable cloud-key bytes, scrypt key, decoded blob slices/copies, decrypted compressed bytes, and decompressed JSON bytes; clear returned password array slots after the caller finishes in Task 2, while documenting managed-string erasure limits.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/goofcord-cloudserver && bun test test/kdf/fixtures.test.ts test/kdf/contracts.test.ts test/kdf/cloudBlob.test.ts && bun run typecheck</automated>
  </verify>
  <done>The production decoder independently matches the current GoofCord fixture, rejects every malformed/oversized/passwordless case with the frozen non-reflective code before Argon, preserves exact password bytes/order, bounds all expensive expansion, and computes revision without decrypting.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build the bounded worker pool and read-only sequential KDF service</name>
  <files>../goofcord-cloudserver/src/kdf/pool.ts, ../goofcord-cloudserver/src/kdf/service.ts, ../goofcord-cloudserver/test/kdf/pool.test.ts, ../goofcord-cloudserver/test/kdf/service.test.ts</files>
  <behavior>
    - Initialization creates exactly `KDF_GLOBAL_CONCURRENCY` workers (default 1, accepted range 1-4) and requires every real Stage 1 worker to return a matching exact-vector self-test before the pool is usable. Any mismatch, malformed protocol response, exit, or 30-second default initialization/job timeout rejects initialization and terminates all workers.
    - An account can hold at most one active batch and the whole service can hold no more batches than worker capacity. There is no unbounded wait queue: a same-account overlap or exhausted global lease returns `KDF_BUSY` immediately without cloud decrypt or Argon work.
    - One lease covers the entire admitted batch, including cloud decode, and dispatches its 1-8 password slots one at a time. Slot `n+1` is not sent before slot `n` completes; output slots are contiguous and preserve the decoder's original order.
    - Each derive job uses `KDF_JOB_TIMEOUT_MS` (default 30000; accepted 5000-120000). A timed-out, crashed, or protocol-invalid worker makes its current batch return only `KDF_FAILED`, is terminated and quarantined, and triggers exactly one immediate replacement attempt whose worker must self-test before re-admission.
    - If that one replacement spawn/self-test fails, the slot remains unavailable with no background retry loop or unhandled rejection; other healthy slots continue, and new work returns `KDF_BUSY` whenever no healthy idle slot remains. Shutdown sets closing first, rejects new leases, suppresses not-yet-started replacements, awaits/terminates an in-flight replacement without re-admitting it, and wins every replacement/release race idempotently.
    - The wrong cloud key, passwordless blob, malformed settings, or invalid password list results in zero worker derive messages. Identical successful requests derive again rather than reading a server key cache, and no service operation writes settings/session/key state.
  </behavior>
  <action>
    Add `pool.test.ts` first with an injectable Worker factory/clock for deterministic failure paths plus a real-worker case. Prove the accepted 1-4 capacity/default 1, a self-test sent to every instance, startup failure cleanup, successful shared-vector derivation through the actual `src/kdf/worker.ts`, immediate busy admission, opaque request IDs, the 30,000 ms default and 5,000/120,000 ms timeout boundaries, crash/protocol failure, and absence of input reflection. For replacement, assert the failing batch receives `KDF_FAILED`; the slot is quarantined; exactly one replacement is attempted and self-tested before reuse; a failed replacement is not retried and causes `KDF_BUSY` when it was the last healthy slot; remaining healthy slots still work; and shutdown racing a pending replacement suppresses/awaits it, terminates it, never re-admits it, and settles without an unhandled rejection. Retain the Stage 1 off-primary-loop worker test as a separate gate.

    Implement `pool.ts` as a fixed-capacity collection of dedicated Bun Worker slots around the existing worker protocol. Validate capacity 1-4 and timeout 5,000-120,000 ms at construction even though config already validates them. Do not import or execute noble Argon in the primary runtime and do not change worker parameters. Expose a non-queuing batch lease: acquire succeeds only when a healthy idle worker is available, the lease serializes derive messages, and release happens in `finally`. Correlate only opaque bounded request IDs, allow one in-flight message per worker, validate every response exactly, and apply the configured timeout to self-tests and derive messages.

    Model each slot explicitly as initializing/idle/leased/quarantined/replacing/closed. A timeout, exit, or invalid response rejects the current derive/batch as `KDF_FAILED`, moves the slot to quarantined, terminates it, and starts one tracked replacement promise. That promise spawns once, runs the exact self-test once, and either moves the slot to idle or leaves it quarantined permanently; it never schedules retries. Lease selection ignores quarantined/replacing slots, so no healthy idle slot means immediate `KDF_BUSY`. Closing atomically sets the pool closed before inspecting slots, rejects new work, prevents a queued replacement start, awaits or terminates any already-started replacement, and checks the closed flag before any replacement/release can re-admit capacity. Consume all replacement rejections internally as generic state transitions so none becomes an unhandled rejection. Never retain or log worker inputs/outputs after resolution.

    Add `service.test.ts` around injected decoder/pool boundaries. Test same-account overlap, different-account global exhaustion, release after every decoder/worker failure, wrong-key/passwordless no-derive, sequential maximum in-flight count of one, exact multi-slot order, exact first fixture/vector key, repeat-request re-derivation, revision-without-decode, and clearing transient password slots. Implement `service.ts` so `derive(authenticatedAccountId, storedBlob, cloudKey, channelId)` marks the account active and acquires a global worker lease before cloud scrypt/decode, derives every validated password sequentially, emits only `{version,settingsRevision,keys:[{slot,key}]}`, and clears transient password references in `finally`. `revision(storedBlob)` hashes only the opaque blob. Account IDs may exist only transiently in the active-admission set; no password/key/revision cache or persistence API is available to this service.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/goofcord-cloudserver && bun test test/kdf/worker.test.ts test/kdf/pool.test.ts test/kdf/service.test.ts && bun run typecheck</automated>
  </verify>
  <done>Every active batch occupies one bounded, self-tested dedicated worker; admission is immediate and bounded per account/globally, all password slots derive sequentially in exact order, unhealthy workers are safely replaced, failures reveal no inputs, and nothing is cached or persisted.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire authenticated HTTPS routes, abuse controls, and readiness lifecycle</name>
  <files>../goofcord-cloudserver/src/config.ts, ../goofcord-cloudserver/src/contracts.ts, ../goofcord-cloudserver/src/auth/authenticationService.ts, ../goofcord-cloudserver/src/security/index.ts, ../goofcord-cloudserver/src/routes/routeSecurity.ts, ../goofcord-cloudserver/src/routes/v2.ts, ../goofcord-cloudserver/src/runtime/application.ts, ../goofcord-cloudserver/src/runtime/lifecycle.ts, ../goofcord-cloudserver/src/runtime/server.ts, ../goofcord-cloudserver/src/index.ts, ../goofcord-cloudserver/.env.example, ../goofcord-cloudserver/docker-compose.yml, ../goofcord-cloudserver/README.md, ../goofcord-cloudserver/test/auth/authenticationService.test.ts, ../goofcord-cloudserver/test/config.test.ts, ../goofcord-cloudserver/test/security/security.test.ts, ../goofcord-cloudserver/test/runtime/application.test.ts, ../goofcord-cloudserver/test/runtime/server.test.ts, ../goofcord-cloudserver/test/integration/v1.test.ts, ../goofcord-cloudserver/test/integration/applicationSecurity.test.ts, ../goofcord-cloudserver/test/integration/v2.test.ts</files>
  <behavior>
    - `POST /v2/kdf/derive` accepts exactly the Stage 1 body and no account/query selector, authenticates the existing raw session token, calls only `settings.load(authenticatedSession.userId)`, and never accepts bearer token alone as sufficient because cloudEncryptionKey remains required and bounded.
    - `GET /v2/kdf/revision` applies the same HTTPS/auth/IP/session protection, loads only the authenticated account's blob, and returns exact opaque SHA-256 revision without cloud-key input, decrypt, password parsing, worker lease, or database write.
    - Missing/invalid JSON, forbidden extras/userId, key/channel/4096-byte-body bounds, unauthenticated token, missing settings, passwordless blob, wrong key/corruption, rate/concurrency exhaustion, and worker failure return exactly the frozen versioned code/status pair with no input or internal detail. Successful derive/revision responses also have exact keys and no extras.
    - KDF routes require trustworthy HTTPS; insecure external/direct requests return frozen `{version:1,error:{code:'INVALID_REQUEST'}}`/400 whether `ENFORCE_HTTPS` is true or false. Only direct loopback plus explicit `KDF_ALLOW_INSECURE_LOCALHOST=true` can bypass; spoofed forwarding headers and untrusted proxies cannot. Non-KDF/v1 HTTPS responses remain byte-compatible.
    - Derive admission order is exactly KDF-aware HTTPS -> shared KDF IP 12 requests/60s -> 4096-byte content-length/stream bound -> read-only auth -> token-hash derive 4 requests/60s -> JSON parse. Revision uses HTTPS -> the same shared IP 12/60s -> read-only auth -> a separate token-hash revision 12/60s limiter and has no body. Limit exhaustion returns versioned `KDF_BUSY` plus bounded `Retry-After`; raw Authorization is never a limiter key or diagnostic value.
    - Startup order is config -> Mongo/indexes -> initialize/self-test every KDF worker -> build/listen -> ready. Vector mismatch/worker failure never calls `serve` and health remains unready; shutdown marks unready, stops accepting, closes workers, then disconnects Mongo, idempotently.
    - Existing v1 tests and response shapes remain unchanged. Behavioral secret-audit tests observe no token/account/channel/cloud key/password/blob/returned-key markers in console output, error bodies, health, or diagnostics, and spies prove derive/revision make no settings/auth persistence writes.
  </behavior>
  <action>
    Extend configuration with `KDF_GLOBAL_CONCURRENCY` default 1 and accepted range 1-4, `KDF_JOB_TIMEOUT_MS` default 30000 and accepted range 5000-120000, and explicit `KDF_ALLOW_INSECURE_LOCALHOST` default false. Freeze `MAX_KDF_REQUEST_BODY_BYTES=4096`, the shared KDF IP limiter at 12 requests per 60000 ms, the derive token-hash limiter at 4 per 60000 ms, and the revision token-hash limiter at 12 per 60000 ms as non-client-controlled server constants; do not expose rate/window or body overrides. Document/forward the three environment options in `.env.example`, Compose, and README. Add a README operational table containing every exact Stage 2 resource value: 4096-byte body, 1-4/default-1 workers, 5000-120000/default-30000 ms worker timeout, 12/60000 ms shared IP, 4/60000 ms derive token, 12/60000 ms revision token, scrypt `maxmem=268435456`, and async Brotli `maxOutputLength=262144`; explain roughly 64 MiB Argon memory plus runtime overhead per active worker. Also document HTTPS/trusted-proxy deployment, the localhost exception, no-secret observability, quarantined one-attempt replacement semantics, and readiness self-test. Add exact default/override/lower/upper/out-of-range config tests.

    Refactor authentication with a named `authenticateReadOnly(rawAuthorization)` method that reuses the existing token hash lookup and returns the same `AuthenticatedSession` without updating `lastUsedAt`; keep `authenticate()` and all v1 behavior unchanged. Test that read-only success/invalid-token paths never call `updateOne`. Extend dependency contracts and all permissive test security objects without weakening existing v1 types.

    Make the existing application-level `enforceHttps` middleware KDF-path-aware because it executes before mounted routers: identify only `context.req.path === '/v2/kdf'` or paths beginning `/v2/kdf/` (not lookalike prefixes), and reject an insecure non-exempt KDF request with the exact versioned `INVALID_REQUEST`/400 body regardless of `ENFORCE_HTTPS`; allow only a directly resolved loopback peer when `KDF_ALLOW_INSECURE_LOCALHOST=true`. For every other path retain the current `ENFORCE_HTTPS`, local-development behavior, status, and legacy body exactly. This application middleware is the first KDF admission gate, so no route-local middleware can be pre-empted by a legacy HTTPS response.

    Add KDF-specific shared IP, hard 4096-byte body, derive-session, and revision-session middleware. In the v2 router register the derive sequence only after application HTTPS resolution as IP 12/60s -> content-length/stream body bound -> auth -> token-hash derive 4/60s -> handler JSON parse; do not read or clone any body before HTTPS and IP admission. Revision uses IP 12/60s -> auth -> token-hash revision 12/60s. Body failure returns versioned `INVALID_REQUEST`; all three limiter failures return versioned `KDF_BUSY`/429 and bounded `Retry-After`. Raw Authorization is never a limiter key. Preserve proxy resolution so only a configured direct proxy can assert one forwarded HTTPS value. Keep current v1/general middleware responses unchanged and add focused security/full-application tests under both `ENFORCE_HTTPS=true` and false for exact KDF bodies, chunked/content-length oversize requests, no body consumption on insecure/IP-limited requests, spoofed forwarding headers, trusted HTTPS, direct loopback flag allow/deny, exact rate thresholds/reset/shared-IP behavior/key-space exhaustion, and non-reflective bodies.

    Replace the placeholder v2 singleton with `createV2Router(dependencies)`. Its private auth middleware reads Authorization, calls only `authenticateReadOnly`, stores the returned session, and responds with exact `UNAUTHORIZED` on failure. For both endpoints reject query selectors. Application-level KDF-aware HTTPS runs first; register derive handlers in the exact remaining Hono order IP limiter -> 4096-byte body limiter -> auth -> derive token-hash limiter -> handler, then parse via `readJsonBody` and `parseDeriveRequest`, load only `settings.load(context.get('authenticatedSession').userId)`, map null to `CLOUD_SETTINGS_MISSING`, and call the KDF service. Revision registers IP limiter -> auth -> revision token-hash limiter, loads the same way, and calls only the revision helper. Centralize response mapping through the frozen `KDF_ERROR_STATUS`; catch unexpected auth/settings/service failures as code-only `KDF_FAILED`, and never serialize a caught message or input. Do not add logging.

    Inject the KDF service through `createApplication` and production startup. Extend `startRuntime` with explicit `initializeKdf`/`shutdownKdf` dependencies, await initialization after Mongo/index setup but before application creation and `serve`, and mark ready only after signal handlers install. On any initialization/listen/handler failure, keep readiness false, stop any server, close all workers, and disconnect Mongo. Graceful shutdown must mark unready, stop accepting, close workers, then disconnect Mongo and remain idempotent. Construct the configured pool/service in `src/index.ts`; retain only generic startup failure logging.

    Build `test/integration/v2.test.ts` around the dependency-built full app. Include two accounts/tokens with different stored blobs to prove exclusive authenticated binding; attempts to supply `userId` in body/query must fail and never alter the load key. Cover `ENFORCE_HTTPS=true` and false with external insecure requests returning the identical frozen KDF `INVALID_REQUEST` body, trusted forwarded HTTPS, spoofed forwarding rejection, and explicit direct-loopback flag behavior while asserting an existing v1 insecure response is unchanged. Assert the logical middleware order `HTTPS, IP, body, auth, token, JSON` and prove insecure/IP-limited requests do not consume the body or call auth.

    Cover exact 4096/4097 content-length and chunked body edges, channel/cloud-key edges, absent/invalid auth, missing settings, all decoder/service errors and exact bodies/statuses, the 12th/13th shared IP requests, 4th/5th derive token requests, 12th/13th revision token requests, reset windows, concurrency busy, multi-slot stable order, the exact Stage 1 vector key through at least one real decoder+worker request, revision equality/no decrypt, and no cache across repeated calls. Make settings save/delete and auth-touch writes throw/count so success proves read-only behavior. Surround success and forced failure with console/diagnostic spies using unique secret markers, assert error/health bodies never contain them or a returned key, and assert no KDF code emits those values. Re-run unchanged v1/application security suites to catch regressions.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/goofcord-cloudserver && bun run typecheck && bun test && docker compose config >/dev/null && git diff --check</automated>
  </verify>
  <done>Both KDF endpoints are exact-contract, HTTPS, read-only, authenticated to the middleware-owned account, independently cloud-key gated, and abuse bounded; startup cannot listen/turn ready without worker vector success; shutdown cleans workers; stable errors and secret-safety tests pass without changing v1.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| untrusted HTTP -> KDF route | Bodies, headers, query strings, sizes, rates, transport claims, and account selectors are attacker-controlled |
| session token -> account settings | Only verified token state may select the stored blob; the request must never choose an account |
| cloud key -> opaque stored blob | Wrong keys/corrupt blobs must fail authentication before JSON/password/Argon work |
| compressed JSON -> password slots | Brotli expansion, UTF-8, JSON shape, slot count, and exact byte lengths are hostile until bounded/validated |
| primary runtime -> dedicated workers | 64 MiB Argon jobs must be capacity-limited, off-loop, sequential per batch, timed out, and self-tested |
| transient secrets -> response/telemetry/persistence | Cloud keys, passwords, channel IDs, tokens, blobs, and derived keys must not escape their required success boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-RKDF-S2-01 | Spoofing | account lookup | critical | mitigate | read-only auth middleware owns `authenticatedSession.userId`; exact schema/query rejection; cross-account integration test |
| T-RKDF-S2-02 | Information disclosure | bearer-token compromise | critical | mitigate | mandatory separately supplied cloud key; AES-GCM auth; no token-only derive path |
| T-RKDF-S2-03 | Tampering | cloud blob/returned keys | critical | mitigate | strict canonical layout, exact crypto parameters, authenticated decrypt, Stage 1 fixtures/vector/contracts, exact response schema |
| T-RKDF-S2-04 | Denial of service | memory/CPU | critical | mitigate | 4096-byte body, async 256 KiB Brotli cap, 1-4 workers, one batch/account, global immediate admission, sequential slots, 5-120s worker timeout, fixed 12/4/12-per-minute IP/derive/revision rates |
| T-RKDF-S2-05 | Information disclosure | logs/errors/health | high | mitigate | code-only errors, no request logging, no per-secret labels, no health detail, behavioral marker audit |
| T-RKDF-S2-06 | Information disclosure | persistence/cache | high | mitigate | read-only auth/settings calls, no key/password cache or write API, repeated-derive/write-spy tests, best-effort zeroization |
| T-RKDF-S2-07 | Spoofing | HTTPS/proxy state | high | mitigate | KDF-specific HTTPS gate, trusted direct-proxy policy, explicit direct-loopback-only development exception, spoof tests |
| T-RKDF-S2-08 | Denial of service | faulty worker/readiness | high | mitigate | self-test every worker before listen/ready, fail-closed startup, unhealthy termination/replacement, graceful close tests |
</threat_model>

<verification>
Run after all three tasks:

```bash
cd /mnt/e/backup/code/personal/oss/goofcord-cloudserver
bun install --frozen-lockfile
bun run typecheck
bun test
docker compose config >/dev/null
git diff --check

cd ../kettu-goofcrypt
cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json
npm test
npm run build
git diff --check

test -z "$(git -C ../stegcloak-rs/GoofCord status --short)"
```

Audit the server diff for any direct KDF import on the primary loop, synchronous/unbounded Brotli call, mutation of fixed Argon/cloud/scrypt parameters, account selector, secret-bearing log/metric/error, settings/session write in v2, key/password cache, or unbounded queue/decompression. Confirm Bun 1.3.13 honors async Brotli `maxOutputLength=262144` with timer progress, scrypt uses `maxmem=268435456`, and config/docs/tests agree on body 4096, workers 1-4/default 1, timeout 5000-120000/default 30000, shared IP 12/60s, derive token 4/60s, and revision token 12/60s. Confirm application HTTPS returns frozen KDF `INVALID_REQUEST` under both `ENFORCE_HTTPS` states before IP/body/auth while v1 remains unchanged. Confirm the real pool test spawns `src/kdf/worker.ts`, every startup worker receives `self-test`, `serve` is uncalled on injected vector mismatch, slot derivations never overlap within a batch, a failed replacement is tried exactly once and remains quarantined, shutdown wins its replacement race, and response/error objects pass the Stage 1 strict parsers.
</verification>

<success_criteria>
- Current GoofCord encrypted/passwordless blobs are classified in strict base64 -> bounded async Brotli-only detection -> encrypted authenticate/decompress order, with exact scrypt maxmem, hard byte/expansion/password bounds, event-loop progress, and no Argon call on failure.
- `/v2/kdf/derive` and `/v2/kdf/revision` use only read-only authenticated account identity, require secure transport, preserve exact Stage 1 wire contracts, and return every stable code/status without reflective detail.
- All active Argon work runs in the exact Stage 1 worker under a 1-4/default-1 pre-self-tested pool; per-account/global admission, sequential slots, 5-120s/default-30s timeout, one-attempt quarantined replacement, shutdown races, and fixed 12/4/12-per-minute rate limits prevent unbounded CPU/memory work.
- Startup stays unready and never listens on any vector/worker failure; shutdown stops traffic, closes workers, and disconnects Mongo idempotently.
- No plaintext password, cloud key, channel ID, token/account identity, blob, or returned key enters logs/errors/health/traces/persistence/cache; repeated requests derive again and v1 remains green.
- Full server checks, deployment config validation, mobile compatibility checks, and the clean GoofCord reference-tree gate pass.
</success_criteria>

<output>
Create `.planning/quick/260718-qlx-stage-2-implement-authenticated-remote-k/260718-qlx-SUMMARY.md` after execution.
</output>
