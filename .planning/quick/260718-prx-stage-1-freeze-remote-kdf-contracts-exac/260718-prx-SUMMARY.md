---
quick_id: 260718-prx
status: complete
completed: 2026-07-18
description: Stage 1 - freeze remote KDF contracts, exact Argon2 vector, and synthetic GoofCord cloud fixtures
commits:
  kettu-goofcrypt: 9386693e8185f8643503f111eed0153c669a535e
  goofcord-cloudserver: a7d21eec46de1b386f3d8d2e0f570c65ffce46b8
---

# Quick Task 260718-prx Summary

## Outcome

Completed Stage 1 of `docs/REMOTE_KDF_ARCHITECTURE.md` across both writable
repositories. Mobile and server tests now share byte-identical committed
Argon2id fixtures for the existing GoofCord-compatible vector. The server also
has deterministic public GoofCord cloud-blob fixtures covering encrypted,
wrong-key, passwordless, and malformed inputs.

Both sides freeze the version-1 derive, revision, success, and stable-error
contracts. The server rejects account selectors and KDF parameter overrides;
the mobile boundary rejects noncanonical or non-32-byte keys, invalid revisions,
out-of-order slots, response extras, and unknown error codes.

The selected server engine is exact-pinned `@noble/hashes` 1.8.0 running
synchronous Argon2id inside a dedicated Bun Worker. A real Worker test proves
the exact 32-byte vector while the primary event loop continues ticking. The
worker exposes the self-test command Stage 2 must invoke before readiness and
returns generic non-reflective failures for invalid messages.

## Security and compatibility invariants

- Argon2id remains v19 with `m=65536`, `t=3`, `p=1`, and 32 output bytes.
- Password and channel inputs remain exact UTF-8 with no normalization/trimming.
- Request schemas contain no `userId`, account selector, or caller-controlled
  crypto parameters.
- Returned keys require canonical padded base64 and exactly 32 decoded bytes.
- Fixtures contain only visibly labelled public synthetic data.
- The worker does not log, persist, or cache password/key material and clears
  mutable byte arrays on a best-effort basis.
- GoofCord and stegcloak-rs were read-only and remain unchanged.
- No cloud route, database/auth wiring, mobile cache/UX, or cold-message path was
  added; those remain staged work.

## Verification

- `cmp` confirmed the mobile/server Argon vector JSON files are byte-identical.
- Mobile `npm test`: 64 passed, 0 failed, including the unchanged real
  stegcloak-rs WASM compatibility paths and new strict-contract checks.
- Mobile `npm run build`: passed; output remained Hermes-evaluable and class-free.
- Mobile `npm exec tsc -- --noEmit`: passed. A test-only Node module declaration
  file and removal of incidental harness `Buffer`/`process` use preserve the
  runtime source's no-Node-types guard.
- Server `bun install --frozen-lockfile`: passed with no lockfile changes.
- Server `bun run typecheck`: passed.
- Server `bun test`: 43 passed, 0 failed, including fixture reference decoding,
  schema boundaries, exact worker output, event-loop progress, and generic errors.
- `git diff --check` and new-file trailing-whitespace checks passed in both repos.
- `git -C ../stegcloak-rs/GoofCord status --short` remained empty.

## Commits

- `kettu-goofcrypt`: `9386693e8185f8643503f111eed0153c669a535e`
  (`Add remote KDF Stage 1 contracts (260718-prx)`)
- `goofcord-cloudserver`: `a7d21eec46de1b386f3d8d2e0f570c65ffce46b8`
  (`Add remote KDF Stage 1 contracts and worker (260718-prx)`)

## Changed files

Mobile:

- `src/cloud/contracts.ts`
- `tests/fixtures/remoteKdf/argon2id-v1.json`
- `tests/harness.ts`
- `tests/nodeShims.d.ts`

Server:

- `package.json`
- `bun.lock`
- `docs/REMOTE_KDF_WORKER_DECISION.md`
- `src/kdf/contracts.ts`
- `src/kdf/worker.ts`
- `test/fixtures/remoteKdf/argon2id-v1.json`
- `test/fixtures/remoteKdf/cloud-blobs-v1.json`
- `test/kdf/contracts.test.ts`
- `test/kdf/fixtures.test.ts`
- `test/kdf/worker.test.ts`
