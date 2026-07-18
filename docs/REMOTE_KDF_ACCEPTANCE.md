# Remote KDF Stage 5 acceptance ledger

This is the evidence index for `docs/REMOTE_KDF_ARCHITECTURE.md`. It does not
replace or rewrite the architecture's canonical checkboxes. Automated evidence
and physical-device release evidence are intentionally separate.

Current verdict: **AUTOMATED_PASS / DEVICE_PENDING**. The automated Stage 5
scope is green. Device release acceptance is not complete, and this document
does not authorize a weaker transport fallback.

## Status vocabulary

| Status | Meaning |
|---|---|
| `PASS_AUTOMATED` | The cited direct test or static gate passed in the rerun below. |
| `PENDING_DEVICE` | Real Android and iOS Kettu/Hermes evidence has not been recorded. |
| `FAIL` | The cited requirement or gate failed. |

Node, Bun, source inspection, and a class-free bundle can produce only
`PASS_AUTOMATED`. They cannot produce device evidence.

## Tested revisions and commands

Automated evidence was rerun on 2026-07-18 in the sibling workspace layout
`kettu-goofcrypt/` beside `goofcord-cloudserver/` and `stegcloak-rs/`.

- Mobile verified Stage 4 base: `fd7278443ecbb70295695371c924041e4dccf0b0`.
  The Stage 5 delta is limited to `package.json`,
  `tests/remoteKdfStage5.test.mjs`, and this ledger; the containing commit is
  the authoritative Stage 5 tree identity in Git history.
- Server input: `0af697eedaa3ae6797071ff60b991c3fa685ea64`, clean.
- GoofCord reference input: `16c551c5a6fbdde137e7f13b4dca01883e3a691d`,
  clean.

| Gate | Command | Result |
|---|---|---|
| `G-BRIDGE` | `npm run test:remote-kdf-stage5` | 1 passed, 0 failed, 8 assertions; real default decoder, self-tested Worker pool, authenticated full app, strict mobile client, and mobile message pipeline. |
| `G-MOBILE` | `npm test` | 163 passed, 0 failed, including the unchanged real stegcloak-rs WASM compatibility harness. |
| `G-BUILD` | `npm run build && npm exec tsc -- --noEmit` | Passed; bundle hash `0e4e946fbcf03aca`, 291,085 bytes, class-free. |
| `G-SERVER` | `cd ../goofcord-cloudserver && bun run typecheck && bun test` | 82 passed, 0 failed, 424 assertions across 16 files. |
| `G-FIXTURE` | `cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json` | Passed byte-for-byte. |
| `G-SCOPE` | Protected-path diff plus exact-clean server/reference commit gates from the Stage 5 plan | Passed; production source, existing fixtures/tests, lockfiles, server, and GoofCord reference are unchanged. |

The bridge is intentionally not part of standalone `npm test`: it requires the
sibling server checkout and Bun. `npm run test:remote-kdf-stage5` is the
documented cross-workspace command; both repositories retain their existing
standalone commands unchanged.

## Architecture acceptance criteria

Rows `AC-01` through `AC-16` preserve the order of the architecture checklist.
Prior verification reports provide context, but the status below is based on
the named direct evidence and fresh gates, not on those reports alone.

| ID | Architecture criterion | Direct evidence | Gate | Status |
|---|---|---|---|---|
| `AC-01` | No GoofCord source or dependency changes are required. | Exact clean GoofCord reference commit, exact clean server commit, protected mobile-source/fixture/lockfile diff, and a Stage 5 package diff containing only the additive command. | `G-SCOPE` | `PASS_AUTOMATED` |
| `AC-02` | The existing byte-compatibility harness remains green. | `tests/harness.ts`: both ours-to-theirs and theirs-to-ours real stegcloak-rs cases, parity checks, and `VEC_PW path is GoofCord byte-compatible`. | `G-MOBILE`, `G-FIXTURE` | `PASS_AUTOMATED` |
| `AC-03` | Server startup refuses KDF readiness on an exact-vector mismatch. | Server `test/kdf/pool.test.ts`: `fails startup generically and terminates every worker when any self-test fails`; `test/runtime/server.test.ts`: `refuses to listen and closes KDF state when startup self-test fails`. | `G-SERVER` | `PASS_AUTOMATED` |
| `AC-04` | Remote KDF cannot run with only a stolen or valid cloud bearer token. | Server `test/integration/v2.test.ts`: `returns exact stable bodies for request, auth, settings, and service failures` includes token-only `INVALID_REQUEST`; mobile `tests/harness.ts`: empty cloud key rejection. | `G-SERVER`, `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-05` | The worker derives from the authenticated user's stored blob and supplied cloud key without persisting plaintext settings, passwords, or keys. | `tests/remoteKdfStage5.test.mjs` authenticates one raw token, loads that account's committed blob once, records zero writes, and uses the default decoder/service/Worker. Server `test/kdf/service.test.ts`: sequential slots and password clearing; no server result cache. | `G-BRIDGE`, `G-SERVER` | `PASS_AUTOMATED` |
| `AC-06` | Kettu does not receive or persist plaintext message passwords in remote mode. | The full bridge's exact v1 response crosses the strict client as revision plus keys only. `tests/remoteKdfStage3.ts` cache migration/restart cases store only ordered keys/revisions; `src/core/remoteKeycache.ts` is independent of the password cache. | `G-BRIDGE`, `G-MOBILE`, `G-SCOPE` | `PASS_AUTOMATED` |
| `AC-07` | Kettu does not persist the cloud encryption key by default. | `tests/remoteKdfStage3.ts`: `status and persistence redact the memory-only cloud key and response details`, configuration-generation clearing, and `shutdown aborts, clears session readiness, and ignores late derive completion`. | `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-08` | Every returned key is canonical-base64 validated and exactly 32 bytes before persistent cache storage. | `tests/harness.ts`: malformed key/slot response rejection; `tests/remoteKdfStage3.ts`: `31-byte and 33-byte remote keys are rejected before write and read`; server contract test independently enforces the same rule. | `G-MOBILE`, `G-SERVER` | `PASS_AUTOMATED` |
| `AC-09` | Multiple rapid messages in one cold channel cause one server request. | `tests/remoteKdfStage4.ts`: exact Promise sharing, `simultaneous incoming and outgoing preparation share one derive request`, and `twenty rapid sends plus incoming work share one preparation and derive`. | `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-10` | Malformed ZWC content cannot trigger Argon work. | `tests/remoteKdfStage4.ts`: structural rejection for plain/lone/short/wrong-version data and `remote structural rejection creates no waiter`; remote mode/manual mode counters prove source separation. | `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-11` | Multiple password slots are returned and tried in stable order. | The real bridge returns exactly `[0,1]`, matches slot zero to the committed vector, encrypts with distinct slot one, and decrypts with both returned keys in order. Server service and mobile hot-decrypt order tests independently enforce both sides. | `G-BRIDGE`, `G-MOBILE`, `G-SERVER` | `PASS_AUTOMATED` |
| `AC-12` | Current-revision keys send; bounded older revisions are decrypt-only. | `tests/remoteKdfStage3.ts`: three-revision retention and global demotion; `tests/remoteKdfStage4.ts`: `remote decrypt falls back newest-to-oldest while old keys cannot send`, selected current send key, and demoted-send rejection. | `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-13` | Remote failure never causes plaintext sending or a silent crypto downgrade. | `tests/remoteKdfStage4.ts`: cold `instead` rejection retains text, preparation cannot invoke `orig`, all stable/unknown failures are safe, invalid states are inert, and manual/remote APIs remain separate. | `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-14` | Server request bodies, secrets, channel IDs, and returned keys do not appear in telemetry or errors. | Server `test/integration/v2.test.ts`: rate-limit marker test excludes cloud input, channel, and key from logs/body; worker/security tests reject reflected details. Mobile Stage 3/4 redaction and non-reflective notice checks cover status, persistence, timeout, abort, and UI-facing errors. | `G-SERVER`, `G-MOBILE` | `PASS_AUTOMATED` |
| `AC-15` | Per-account and global concurrency limits prevent unbounded 64 MiB jobs. | Server `test/kdf/service.test.ts`: `rejects same-account and global overlap immediately`; pool capacity/lease tests and fixed IP/token rate tests bound global work without a queue. | `G-SERVER` | `PASS_AUTOMATED` |
| `AC-16` | Wrong-key, passwordless-cloud, stale-revision, busy-worker, offline-server, and restart-cache-hit paths have explicit tested behavior. | Each path is separately indexed in `S5-AUTO-05` through `S5-AUTO-10` below. | `G-MOBILE`, `G-SERVER` | `PASS_AUTOMATED` |

## Stage 5 automated cases

| ID | Case | Direct evidence and expected behavior | Gate | Status |
|---|---|---|---|---|
| `S5-AUTO-01` | Server authentication, account binding, formats, bounds, rates, and exact output | Server v2 integration tests bind lookup to read-only identity, reject selectors and malformed/stable failures, enforce HTTPS/rates/body bounds, and return the exact real Worker vector. Decoder/contracts/pool/service suites cover their production boundaries directly. | `G-SERVER` | `PASS_AUTOMATED` |
| `S5-AUTO-02` | Mobile schema, migration, cache, pending, cooldown, revision, and strict key acceptance | `tests/harness.ts`, `tests/remoteKdfStage3.ts`, and `tests/remoteKdfStage4.ts` directly exercise exact contracts, null-hostile migration, restart JSON, race gates, one pending operation, 30-second cooldown, revision demotion/freshness, and 31/33-byte rejection. | `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-03` | Existing stegcloak-rs compatibility | The unchanged WASM harness passes both encryption directions, cloak parity, channel sensitivity, and the committed exact key vector. | `G-MOBILE`, `G-FIXTURE` | `PASS_AUTOMATED` |
| `S5-AUTO-04` | Real cross-repository success bridge | `tests/remoteKdfStage5.test.mjs`: committed encrypted GoofCord blob and exact channel -> authenticated full server app -> default decoder -> capacity-one self-tested Worker/service -> strict mobile streaming client -> ordered slot-one `encryptWithKey` -> `parseCloakedPayload` -> ordered `decryptWithRemoteKeys` plaintext equality; client abort and awaited service close run in `finally`. | `G-BRIDGE` | `PASS_AUTOMATED` |
| `S5-AUTO-05` | Wrong cloud key | Server fixture test fails AES-GCM before Argon exists; service test proves zero Worker derive calls and releases admission; decoder and v2 route return only `CLOUD_DECRYPT_FAILED`; mobile preserves the exact code and fixed fail-closed notice with no send replay. | `G-SERVER`, `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-06` | Passwordless cloud settings | Server fixture/decoder tests recognize the Brotli-only object but never accept passwords and return `PASSWORDS_NOT_SYNCED`; v2 and mobile keep the stable 409/code behavior; ciphertext/text is not downgraded. | `G-SERVER`, `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-07` | Busy Worker/account/global admission | Server service rejects same-account/global overlap; pool returns immediate busy without an idle healthy slot; v2 maps `KDF_BUSY` to the frozen response. Mobile maps it safely, starts fixed cooldown only after the actual derive failure, and never invokes the original send. | `G-SERVER`, `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-08` | Offline/unavailable server | `tests/remoteKdfStage3.ts`: timeout abort and `abortAll` yield only stable `REMOTE_TIMEOUT`/`REMOTE_UNAVAILABLE`, and failed revision checks do not advance freshness. Stage 4 safe-notice and cold-`instead` tests keep ciphertext/composer text and never call `orig` or manual APIs. | `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-09` | Stale revision | Stage 3 revision-first/derive-first race tests prevent readiness resurrection and globally demote sends. Stage 4 stale-send tests require revision-first refresh, refuse failed refresh, and never use or substitute an old key. | `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-10` | Restart cache hit | `tests/remoteKdfStage3.ts`: `valid remote cache survives a plain-JSON restart round trip`. Stage 4 hot receive and fresh selected-send tests prove cached current keys decrypt/encrypt synchronously, while retained old revisions remain decrypt-only. | `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-11` | Malformed cloaked content | Structural parser rejects plain, lone-ZWC, short, and wrong-version frames; Flux creates no waiter/request/cooldown for the rejection. | `G-MOBILE` | `PASS_AUTOMATED` |
| `S5-AUTO-12` | Rapid incoming messages and send attempts | One generation/revision/channel Promise is shared; duplicate IDs replace exact snapshots; 50 mixed waiters dispatch once per decryptable ID; 20 sends plus an incoming miss share one bounded completion while every send retains its text. | `G-MOBILE` | `PASS_AUTOMATED` |

These rows cite existing direct negative/cache tests instead of duplicating
cryptography or adding weaker mocked copies. The only new automation is the
previously missing real server-to-mobile success bridge.

## Physical-device release ledger

Every row below requires evidence from both supported physical platforms. No
current automated result closes a row, and no row may be changed without a
device/build identifier, observed result, and captured redacted evidence.

| ID | Physical check and required evidence | Android | iOS |
|---|---|---|---|
| `DEV-01` | Authentication UX: import an existing raw token, verify configured/redacted status, and complete a derive without exposing the token or cloud key. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-02` | Session-only cloud key: set and use it, unload/reload and process-restart, then prove it is absent and must be re-entered while persistent credentials/cache behavior remains accurately shown. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-03` | Multiple rapid incoming messages/history loads: one remote operation, bounded visible behavior, successful local redispatches, and remaining failures left as ciphertext. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-04` | Multiple rapid send/edit attempts: each cold attempt retains composer text and rejects without sending; one readiness notice appears; only an explicit resend encrypts. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-05` | Wrong cloud key UX: stable safe error, no reflected secret, no local Argon/manual fallback, no plaintext send, and later corrected key can retry. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-06` | Missing cloud passwords UX: stable `PASSWORDS_NOT_SYNCED` guidance, ciphertext/text retained, and no silent downgrade. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-07` | Server unavailable/timeout UX: bounded wait/cooldown, stable safe message, ciphertext/composer retention, and no plaintext/manual fallback. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-08` | Restart cache hits: current cached keys decrypt and send only under the documented revision-freshness policy; old cached revisions decrypt only; the cloud key remains absent. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-09` | Controlled 307 and 308 derive redirects: `redirect: "error"` does not follow either response and the raw token/cloud key never reaches the redirect target. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-10` | Timeout abort: cancel an active fetch and an active response-body read, with no late commit, dispatch, toast, or secret reflection. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-11` | Configuration replacement abort: cancel an active fetch and active body read; the old result cannot cross the new configuration generation. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-12` | Plugin-unload abort: cancel active fetch/body work and prove no late cache/readiness/dispatch/toast plus no retained session key. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-13` | Runtime-selected streaming or canonical declared-length mode: record the actual mode and prove exact 16,384-byte acceptance plus one-byte-over rejection/cancellation. | `PENDING_DEVICE` | `PENDING_DEVICE` |
| `DEV-14` | Missing or incomplete response capabilities: fail as `REMOTE_UNSUPPORTED` before network/body read, with no XHR, redirect-following, or unbounded fallback. | `PENDING_DEVICE` | `PENDING_DEVICE` |

Release status remains **DEVICE_PENDING** until every applicable Android and iOS
row has real evidence. A device failure must keep remote operation disabled or
fail closed; it does not authorize relaxing redirect, abort, response-bound,
secret-storage, or no-downgrade requirements.
