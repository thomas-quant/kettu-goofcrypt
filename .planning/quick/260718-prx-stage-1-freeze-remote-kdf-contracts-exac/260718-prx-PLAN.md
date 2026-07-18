---
quick_id: 260718-prx
phase: quick
plan: 260718-prx
type: execute
wave: 1
depends_on: []
status: planned
description: Stage 1 - freeze remote KDF contracts, exact Argon2 vector, and synthetic GoofCord cloud fixtures
autonomous: true
requirements: [REMOTE-KDF-STAGE-1]
files_modified:
  - tests/fixtures/remoteKdf/argon2id-v1.json
  - tests/harness.ts
  - src/cloud/contracts.ts
  - ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json
  - ../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json
  - ../goofcord-cloudserver/test/kdf/fixtures.test.ts
  - ../goofcord-cloudserver/src/kdf/contracts.ts
  - ../goofcord-cloudserver/test/kdf/contracts.test.ts
  - ../goofcord-cloudserver/package.json
  - ../goofcord-cloudserver/bun.lock
  - ../goofcord-cloudserver/src/kdf/worker.ts
  - ../goofcord-cloudserver/test/kdf/worker.test.ts
  - ../goofcord-cloudserver/docs/REMOTE_KDF_WORKER_DECISION.md
must_haves:
  truths:
    - "Mobile and server tests consume byte-identical committed Argon2id v1 fixtures for password 'goofcryptspikevector', exact UTF-8 channel salt '1234567890123456789', m=65536 KiB, t=3, p=1, v=0x13, dkLen=32, and expected key WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ="
    - "The mobile compatibility harness still proves the fixed vector through the GoofCord/stegcloak-rs path, while an actual server Bun Worker independently returns the same raw 32 bytes without blocking the primary event loop"
    - "Committed synthetic GoofCord fixtures cover encrypted settings with an ordered password list, the same blob with a wrong key, a passwordless Brotli/base64 blob, and malformed input; all values are visibly synthetic and contain no user secrets"
    - "Both repositories freeze the same v1 derive/revision/success/error wire shapes; the server rejects unknown/account-selector fields and invalid request bounds, and mobile rejects noncanonical or non-32-byte returned keys before later cache code can consume them"
    - "The selected worker engine is an exact-pinned @noble/hashes 1.8.0 synchronous Argon2id inside a dedicated Bun Worker; Bun.password is recorded as incompatible because it does not accept the exact caller-provided salt or return raw 32-byte output"
    - "No GoofCord source, GoofCord dependency, message pipeline, cloud route, database path, or mobile cache/UX is changed in Stage 1"
  artifacts:
    - path: "tests/fixtures/remoteKdf/argon2id-v1.json"
      provides: "Mobile copy of the canonical exact Argon2id vector"
      contains: "WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ="
    - path: "../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json"
      provides: "Byte-identical server copy of the canonical exact Argon2id vector"
      contains: "1234567890123456789"
    - path: "../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json"
      provides: "Synthetic current-format encrypted, wrong-key, passwordless, and malformed GoofCord cloud cases"
      contains: "PASSWORDS_NOT_SYNCED"
    - path: "src/cloud/contracts.ts"
      provides: "Hermes-safe v1 request builder plus strict success/revision/error response validators"
      contains: "CLOUD_DECRYPT_FAILED"
    - path: "../goofcord-cloudserver/src/kdf/contracts.ts"
      provides: "Strict server-side v1 request/response/error schemas and fixed public bounds"
      contains: "INVALID_REQUEST"
    - path: "../goofcord-cloudserver/src/kdf/worker.ts"
      provides: "Dedicated Bun Worker entry with fixed Argon2id parameters and a vector self-test command"
      contains: "65536"
    - path: "../goofcord-cloudserver/docs/REMOTE_KDF_WORKER_DECISION.md"
      provides: "Stage 1 engine decision, rejected alternatives, isolation rule, and Stage 2 readiness handoff"
      contains: "Bun Worker"
  key_links:
    - from: "tests/harness.ts"
      to: "tests/fixtures/remoteKdf/argon2id-v1.json"
      via: "the D-09 assertion reads the committed fixture instead of retaining an inline expected array"
      pattern: "argon2id-v1"
    - from: "src/cloud/contracts.ts"
      to: "src/util/base64.ts"
      via: "strict regex/length checks followed by decode and re-encode equality before accepting any 32-byte key"
      pattern: "fromBase64|toBase64"
    - from: "../goofcord-cloudserver/test/kdf/fixtures.test.ts"
      to: "../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json"
      via: "independent node:crypto/node:zlib decoding against the exact GoofCord scrypt/AES-GCM/Brotli layout"
      pattern: "cloud-blobs-v1"
    - from: "../goofcord-cloudserver/test/kdf/worker.test.ts"
      to: "../goofcord-cloudserver/src/kdf/worker.ts"
      via: "spawn a real Worker, run its self-test and derive command, and compare the result with the server vector fixture"
      pattern: "new Worker"
---

<objective>
Freeze Stage 1 of `docs/REMOTE_KDF_ARCHITECTURE.md` across the mobile and server repositories: one exact cross-repository Argon2id vector, non-secret GoofCord cloud-blob fixtures, strict versioned API schemas on both sides, and a tested server worker-engine decision.

Purpose: Later server/mobile stages must build against byte-exact, security-preserving contracts rather than independently inventing parameters, error shapes, fixture interpretations, or key validation. The actual worker proof makes engine selection subordinate to exact vector equality and event-loop isolation.

Output: Shared vector fixtures and tests, synthetic cloud fixtures and reference tests, `src/cloud/contracts.ts`, server KDF contracts, and a minimal exact-vector Bun Worker proof plus its decision record. No endpoint or cold-path integration is part of this quick task.
</objective>

<execution_context>
@$HOME/.codex/gsd-core/workflows/execute-plan.md
@$HOME/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/STATE.md
@docs/REMOTE_KDF_ARCHITECTURE.md
@src/crypto/argon.ts
@src/util/base64.ts
@tests/harness.ts
@../goofcord-cloudserver/package.json
@../goofcord-cloudserver/src/contracts.ts
@../goofcord-cloudserver/src/routes/v2.ts
@../goofcord-cloudserver/src/runtime/server.ts
@../goofcord-cloudserver/test/integration/v1.test.ts
@../stegcloak-rs/src/encrypt.rs
@../stegcloak-rs/GoofCord/src/windows/settings/cloud/encryption.ts
@../stegcloak-rs/GoofCord/src/windows/settings/cloud/cloud.ts
</context>

<constraints>
- Treat all ten locked decisions and Stage 1 in `docs/REMOTE_KDF_ARCHITECTURE.md` as canonical. Do not change Argon2 parameters, normalize/trim password or channel bytes, expose `passwordId`, accept `userId`, make the cloud key optional, or add message encryption/decryption to the server.
- Do not modify `../stegcloak-rs/GoofCord`, `../stegcloak-rs`, or any GoofCord dependency. Those trees are read-only references.
- Preserve the user's existing mobile worktree changes (`CLAUDE.md` and `AGENTS.md`) and any unrelated changes found during execution. The server worktree was clean at planning time.
- Stage 1 freezes contracts and proves an isolated worker only. Do not add `/v2/kdf/derive`, database lookup, authentication wiring, worker pooling/concurrency policy, mobile session/cache/UI, or message cold-path changes; those belong to Stages 2-4.
- The mobile runtime remains Hermes-safe: no `Buffer`, `TextEncoder`, `class` syntax, WASM, or noncanonical tolerant base64 acceptance in `src/cloud/contracts.ts`.
- Fixture credentials and passwords must be unmistakably synthetic, fixed, documented as public test data, and never copied from a real settings blob. The encrypted fixture must still follow GoofCord exactly: strict base64 of `[32-byte salt][12-byte IV][16-byte tag][ciphertext]`, scrypt `N=32768,r=8,p=3,dkLen=32`, AES-256-GCM, then Brotli-compressed JSON.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Commit the exact cross-repository vector and synthetic GoofCord blob fixtures</name>
  <files>tests/fixtures/remoteKdf/argon2id-v1.json, tests/harness.ts, ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json, ../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json, ../goofcord-cloudserver/test/kdf/fixtures.test.ts</files>
  <behavior>
    - Both `argon2id-v1.json` files are byte-for-byte identical and record algorithm/version/memory/passes/parallelism/output length, exact unnormalized UTF-8 password/channel inputs, expected lowercase hex `58d45319392fae3bbe13098083598211e9b7e84d38d210b014a56444e2cde804`, and canonical base64 `WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ=`.
    - The mobile harness derives the fixture's expected 32 bytes and retains its existing real stegcloak-rs cross-compat round trip; a fixture typo therefore cannot replace the GoofCord compatibility gate.
    - The encrypted cloud fixture authenticates/decrypts with its synthetic public key, Brotli-decompresses to JSON, and yields the exact ordered `encryptionPasswords`, including a UTF-8/whitespace value that proves no normalization or trimming.
    - The wrong-key case fails AES-GCM authentication; the passwordless fixture is strict base64/Brotli JSON without `encryptionPasswords`; the malformed case fails strict base64/layout validation. Each case declares the Stage 2 error it is intended to drive (`CLOUD_DECRYPT_FAILED`, `PASSWORDS_NOT_SYNCED`, or `INVALID_REQUEST`).
  </behavior>
  <action>
    First add the two byte-identical canonical Argon2 fixture files. Replace only the inline VEC_PW/CHANNEL/EXPECTED value source in `tests/harness.ts` with loading this JSON; keep `deriveKey`, exact byte equality, and the stegcloak-rs WASM cross-round-trip intact. Do not modify `src/crypto/argon.ts` or its parameters.

    Add `cloud-blobs-v1.json` under the server test fixtures. Generate its encrypted case locally from fixed public test inputs using the exact GoofCord reference sequence and fixed synthetic salt/IV so the committed bytes are deterministic. Include: (1) a correctly encrypted object whose ordered password list begins with the Argon vector password and contains a second visibly synthetic Unicode/whitespace password; (2) a wrong-key case referencing the same opaque blob but supplying a different synthetic key; (3) the current GoofCord passwordless format, which is Brotli-compressed/base64 JSON with sensitive `encryptionPasswords` absent; and (4) malformed noncanonical/short input. Store expected disposition and ordered passwords, never real data.

    Write `fixtures.test.ts` as an independent reference-fixture test using `node:crypto` and `node:zlib`, not future production decoder code: enforce canonical base64, split 32/12/16/rest, call scrypt with `N=32768,r=8,p=3,dkLen=32` and GoofCord-compatible `maxmem`, authenticate via AES-256-GCM, Brotli-decompress, parse, and assert exact password order/bytes. Assert wrong-key authentication fails before any Argon operation, passwordless decodes only through the Brotli-only path and has no passwords, and malformed is rejected. This test freezes fixtures; Stage 2 will TDD its production decoder against them.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt && cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json && npm test && cd ../goofcord-cloudserver && bun test test/kdf/fixtures.test.ts && bun run typecheck</automated>
  </verify>
  <done>The same exact vector is committed and exercised in both repositories; the mobile GoofCord compatibility assertion remains green; all four synthetic cloud cases are static, non-secret, reference-validated fixtures ready for Stage 2.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Freeze strict v1 derive/revision/error schemas on mobile and server</name>
  <files>src/cloud/contracts.ts, tests/harness.ts, ../goofcord-cloudserver/src/kdf/contracts.ts, ../goofcord-cloudserver/test/kdf/contracts.test.ts</files>
  <behavior>
    - A derive request has exactly `{version:1, channelId, cloudEncryptionKey}`; `channelId` is an ASCII-decimal string of 1-20 characters and is never converted to Number, while the cloud key is non-empty and at most 1024 UTF-8 bytes. Unknown fields, especially `userId` or account selectors, are rejected by the server schema.
    - A successful derive response has exactly version 1, a 43-character unpadded base64url SHA-256 settings revision, and 1-8 ordered entries whose `slot` equals the zero-based array position and whose key is canonical padded base64 decoding to exactly 32 bytes.
    - A revision response has exactly `{version:1,settingsRevision}`. An error response has exactly `{version:1,error:{code}}`, where code is one of `INVALID_REQUEST`, `UNAUTHORIZED`, `CLOUD_SETTINGS_MISSING`, `PASSWORDS_NOT_SYNCED`, `CLOUD_DECRYPT_FAILED`, `KDF_BUSY`, or `KDF_FAILED`; server code also fixes the architecture's 400/401/404/409/422/429/500 status mapping.
    - Mobile rejects tolerant-base64 edge cases, wrong lengths, duplicate/out-of-order/noncontiguous slots, empty/oversized key arrays, padded/invalid revisions, unknown error codes, and response/request extras before any value can reach future cache code.
    - Server exports the decoder limits Stage 2 must use: 8 passwords maximum, 256 UTF-8 bytes per password, 1 MiB stored blob outer bound, and 256 KiB decompressed settings bound.
  </behavior>
  <action>
    Create matching but runtime-appropriate contract modules. In `../goofcord-cloudserver/src/kdf/contracts.ts`, export v1 request/response/revision/error types, the stable HTTP error-code mapping, named bound constants, and strict unknown-input parsers/guards. The derive request parser must check the exact own-key set so a client-supplied `userId`, extra selector, parameter override, or unknown field is invalid; Argon and cloud-format parameters are never request properties.

    In `src/cloud/contracts.ts`, export the same public wire types/error-code union, a request builder/validator, and strict unknown-response parsers. Use the existing Hermes-safe UTF-8/base64 utilities. Because `fromBase64` is intentionally tolerant, first enforce the canonical padded 44-character alphabet/shape, then decode exactly 32 bytes and require `toBase64(decoded) === input`. Validate revision with the exact unpadded 43-character base64url form. Return validated data or a non-secret typed contract failure; never include request values in error text. Use named exports, plain functions/interfaces, index loops, and no `class`.

    Add boundary/negative tables in the server test and the existing mobile harness: minimum/maximum channel and cloud-key sizes, Unicode byte length (not JS character count), forbidden extras/account selectors, all seven error codes/statuses, exact response, all malformed key/revision/slot cases, and a successful multiple-slot response preserving order. Keep host/auth/token/session behavior out of this contract task.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt && npm test && npm run build && ! grep -Eq '\b(Buffer|TextEncoder|class)\b' src/cloud/contracts.ts && cd ../goofcord-cloudserver && bun test test/kdf/contracts.test.ts && bun run typecheck</automated>
  </verify>
  <done>Both repositories enforce the same strict v1 wire contract and limits; server requests cannot choose an account or KDF parameters, and mobile cannot accept a noncanonical/wrong-size key, malformed revision, or reordered slot list.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Prove and record the isolated server Argon2 worker engine</name>
  <files>../goofcord-cloudserver/package.json, ../goofcord-cloudserver/bun.lock, ../goofcord-cloudserver/src/kdf/worker.ts, ../goofcord-cloudserver/test/kdf/worker.test.ts, ../goofcord-cloudserver/docs/REMOTE_KDF_WORKER_DECISION.md</files>
  <behavior>
    - A real dedicated Bun Worker derives the shared vector as raw 32 bytes/canonical base64 using only fixed Argon2id v19 parameters `m=65536,t=3,p=1,dkLen=32` and exact UTF-8 password/channel bytes.
    - While that 64 MiB synchronous derivation is running in the Worker, a timer on the test's primary event loop fires before the worker result arrives, proving the selected engine does not execute synchronously on the HTTP event loop.
    - The worker exposes a startup self-test command whose success requires full equality with the embedded committed vector; mismatch/error reports only a generic non-secret failure. Stage 2 can invoke this command before marking readiness.
    - Worker messages and caught errors never log or echo passwords, channel IDs, cloud keys, or derived keys beyond the explicitly requested successful derive result. No server-side key/password cache is introduced.
  </behavior>
  <action>
    Add exact dependency `@noble/hashes: "1.8.0"` to the server with `bun add --exact @noble/hashes@1.8.0`, committing the matching `bun.lock`. Do not use a caret and do not add a native addon/build toolchain. Implement `src/kdf/worker.ts` solely as a dedicated Worker entry: fixed constants matching the architecture, `@noble/hashes/argon2` sync derivation inside the worker, strict plain message validation, exact UTF-8 bytes, one job at a time, a derive response containing only raw/canonical key output plus an opaque request ID, and a self-test command comparing all 32 bytes to the committed vector. Best-effort overwrite mutable password/channel/key byte buffers in `finally`; document that managed-runtime erasure is not guaranteed. Do not import this synchronous module into routes or the primary server runtime.

    Write `worker.test.ts` to spawn a real `new Worker(new URL(...))`, run the self-test, send the shared fixture derive request, compare all output bytes/base64, verify a primary-loop interval fires before completion, verify malformed worker messages receive a generic failure without reflected input, and terminate the worker in `finally`. A test-only direct call to Argon on the primary thread is not acceptable evidence.

    Create `docs/REMOTE_KDF_WORKER_DECISION.md` recording: selected engine = dedicated Bun Worker + exact-pinned noble 1.8.0; why it wins (already proven byte-equal, arbitrary-length exact salt, raw output, no native build dependency, isolated blocking/memory); Bun's built-in `Bun.password` is rejected because it generates its own salt and returns PHC text; native addons/subprocesses remain unnecessary unless future evidence beats this engine while passing the same fixture. State Stage 2 obligations: a small bounded worker pool/global cap, one batch per account, sequential slots, worker restart/timeout handling, and startup must call self-test before readiness. Do not wire readiness or routes in this stage.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/goofcord-cloudserver && bun install --frozen-lockfile && bun test test/kdf/worker.test.ts && bun run typecheck && bun test && cd ../kettu-goofcrypt && npm test && npm run build</automated>
  </verify>
  <done>The chosen server engine is documented and proven by an actual off-main-loop Bun Worker to reproduce the shared 32-byte vector; its self-test is ready for Stage 2 startup gating, and all mobile/server suites remain green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| fixture/reference code -> production decoder | Incorrect fixtures would bless an incompatible cloud format or wrong error classification |
| untrusted mobile JSON -> server schema | Request extras could select another account, override KDF parameters, or amplify resource use |
| untrusted server JSON -> mobile cache boundary | Noncanonical, wrong-length, reordered, or oversized keys must never become persistent key material |
| primary HTTP loop -> KDF worker | A synchronous 64 MiB Argon job on the primary loop would deny service despite returning correct bytes |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-RKDF-S1-01 | Tampering | exact Argon vector | critical | mitigate | byte-identical committed copies, mobile stegcloak-rs cross-check, server worker equality, and `cmp` gate |
| T-RKDF-S1-02 | Elevation of privilege | derive request account binding | critical | mitigate | exact request keys; reject `userId` and all unknown selectors/parameter overrides before Stage 2 auth lookup |
| T-RKDF-S1-03 | Tampering | mobile returned keys | critical | mitigate | canonical base64 round-trip, exact 32-byte length, bounded contiguous ordered slots |
| T-RKDF-S1-04 | Information disclosure | fixtures and worker errors | high | mitigate | public synthetic-only fixture values; generic non-reflective worker failures; no logging/caching |
| T-RKDF-S1-05 | Denial of service | primary event loop | high | mitigate | actual Worker-only Argon implementation plus timer-progress regression test; pool caps deferred explicitly to Stage 2 |
</threat_model>

<verification>
Run from the mobile repository after all three tasks:

```bash
cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json
npm test
npm run build
npm exec tsc -- --noEmit
git diff --check

cd ../goofcord-cloudserver
bun install --frozen-lockfile
bun run typecheck
bun test
git diff --check

test -z "$(git -C ../stegcloak-rs/GoofCord status --short)"
```

Audit both diffs to confirm no `/v2` route, database, auth, mobile cache/UX/cold-path, message protocol, GoofCord, or unrelated user-owned files changed. Confirm the worker test spawned `Worker` and did not merely call a derive function on the primary thread.
</verification>

<success_criteria>
- The exact vector fixture is identical across repositories and independently passes mobile GoofCord/stegcloak-rs compatibility plus the server worker proof.
- Synthetic encrypted/wrong-key/passwordless/malformed cloud fixtures are committed, reference-validated, deterministic, and contain only public test data.
- Mobile/server v1 schemas agree on exact wire shapes, bounds, stable codes/statuses, ordered slots, and canonical 32-byte keys; forbidden account/KDF selectors are rejected.
- The selected server engine stays off the primary event loop, passes the fixed vector, and exposes the self-test Stage 2 must gate readiness on.
- Full mobile and server checks pass, and GoofCord remains untouched.
</success_criteria>

<output>
Create `.planning/quick/260718-prx-stage-1-freeze-remote-kdf-contracts-exac/260718-prx-SUMMARY.md` after execution.
</output>
