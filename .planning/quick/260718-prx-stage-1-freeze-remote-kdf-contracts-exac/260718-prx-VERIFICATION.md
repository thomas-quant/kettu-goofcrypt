---
quick_id: 260718-prx
status: passed
verified: 2026-07-18
human_needed: false
commits:
  kettu-goofcrypt: 9386693e8185f8643503f111eed0153c669a535e
  goofcord-cloudserver: a7d21eec46de1b386f3d8d2e0f570c65ffce46b8
---

# Quick Task 260718-prx Verification

## Verdict

Stage 1 passes. The current committed state proves the shared exact Argon2id
vector, synthetic GoofCord cloud fixtures, strict version-1 schemas in both
repositories, and a dedicated Bun Worker engine that reproduces the vector
without blocking the primary event loop. No human-only verification is needed
for this contract/vector/worker-proof stage.

## Requirement coverage

### REMOTE-KDF-STAGE-1.1 — exact vector shared by mobile and server

**Passed.** The two committed `argon2id-v1.json` files compare byte-for-byte
equal and have the same SHA-256:

`876747b46785581b09421896abc801733ad4848dcfebcdcbd0cf780c2fe87ac2`

They freeze:

- password `goofcryptspikevector`;
- channel/salt `1234567890123456789`;
- Argon2id v19, `m=65536`, `t=3`, `p=1`, `dkLen=32`;
- exact UTF-8/no-normalization encodings;
- key hex `58d45319392fae3bbe13098083598211e9b7e84d38d210b014a56444e2cde804`;
- canonical base64 `WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ=`.

`tests/harness.ts` reads that fixture, derives through the existing mobile
`deriveKey`, compares all bytes/encodings, and retains the real stegcloak-rs
WASM cross-round-trip. `test/kdf/worker.test.ts` reads the server copy and
requires the worker's raw/canonical output to equal it.

### REMOTE-KDF-STAGE-1.2 — synthetic GoofCord cloud fixtures

**Passed.** `cloud-blobs-v1.json` is labelled public synthetic test data and
contains:

- deterministic encrypted settings with two ordered passwords, including exact
  Unicode and leading/trailing whitespace;
- the same ciphertext with a deliberately wrong cloud key;
- a Brotli/base64 passwordless settings object with no `encryptionPasswords`;
- noncanonical-base64 and undersized-layout malformed cases.

The focused server fixture suite independently uses `node:crypto` and
`node:zlib` to enforce strict/canonical base64, the 32/12/16/ciphertext split,
scrypt `N=32768,r=8,p=3,dkLen=32`, AES-256-GCM authentication, Brotli, JSON, and
exact password order. It also proves wrong-key authentication failure,
passwordless absence, and malformed rejection.

### REMOTE-KDF-STAGE-1.3 — request/response/error schemas in both repositories

**Passed.** `src/cloud/contracts.ts` and server `src/kdf/contracts.ts` agree on:

- exact derive request `{version,channelId,cloudEncryptionKey}`;
- ASCII-decimal channel IDs of 1-20 characters without numeric conversion;
- non-empty cloud key bounded at 1,024 UTF-8 bytes;
- exact revision response and 43-character unpadded base64url revision;
- 1-8 contiguous ordered slots;
- canonical padded base64 keys that decode to exactly 32 bytes;
- exact versioned error shape and all seven architecture status/code pairs.

Server tests reject `userId`, unknown selectors, KDF parameter overrides,
invalid versions/bounds, invalid keys, slots, revisions, response extras, and
unknown error codes. Mobile harness checks the equivalent untrusted-response
boundary and performs decode/re-encode equality through the Hermes-safe base64
utility. Server decoder bounds are frozen at 8 passwords, 256 UTF-8 bytes per
password, 1 MiB stored blob, and 256 KiB decompressed settings.

### REMOTE-KDF-STAGE-1.4 — worker engine decision and exact-vector proof

**Passed.** The server dependency and lockfile exact-pin `@noble/hashes` 1.8.0.
`src/kdf/worker.ts` is a dedicated Worker entry containing only the locked
Argon2id parameters. The focused test creates a real `new Worker(...)`, warms it
with the startup self-test, runs the 64 MiB derivation, asserts the primary-loop
interval advanced before completion, and compares the returned key to both
base64 and hex fixture values.

The worker validates exact message shapes, returns only key output for a valid
derive request, uses a generic non-reflective failure for malformed input, has
no logging/caching path, and best-effort clears mutable input/key arrays.
`REMOTE_KDF_WORKER_DECISION.md` records the selected Bun Worker/noble design,
rejects `Bun.password` because it supplies neither caller-chosen exact salt nor
raw key output, and lists Stage 2 readiness/pool/concurrency obligations.

## Must-have truth audit

| # | Truth | Result | Evidence |
|---|---|---|---|
| 1 | Byte-identical exact Argon vector in both repos | Pass | `cmp`, identical SHA-256, fixture metadata/key assertions |
| 2 | Mobile GoofCord path and independent off-loop server worker match | Pass | mobile harness section 9; worker self-test/derive/timer test |
| 3 | Encrypted, wrong-key, passwordless, malformed synthetic fixtures | Pass | fixture JSON plus four reference tests |
| 4 | Matching strict v1 contracts and mobile 32-byte rejection | Pass | both contract modules; server boundary suite; mobile harness section 11 |
| 5 | Exact noble 1.8.0 Bun Worker and incompatible Bun.password recorded | Pass | `package.json`, `bun.lock`, worker source, decision document |
| 6 | No later-stage or GoofCord changes | Pass | commit file lists and clean nested GoofCord checkout |

## Artifact audit

| Artifact | Result | Evidence |
|---|---|---|
| `tests/fixtures/remoteKdf/argon2id-v1.json` | Pass | exists and contains the expected canonical key |
| Server `test/fixtures/remoteKdf/argon2id-v1.json` | Pass | exists, contains channel ID, and is byte-identical |
| Server `test/fixtures/remoteKdf/cloud-blobs-v1.json` | Pass | contains all cases and `PASSWORDS_NOT_SYNCED` |
| `src/cloud/contracts.ts` | Pass | strict builders/parsers and `CLOUD_DECRYPT_FAILED` present |
| Server `src/kdf/contracts.ts` | Pass | schemas/bounds and `INVALID_REQUEST` present |
| Server `src/kdf/worker.ts` | Pass | dedicated entry, fixed `65536`, vector self-test present |
| Server `docs/REMOTE_KDF_WORKER_DECISION.md` | Pass | Bun Worker decision and Stage 2 handoff present |

## Key-link audit

| From → To | Result | Evidence |
|---|---|---|
| `tests/harness.ts` → mobile Argon fixture | Pass | `readFileSync("tests/fixtures/remoteKdf/argon2id-v1.json")`; `ARGON_VECTOR` drives derive/equality checks |
| `src/cloud/contracts.ts` → `src/util/base64.ts` | Pass | imports `fromBase64`/`toBase64`; regex, 32-byte length, and re-encode equality gate acceptance |
| Server fixture test → cloud fixture | Pass | reads `cloud-blobs-v1.json`; independent scrypt/AES-GCM/Brotli decoding |
| Server worker test → worker + vector fixture | Pass | reads `argon2id-v1.json`, spawns `new Worker`, runs self-test/derive/timer assertions |

## Locked architecture and scope audit

- **GoofCord/stegcloak-rs read-only:** the nested GoofCord checkout is clean and
  no commit in either writable repository can touch it. The outer reference
  repository has no tracked diff.
- **Message protocol/KDF unchanged:** the mobile commit does not touch
  `src/crypto`, `src/core`, `src/stego`, message send/receive code, dependencies,
  or the build pipeline. Existing stegcloak-rs compatibility remains green.
- **Authenticated account binding preserved:** Stage 1 adds no route or lookup;
  the frozen request schema rejects `userId` and all extra selectors.
- **Cloud key required:** both request validators reject an empty key and test
  byte-length bounds without trimming or normalization.
- **No plaintext password response/persistence:** public responses contain only
  ordered keys/revision; the worker neither caches nor logs values. No mobile
  storage/cache code changed.
- **KDF-only server boundary:** no message plaintext/ciphertext API or server
  encryption/decryption path was introduced.
- **No transport redesign:** no HPKE, ticket, pairing, auth, or HTTPS route work
  was introduced in this stage.
- **Later concurrency/cold-path work deferred:** no route, worker pool, database,
  mobile session/cache/UX, Flux/send, or per-channel pending operation changed;
  the decision document explicitly hands those obligations to later stages.
- **No WebView/WASM sidecar:** no sidecar or WASM work was added.
- **Hermes constraints preserved:** mobile contract source contains no runtime
  `Buffer`, `TextEncoder`, or `class`; the built plugin remains class-free.

The additional mobile `tests/nodeShims.d.ts` is test-only and makes the existing
Node-based harness type-check without enabling Node globals in runtime `src/`.

## Re-run evidence

- `npm test`: **64 passed, 0 failed**.
- `npm run build`: **passed**, class-free output.
- `npm exec tsc -- --noEmit`: **passed**.
- `bun install --frozen-lockfile`: **passed**, no changes.
- `bun test test/kdf`: **9 passed, 0 failed**, 64 assertions.
- `bun run typecheck`: **passed**.
- Mobile/server vector `cmp`: **passed**.
- Exact server dependency version check: **1.8.0**.
- Nested GoofCord status: **clean**.

## Gaps

None for Stage 1. Startup readiness wiring, authenticated settings lookup,
bounded worker pooling, mobile session/cache behavior, cold-path deduplication,
and device UX are explicitly later-stage requirements and were correctly not
implemented by this quick task.
