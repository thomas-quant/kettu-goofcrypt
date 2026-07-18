---
quick_id: 260718-qlx
status: complete
completed: 2026-07-18
description: Stage 2 - authenticated remote KDF cloud decode, bounded workers, readiness gating, routes, and abuse controls
requirements_completed: [REMOTE-KDF-STAGE-2]
commits:
  goofcord-cloudserver: 0af697eedaa3ae6797071ff60b991c3fa685ea64
---

# Quick Task 260718-qlx Summary

## Outcome

Completed Stage 2 of `docs/REMOTE_KDF_ARCHITECTURE.md` in
`goofcord-cloudserver`. The server now exposes authenticated
`POST /v2/kdf/derive` and `GET /v2/kdf/revision` endpoints. Both select the
stored settings blob exclusively from read-only authenticated session identity;
client account selectors are rejected and the required cloud key remains an
independent factor.

The production decoder strictly handles current GoofCord encrypted blobs using
canonical base64, async scrypt `N=32768,r=8,p=3,dkLen=32,maxmem=268435456`,
AES-256-GCM, and asynchronous bounded Brotli. Passwordless Brotli-only objects
are detected but can never supply passwords. Ordered message passwords are
validated without normalization and dispatched sequentially to the exact Stage
1 Bun Worker.

A fixed 1-4 worker pool self-tests every instance before listen/readiness,
admits one active batch per account with no unbounded queue, returns immediate
`KDF_BUSY` at global capacity, times out jobs, and quarantines failed workers.
Each unhealthy slot receives exactly one self-tested replacement attempt;
failed replacements remain unavailable, and shutdown wins replacement races.

## Security and compatibility invariants

- GoofCord/stegcloak-rs Argon2id remains byte-exact: v19, `m=65536`, `t=3`,
  `p=1`, exact password/channel UTF-8 bytes, and 32 output bytes.
- Blob decoding is bounded at 1 MiB outer storage, 256 KiB Brotli output, eight
  password slots, and 256 UTF-8 bytes per password.
- Derive bodies are bounded at 4,096 bytes before authentication/JSON work.
- KDF admission order is HTTPS, shared IP limit 12/60s, body bound, read-only
  authentication, derive token-hash limit 4/60s, then JSON parsing. Revision
  uses the shared IP limit and a separate token-hash 12/60s limit.
- KDF HTTPS enforcement applies under either legacy `ENFORCE_HTTPS` value;
  insecure direct loopback requires explicit development opt-in.
- Exact `/v2/kdf` uncaught errors are globally converted to versioned
  `KDF_FAILED`/500; v1 and other legacy errors remain unchanged.
- The derive/revision paths call only settings load and read-only token lookup.
  They make no settings/session/key writes and add no password/key cache.
- Responses contain only version, opaque blob revision, and ordered slot/key
  entries. Passwords, password hashes, `passwordId`, account IDs, and crypto
  parameters are never returned.
- No request/body/header/channel/key/password logging, tracing, diagnostics, or
  secret-bearing errors were added. Mutable secret/key buffers are cleared on a
  best-effort basis.
- Existing v1 routes, schemas, token-touch semantics, OAuth, settings writes,
  and response bodies remain green and unchanged.

## Verification

- Server `bun install --frozen-lockfile`: passed with no dependency/lock changes.
- Server `bun run typecheck`: passed.
- Server `bun test`: **82 passed, 0 failed**, 424 assertions.
- Focused tests prove exact fixture decoding, wrong-key/no-Argon behavior,
  passwordless classification, async Brotli timer progress and output cap,
  canonical 32-byte worker results, sequential slots, per-account/global busy,
  worker timeout/replacement/shutdown races, and no server key cache.
- Full-application tests prove account binding, read-only auth/settings access,
  stable error/status mappings, exact HTTPS/IP/body/auth/token/JSON ordering,
  both HTTPS configuration modes, forced pre-handler `KDF_FAILED`, rate limits,
  non-reflective errors/logs, revision-without-decrypt, and a real
  decoder-plus-worker exact-vector response.
- Runtime tests prove KDF initialization precedes listen/readiness, vector
  failure prevents `serve`, and shutdown orders server -> KDF -> Mongo while
  continuing cleanup after a listener-stop failure.
- `docker compose config` and `docker build --check .`: passed.
- Server `git diff --check`: passed; committed server worktree is clean.
- Mobile/server Argon fixture `cmp`: passed.
- Mobile `npm test`: **64 passed, 0 failed**; existing stegcloak-rs compatibility
  remains green.
- Mobile `npm run build` and `npm exec tsc -- --noEmit`: passed.
- The nested GoofCord checkout remained clean. Mobile source, GoofCord, and
  stegcloak-rs were not modified.

## Commit

- `goofcord-cloudserver`: `0af697eedaa3ae6797071ff60b991c3fa685ea64`
  (`feat(kdf): implement authenticated remote derivation (260718-qlx)`)

No mobile commit was created. This summary, the plan, and project state remain
uncommitted as required.

## Changed files

Server runtime and configuration:

- `.env.example`
- `README.md`
- `docker-compose.yml`
- `src/auth/authenticationService.ts`
- `src/config.ts`
- `src/contracts.ts`
- `src/index.ts`
- `src/kdf/cloudBlob.ts`
- `src/kdf/contracts.ts`
- `src/kdf/pool.ts`
- `src/kdf/service.ts`
- `src/routes/routeSecurity.ts`
- `src/routes/v2.ts`
- `src/runtime/application.ts`
- `src/runtime/lifecycle.ts`
- `src/runtime/server.ts`
- `src/security/index.ts`

Server tests:

- `test/auth/authenticationService.test.ts`
- `test/config.test.ts`
- `test/integration/applicationSecurity.test.ts`
- `test/integration/v1.test.ts`
- `test/integration/v2.test.ts`
- `test/kdf/cloudBlob.test.ts`
- `test/kdf/contracts.test.ts`
- `test/kdf/pool.test.ts`
- `test/kdf/service.test.ts`
- `test/runtime/application.test.ts`
- `test/runtime/server.test.ts`
- `test/security/security.test.ts`

## Deviations and resolved issues

- Carried the final plan-checker requirement into execution: application-level
  `onError` is exact-KDF-path-aware, and a full-application forced pre-handler
  exception test proves the frozen `KDF_FAILED` response without altering v1.
- Bun/TypeScript's `Buffer` iterator declarations conflicted with the pinned
  compiler's newer `Uint8Array` declarations. Production crypto boundaries use
  explicit `Uint8Array` copies, preserving behavior and enabling best-effort
  clearing; all runtime tests and type-checking pass.
- Graceful shutdown was hardened to attempt KDF and Mongo cleanup even if
  stopping the listener fails. The first failure is still propagated after all
  cleanup steps run.

## Next-stage readiness

Stage 3 can build the Kettu cloud session holder and ordered revision-aware
channel-key cache against the frozen version-1 derive/revision contracts. There
are no Stage 2 blockers or human-only verification requirements.
