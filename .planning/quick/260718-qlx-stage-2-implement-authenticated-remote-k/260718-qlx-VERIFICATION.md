---
quick_id: 260718-qlx
status: passed
verified: 2026-07-18
human_needed: false
gaps_found: 0
requirements_verified: [REMOTE-KDF-STAGE-2]
commits:
  goofcord-cloudserver: 0af697eedaa3ae6797071ff60b991c3fa685ea64
---

# Quick Task 260718-qlx Verification

## Verdict

Stage 2 passes. Commit `0af697eedaa3ae6797071ff60b991c3fa685ea64`
implements the authenticated remote-KDF server boundary with strict GoofCord
cloud decoding, bounded dedicated workers, fail-closed readiness, stable
version-1 contracts, layered admission controls, and secret-safe read-only
operation. All ten must-have truths, all eight required artifacts, and all
eight key links are present in the committed server state.

No human-only check is required for this server implementation stage. The real
decoder/worker path, full application boundary, lifecycle failures, and mobile
compatibility contract are exercised automatically.

## Commit and scope audit

- Server HEAD is exactly `0af697eedaa3ae6797071ff60b991c3fa685ea64`
  (`feat(kdf): implement authenticated remote derivation (260718-qlx)`).
- The server worktree is clean. The commit changes only the planned server
  runtime/configuration/tests/documentation surfaces.
- `src/kdf/worker.ts` is byte-identical to its Stage 1 parent version
  (`7fd9c627e88f04ef2a22cdfd29981bd7e96f669d545b95d6132ff1a24d960a1d`),
  and `@noble/hashes` remains exact-pinned at `1.8.0` in both `package.json`
  and `bun.lock`.
- Mobile runtime source was not changed. The only pre-existing mobile changes
  remain user-owned `CLAUDE.md`, untracked `AGENTS.md`, and planning artifacts.
- The nested GoofCord checkout is clean. The outer reference repository retains
  only its pre-existing untracked `GoofCord/` and `relevant-images/` entries.

## Must-have truth audit

| # | Result | Evidence |
|---|---|---|
| 1 | Pass | `src/routes/v2.ts:40-54` authenticates through `authenticateReadOnly` and stores `authenticatedSession`; both handlers use only `session.userId` for `settings.load` (`:69-78`, `:93-97`). The derive schema requires exact keys, so body `userId`/selectors fail `INVALID_REQUEST`; both routes reject every query (`:63`, `:92`). Full-app tests prove cross-account binding and no writes. |
| 2 | Pass | Derive requires a non-empty cloud key bounded to 1,024 UTF-8 bytes in `src/kdf/contracts.ts:116-130`, loads only the authenticated blob, then calls `decodeCloudBlob`. `src/kdf/cloudBlob.ts:154-185` performs in-memory GoofCord decoding; passwordless Brotli/JSON objects are detection-only and return `PASSWORDS_NOT_SYNCED` (`:87-96`, `:161-163`). |
| 3 | Pass | `cloudBlob.ts:20-34` freezes scrypt `N=32768,r=8,p=3,dkLen=32,maxmem=268435456`, canonical base64, 32/12/16 layout, fatal UTF-8, and asynchronous Brotli. Bounds are 1 MiB outer, 256 KiB decompressed, 1-8 slots, and 256 UTF-8 bytes/password (`contracts.ts:3-9`). AES-GCM `final()` authenticates before Brotli/JSON (`cloudBlob.ts:110-128`, `:165-170`). Tests cover exact options, malformed/tampered/wrong-key inputs, password list bounds, async timer progress, and `maxOutputLength`. |
| 4 | Pass | `src/kdf/pool.ts:11-14` and `:199-219` enforce 1-4 workers and 5-120 second timeouts; production defaults are 1 and 30 seconds (`src/config.ts:142-144`). Every initial and replacement worker runs `selfTest()` (`pool.ts:269-299`) and production uses `new Worker(new URL('./worker.ts', import.meta.url))` (`:215-217`). `startRuntime` awaits KDF initialization before application creation/listen and marks ready only afterward (`src/runtime/server.ts:45-64`); initialization failure closes KDF/Mongo and never listens. |
| 5 | Pass | `src/kdf/service.ts:27,38-79` enforces one active batch/account, acquires one global pool lease with immediate `KDF_BUSY`, decodes before the first worker derive, and awaits each slot sequentially in source order. Pool capacity is the configured global bound and has no request queue. The unchanged Stage 1 worker retains Argon2id v19, `m=65536,t=3,p=1,dkLen=32`. |
| 6 | Pass | `src/kdf/contracts.ts:11-31,55-74` freezes code-only version-1 errors and exact mappings: invalid 400, unauthorized 401, missing 404, passwordless 409, cloud decrypt 422, busy 429, failed 500. `src/routes/v2.ts:27-31` centralizes mapping. Integration tests assert every body/status pair; rate/body/global failures use the same frozen bodies. |
| 7 | Pass | `settingsRevision` is SHA-256 of the exact stored blob UTF-8 bytes with unpadded base64url output (`cloudBlob.ts:150-152`) and revision never decrypts (`service.ts:82-86`, route `:93-97`). Derive returns only `{version,settingsRevision,keys:[{slot,key}]}` (`service.ts:52-63`); strict schemas exclude passwords, hashes, `passwordId`, identity, and adjustable parameters. |
| 8 | Pass | V2 calls only read-only auth and `settings.load`; no save/delete/session touch exists. The service has only transient `activeAccounts`, performs no password/key/revision response caching, and clears the decoded password array (`service.ts:75-79`). Decoder/worker/pool clear mutable buffers best-effort. Source scans found no KDF request logging, tracing, diagnostics, secret labels, persistence call, `passwordId`, or secret-bearing cache; marker-spy tests prove secrets/channel/key are absent from logs and error bodies. |
| 9 | Pass | Admission is application HTTPS, route IP 12/60s, derive body 4,096 bytes, read-only auth, token-hash 4/60s, then JSON (`routes/v2.ts:56-83`, `security/index.ts:22-24,182-215`). Revision is IP, auth, separate token-hash 12/60s. `isKdfPath` matches only `/v2/kdf` and `/v2/kdf/…`; KDF HTTPS applies independently of `ENFORCE_HTTPS`, with only explicit direct-loopback opt-in (`security/index.ts:100-115,290-292`). Full v1 and application suites remain green. |
| 10 | Pass | Any worker derive failure returns `KDF_FAILED`, quarantines the slot, terminates it, and starts exactly one self-tested replacement (`pool.ts:243-252,281-307`). Replacement failure leaves the slot quarantined with no retry; no healthy slot returns immediate `KDF_BUSY` (`:235-238`). `closeAll` marks closing first, terminates clients, awaits replacement promises, and closes any raced replacement (`:310-324`). Focused tests prove timeout replacement, failed replacement/no retry, and shutdown-race behavior. |

## Stable error mapping audit

| HTTP | Code | Verified source and behavior |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Exact-schema/query/body/HTTPS/canonical-base64 failures |
| 401 | `UNAUTHORIZED` | Missing or invalid existing session token |
| 404 | `CLOUD_SETTINGS_MISSING` | Authenticated account has no stored blob |
| 409 | `PASSWORDS_NOT_SYNCED` | Passwordless object or absent/empty password list |
| 422 | `CLOUD_DECRYPT_FAILED` | Canonical corrupt/short blob, wrong key, auth/decompress/UTF-8/JSON/list failure |
| 429 | `KDF_BUSY` | IP/token-rate exhaustion, same-account overlap, or no global worker lease |
| 500 | `KDF_FAILED` | Worker/internal failure and uncaught exact-KDF-path exceptions |

Every response has only `{version:1,error:{code}}`; no caught exception message
or request material is serialized.

## Artifact audit

| Artifact | Result | Evidence |
|---|---|---|
| `src/kdf/cloudBlob.ts` | Pass | Exists; contains exact `N: 32768`, strict decoder, bounded async Brotli, revision hash |
| `src/kdf/pool.ts` | Pass | Exists; contains `self-test`, fixed pool/lease/timeout/quarantine/replacement lifecycle |
| `src/kdf/service.ts` | Pass | Exists; contains `KDF_BUSY`, per-account admission, decode-before-derive, sequential slots |
| `src/routes/v2.ts` | Pass | Exists; contains `/kdf/derive` and `/kdf/revision`, read-only auth and stable mapping |
| `src/security/index.ts` | Pass | Exists; contains `MAX_KDF_REQUEST_BODY_BYTES`, fixed rate controls, KDF HTTPS/error handling |
| `src/config.ts` | Pass | Contains `KDF_JOB_TIMEOUT_MS` with default/range validation and worker/local-HTTP settings |
| `src/runtime/server.ts` | Pass | Contains/awaits `initializeKdf` before serve/readiness and closes KDF on failure |
| `test/integration/v2.test.ts` | Pass | Contains `CLOUD_DECRYPT_FAILED` and end-to-end identity/error/ordering/HTTPS/secrecy/vector coverage |

## Key-link audit

| From -> To | Result | Evidence |
|---|---|---|
| V2 routes -> authentication service | Pass | `authenticateReadOnly` sets `authenticatedSession`; auth service shares the token-hash lookup without `lastUsedAt` update (`authenticationService.ts:46-86`) |
| V2 routes -> settings service | Pass | Both handlers call only `settings.load(authenticatedSession.userId)`; request data cannot supply the lookup key |
| KDF service -> cloud decoder | Pass | Default decoder is `decodeCloudBlob`; service awaits it before any `lease.derive`, so wrong-key/corrupt inputs cause zero Argon calls |
| Worker pool -> Stage 1 worker | Pass | Production `new Worker(...'./worker.ts')`; every instance receives an exact-vector self-test before becoming idle |
| Runtime server -> readiness | Pass | Mongo/indexes -> KDF initialize -> application/serve -> signal handlers -> `markReady`; failures remain unready and clean up |
| Runtime application -> V2 router | Pass | `createApplication` injects auth/settings/security/KDF into `createV2Router` (`runtime/application.ts:55-60`) |
| Runtime application -> global security | Pass | resolve-client -> path-aware HTTPS -> headers -> path-aware `onError` all run before mounted routes (`runtime/application.ts:33-38`) |
| Production index -> worker pool | Pass | Validated `kdfGlobalConcurrency` and `kdfJobTimeoutMs` are passed directly into `createKdfWorkerPool` (`src/index.ts:24-34`) |

## Locked architecture and security audit

- **GoofCord/reference is read-only:** no nested GoofCord tracked change; no
  GoofCord API, source, or dependency modification was required.
- **Message protocol/KDF is unchanged:** the Stage 1 worker is byte-identical,
  noble stays exact-pinned, the shared vector is byte-identical, and the mobile
  stegcloak-rs compatibility harness remains green.
- **Authenticated account owns lookup:** no client account selector is accepted;
  only the read-only session's `userId` reaches settings load.
- **Cloud key is an independent required factor:** token-only requests fail the
  exact request contract; wrong keys fail AES-GCM before JSON/password/Argon.
- **Keys only:** the server never returns/persists plaintext passwords. Mobile
  storage/session/cache work is Stage 3 and was correctly left unchanged.
- **No server message endpoint:** the new API derives channel keys only; Discord
  plaintext/ciphertext and message crypto remain local.
- **Existing transport only:** the implementation uses HTTPS plus existing cloud
  sessions; it adds no HPKE, tickets, pairing, or confidential-compute design.
- **Bounded concurrency:** Stage 2 adds the required one-batch/account and fixed
  global worker limits. The locked one-pending-request-per-channel client rule
  belongs to Stage 4 and is neither implemented early nor contradicted here.
- **No sidecar reopening:** no WebView/WASM sidecar work was introduced.
- **Secret boundary:** cloud key, decrypted settings, passwords, channel ID, and
  keys exist only transiently for the required request. There are no intentional
  writes/caches/telemetry; managed-runtime erasure is accurately best-effort.

## Abuse control, readiness, and shutdown audit

- HTTPS rejection precedes route IP/body/auth work and uses the frozen KDF body
  under both legacy HTTPS settings. Only a direct loopback peer plus explicit
  `KDF_ALLOW_INSECURE_LOCALHOST=true` is exempt; trusted proxy rules remain the
  authority for forwarded HTTPS.
- Shared-IP and token-hash limiters use fixed 12/4/12-per-minute thresholds,
  bounded key space, immediate `KDF_BUSY`, and bounded `Retry-After`. Raw bearer
  tokens are never limiter keys.
- The 4,096-byte derive body is enforced by both declared length and streamed
  bytes before authentication/JSON parsing. Cloud blob, expansion, password,
  worker-count, timeout, and concurrent-memory bounds are all fixed server-side.
- Worker initialization is a startup gate, not a health detail: any vector or
  worker failure prevents `serve` and readiness and closes initialized state.
- Graceful shutdown is idempotent and ordered unready -> stop accepting -> close
  KDF/replacements -> disconnect Mongo. Cleanup continues even when listener
  stop fails.

## Plan-checker carry-forward

**Passed.** The application-level error fallback is path-aware at
`src/security/index.ts:127-143,290-292`. Uncaught body/security/pre-handler or
runtime exceptions on exact `/v2/kdf` paths return HTTP 500 with exactly
`{version:1,error:{code:"KDF_FAILED"}}` plus base no-store security headers.
Non-KDF/v1 errors retain their legacy mappings. The full dependency-built
application test at `test/integration/v2.test.ts:233-288` forces a pre-handler
exception containing secret text and proves the exact non-reflective KDF body.

## Re-run evidence

Server, from the committed clean worktree:

- `bun install --frozen-lockfile`: passed with no changes.
- `bun run typecheck`: passed.
- `bun test`: **82 passed, 0 failed**, 424 assertions across 16 files.
- Real end-to-end decoder + dedicated worker vector request: passed.
- `docker compose config`: passed.
- `docker build --check .`: passed with no warnings.
- `git diff --check`: passed.

Compatibility/reference gates:

- Mobile/server `argon2id-v1.json` `cmp`: passed.
- Mobile `npm test`: **64 passed, 0 failed**, including stegcloak-rs interop and
  strict remote-KDF version-1 contract checks.
- Mobile `npm run build`: passed; output is class-free.
- Mobile `npm exec tsc -- --noEmit`: passed.
- Nested GoofCord checkout clean: passed.

## Gaps

None for `REMOTE-KDF-STAGE-2`. Mobile session/cache integration, per-channel
pending deduplication, cold-path UX, cooldowns, and real-device behavior remain
the explicitly planned later stages and are not Stage 2 gaps.
