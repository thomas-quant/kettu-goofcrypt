---
quick_id: 260718-s4o
status: passed
verified: 2026-07-18
human_needed: false
gaps_found: 0
requirements_verified: [REMOTE-KDF-STAGE-3]
commits:
  kettu-goofcrypt: 35bc02b723ac6d065c9f7a484d74aa1bda85b24b
  goofcord-cloudserver: 0af697eedaa3ae6797071ff60b991c3fa685ea64
reference:
  GoofCord: 16c551c5a6fbdde137e7f13b4dca01883e3a691d
release_device_validation: pending_stage_5
---

# Quick Task 260718-s4o Verification

## Verdict

Stage 3 passes. Mobile commit
`35bc02b723ac6d065c9f7a484d74aa1bda85b24b` implements the strict authenticated
v2 client, session-only cloud-key holder, independent revision-aware remote
cache, race-safe coordinator, lifecycle integration, and explicit redacted UX
without wiring remote data into the live message paths.

All eleven must-have truths, ten required artifacts, and seven key links are
present in the committed state. The complete mobile harness passes 110 checks,
the Hermes bundle passes its parser/build guards, the frozen server passes all
82 tests, and the shared vector/reference gates remain green.

No human-only evidence is required to establish Stage 3 implementation
completeness. Controlled Android/iOS Kettu redirect, fetch/body abort, and
runtime response-mode exercises remain explicitly pending Stage 5 release-device
validation. Stage 3 does not claim those device semantics and does not yet use
the remote transport from live send/receive hooks, so those pending checks are
not Stage 3 gaps.

## Commit and scope audit

- Mobile HEAD is exactly `35bc02b`; its parent is the recorded baseline
  `78868cef`. The commit changes exactly the twelve planned implementation,
  test, and documentation files.
- `src/discord/flux.ts`, `src/discord/send.ts`, `src/core/decrypt.ts`, and
  `src/core/encrypt.ts` are byte-identical to the parent. Their SHA-256 values
  are respectively `495211f...`, `f433770...`, `015a498...`, and `acbbf8a...`.
- The mobile commit does not change `src/cloud/contracts.ts`, manual
  `src/core/keycache.ts`, dependencies, lockfile, or build pipeline.
- Server HEAD remains the verified Stage 2 commit `0af697e` with a clean
  worktree. The read-only GoofCord checkout remains clean at `16c551c`.
- User-owned `CLAUDE.md`, untracked `AGENTS.md`, and planning artifacts remain
  outside the implementation commit.

## Must-have truth audit

| # | Result | Evidence |
|---:|:---:|---|
| 1 | Pass | Manual keys/passwords/chosen slot/import behavior remain in the unchanged manual cache and existing command cases. Remote persistence is a separate `RemoteKeyCacheStore` (`settings.ts:64`, `remoteKeycache.ts:17-25`), and the remote cache imports neither manual keycache nor Argon/stegcloak. All four Stage 4 hook files match the parent byte-for-byte, so there is no remote/manual fallback or early cold-path wiring. |
| 2 | Pass | `normalizeRemoteOrigin` accepts canonical HTTPS and only exact loopback HTTP under the explicit flag while rejecting credentials/path/query/fragment (`client.ts:152-183`). `normalizeRemoteToken` trims paste whitespace then enforces exactly 32 lowercase hex characters (`:146-150`). Requests have only literal v2 paths and raw `authorization`; source contains no Bearer, OAuth, XHR, or cloud `/v1/save|load|delete`. |
| 3 | Pass | The universal key exists only as module state in `session.ts:5`; validation reuses the exact 1,024-byte request contract (`:14-18`) and redacted state returns booleans only (`:44-45`). Configuration change, forget, key replacement/clear, initialization, and unload abort pending work and clear the session before generation reuse (`remoteKdf.ts:122-192,372-379`). The old/new-origin deferred test proves an old key cannot reach the replacement origin. Storage, cache, status, commands, diagnostics, and errors contain no cloud-key field/value. |
| 4 | Pass | `probeRemoteTransport` is exception-safe and proves callable fetch, constructible/abortable controller, URL behavior, Response status/headers/text, and stream-or-declared-length bounding mode (`client.ts:104-140`). Unsupported/partial surfaces return only `REMOTE_UNSUPPORTED`; `activeClient` refuses networking when unsupported (`remoteKdf.ts:99-104`). There is no permissive fallback, and the pending device semantics are recorded honestly in the transport document (`docs/REMOTE_KDF_MOBILE_TRANSPORT.md:65-82`). |
| 5 | Pass | The client sends exact POST derive and bodyless GET revision calls with `redirect:"error"`, `cache:"no-store"`, raw Authorization, fixed 270,000/15,000 ms timers, and one tracked controller (`client.ts:18-22,274-350`). Declared and streamed bodies are hard-bounded at 16,384 bytes before JSON (`:185-244`); only JSON bodies with exact success parsers or exact status/code error mapping pass (`:304-318`). Redirect/final-URL, malformed shape, extra field, status mismatch, noncanonical key, and caught exception paths collapse to stable codes. |
| 6 | Pass | Migration creates/sanitizes only the version-1 `remoteKeyCache` envelope (`remoteKeycache.ts:75-149`) beside existing `Settings.keys`. Cache sets have exactly revision, keys, and `sendCapable`; each key is canonical padded base64 and exactly 32 bytes (`:56-72`) before storage and again before return (`:204-229`). No password, passwordId, token, account identity, cloud key, or KDF option is stored. Unknown versions and malformed sets fail closed without touching manual state. |
| 7 | Pass | Strict derive responses install contiguous server slot order as the target head, remove the matching revision, demote old/global entries on revision change, and truncate to three sets (`remoteKeycache.ts:159-185`). Accessors separate current send keys from newest-to-oldest decrypt sets (`:213-229`). Revision application globally demotes stale send capability (`:188-202`). Coordinator generation/epoch/order/starting-revision gates prevent late derive/revision/derive mutation (`remoteKdf.ts:65-70,194-301`), with both response orders covered. |
| 8 | Pass | `REMOTE_REVISION_TTL_MS` is fixed at 300,000 ms. Configured load calls one caught forced refresh (`index.ts:118`, `remoteKdf.ts:241-244`); UI/command explicit checks force refresh; the exported Stage 4 freshness API uses the 299999/300000 boundary and a single coalesced in-flight promise (`remoteKdf.ts:194-239`). Revision requests never read the session key or mark readiness, failures do not update cache freshness, and the unchanged hooks do not poll per message. |
| 9 | Pass | Readiness requires configured valid fields, supported transport, held session key, and a verification matching both current revision and configuration generation (`session.ts:26-36`, `remoteKdf.ts:312-333`). Only a strict derive that passes every commit gate stores keys and calls `markRemoteVerified` (`remoteKdf.ts:246-276`). Configuration/key/cache/revision change and shutdown invalidate proof. Failed derives clear their own proof, while the checker correction at `:277-291` prevents an older stale completion from erasing proof installed by a newer successful mutation. |
| 10 | Pass | The settings screen keeps the manual fields intact and adds a separate Stage 3 section. Token and cloud-key state start blank, use `secureTextEntry`, and clear after use (`Settings.tsx:93-157,203-280`). It exposes save, set/clear key, current-channel verify, forced revision check, redacted status, remote-only clear, and forget. `/encrypt` adds only secret-free `remote-status`, `remote-refresh`, `remote-check`, and `remote-clear`; there are no remote host/token/key options. Missing channel returns before refresh, destructive labels identify preserved/cleared state, and status exposes only booleans/categories/counts/fixed policy/stable code. |
| 11 | Pass | Remote initialization follows `initSettings` and manual `initKeyCache` (`index.ts:84-90`), on-load refresh consumes rejection, and unload closes remote work first (`:118,129-134`). Persisted channel keys remain; session/readiness/controllers are cleared. Build output parses exactly as Kettu evaluates it and contains no class, generator, or forbidden iterator-lowering syntax. The unchanged stegcloak-rs cross-compatibility suite and exact vector remain green. |

## Artifact audit

| Artifact | Result | Evidence |
|---|:---:|---|
| `src/cloud/client.ts` | Pass | Contains literal `/v2/kdf/derive`, capability probe, strict origin/token gates, tracked aborts, fixed budgets, bounded body reader, and exact response parsers. |
| `src/cloud/session.ts` | Pass | Contains module-only key/verification state and `clearRemoteSession`. |
| `src/core/remoteKeycache.ts` | Pass | Contains versioned exact-shape sanitization, canonical key gates, immutable accessors, demotion, and `MAX_REMOTE_REVISIONS_PER_CHANNEL = 3`. |
| `src/cloud/remoteKdf.ts` | Pass | Contains `REMOTE_REVISION_TTL_MS = 300000`, client/session/cache orchestration, coalescing, readiness, ordered commits, and shutdown. |
| `src/settings.ts` | Pass | `Settings` extends both independent stores and persists only primitive remote origin/token/policy fields plus the separate envelope. |
| `src/ui/Settings.tsx` | Pass | Contains the separate `Remote KDF (Stage 3 setup)` section and every masked setup/clear/verify action. |
| `src/discord/commands.ts` | Pass | Contains all four required secret-free remote action choices; no remote secret argument exists. |
| `src/index.ts` | Pass | Contains ordered init, caught load refresh, and first-on-unload `shutdownRemoteKdf`. |
| `tests/remoteKdfStage3.ts` | Pass | Contains client/session/body-bound/error, cache/migration/race/TTL/readiness/lifecycle checks including `CLOUD_DECRYPT_FAILED`. |
| `docs/REMOTE_KDF_MOBILE_TRANSPORT.md` | Pass | Records exact Stage 3 capability/bounding/no-fallback contract and an explicitly pending Stage 5 checklist without claiming device proof. |

## Key-link audit

| From -> To | Result | Evidence |
|---|:---:|---|
| Settings -> remote cache | Pass | `Settings extends KeyCacheStore, RemoteKeyCacheStore`; the existing manual `keys` field remains independent. |
| Client -> frozen contracts | Pass | Success and errors cross `parseDeriveResponse`, `parseRevisionResponse`, or `parseErrorResponse` before return. |
| Coordinator -> session | Pass | Only derive reads `remoteCloudKey`; strict install marks verification; configuration, key, cache, revision, and unload paths clear session/proof. |
| Coordinator -> remote cache | Pass | Derive uses `storeRemoteDerivedKeys`; revision uses `applyRemoteRevision`; neither writes manual keys. |
| Lifecycle -> coordinator | Pass | `initRemoteKdf`, `refreshRemoteRevisionOnLoad`, and `shutdownRemoteKdf` are wired in the required order. |
| Settings UI -> coordinator | Pass | UI invokes validated configuration/session setters, current-channel derive, forced revision, shared formatter, remote-only clear, and forget. |
| Commands -> coordinator | Pass | Remote choices call only status/current-channel refresh/revision/remote-cache clear and map errors through the stable safe-message helper. |

## Checker-correction and adversarial audit

- **Unsupported runtime:** missing/partial fetch, AbortController, URL, and
  Response surfaces fail closed before a request; no XHR or alternative path
  exists.
- **Response boundary:** declared oversize is rejected before read; streaming is
  incrementally counted/cancelled above 16 KiB; no-stream fallback requires a
  canonical bounded Content-Length and rechecks actual UTF-8 bytes.
- **Configuration generation:** complete origin/token/policy validation occurs
  before abort/session clear; accepted changes abort and clear before assignment
  and generation advance. The deferred old/new origin test proves separation.
- **Ordered mutation:** revision and derives share request order and mutation
  epoch. Tests cover revision-first and derive-first, both derive-vs-derive
  completion orders, same-channel joining, config replacement, and unload late
  settlement.
- **Newer readiness wins:** an older stale derive cannot clear verification
  installed by the newer commit; an ordinary failed current refresh does clear
  its proof. The final harness assertion covers both sides of this correction.
- **Null-hostile storage:** defaults are primitive/non-null and remote migration
  assigns a complete object; the Kettu-style null-hostile proxy test passes.
- **Stage 2 carry-forward:** the server's exact path-aware `KDF_FAILED` fallback,
  authentication binding, stable errors, response ordering, and vector path all
  remain green in the full 82-test rerun.

## Secrecy and downgrade audit

- The only persisted remote credential is the revocable raw token, accurately
  documented as plaintext Kettu storage. The universal key has no Settings or
  cache field and is absent from manual import/export/debug shapes.
- Remote status contains no origin, token, key, channel ID, exact revision,
  response body, returned key, or caught message. UI/command async catches route
  through `remoteErrorMessage`, whose output is a fixed code-to-text table.
- The on-load revision rejection is consumed inside
  `refreshRemoteRevisionOnLoad`; secret-bearing network errors cannot reach the
  generic plugin `safe()` logger/toast.
- Cache shapes and source imports contain no password/passwordId/account selector
  or adjustable KDF parameter. Remote failures have no call path into local
  derivation or plaintext sending.
- Source scans found no Bearer wrapper, `/v1` cloud route, XHR fallback,
  cloud-path console/logger/health sink, runtime Buffer/TextEncoder use in the
  new client/cache, local Argon import, or stegcloak import.

## Cache, revision, and lifecycle evidence

- Manual-only, null-hostile, unknown-version, corrupt-key, valid restart, and
  remote-only-clear cases pass without changing the manual subtree.
- Canonical 31/33-byte rejection, contiguous multi-slot ordering, same-revision
  replacement, immutable read copies, three-revision retention, multi-channel
  global demotion, and current-send versus historical-decrypt access pass.
- Revision freshness passes exact 299999/300000 ms boundaries, concurrent
  coalescing, failure timestamp preservation, forced load/explicit behavior, and
  clock-rollback-conservative source logic.
- Readiness is false for configuration/key alone, true only after strict derive,
  false after current refresh failure, revision change, config/key/cache change,
  or unload, and not resurrected by late responses.
- Shutdown aborts tracked work, rejects late commit, clears key/proof, and keeps
  valid persisted cache state available for a future session.

## UX and documentation evidence

- Stored token is represented as configured/not-configured; its actual value is
  never placed into React input state. Token and cloud-key fields are masked,
  blank initially, and cleared after submission.
- UI controls cover host/policy/token save, session-key set/clear, current-channel
  verify, revision check, status, remote-only cache clear, and credential forget.
  Labels/toasts state what manual settings or credentials are preserved.
- Command controls are copyable but secret-free. There is no remote mode toggle,
  and both UI and command status explicitly say live messages remain on the
  manual Stage 3 pipeline.
- README and the dedicated transport document state plaintext token/cache
  storage, session-only key limitations, strict origin policy, no v1 access,
  retention/clear semantics, unsupported-runtime behavior, and the Stage 3/4/5
  boundary without a fake vault or unproven device claim.

## Re-run evidence

Mobile committed tree:

- `npm test`: **110 passed, 0 failed**.
- `npm run build`: passed; hash `07dd6adb59ad9a25`, 256,858 bytes.
- Kettu expression parse: passed.
- Generated syntax gates: no class, generator/yield, or
  `_iteratorNormalCompletion` lowering.
- `npm exec tsc -- --noEmit`: passed.
- `git diff --check`: passed.
- Stage 4 hook parent diff: empty; all four baseline hashes match.
- Source `/v1`, fallback, sink, and import audits: passed.

Server/reference:

- `bun install --frozen-lockfile`: passed with no changes.
- `bun run typecheck`: passed.
- `bun test`: **82 passed, 0 failed**, 424 expectations across 16 files.
- `docker compose config --quiet`: passed.
- `docker build --check .`: passed with no warnings.
- Server `git diff --check`: passed; server worktree clean.
- Mobile/server vector SHA-256 is identical:
  `876747b46785581b09421896abc801733ad4848dcfebcdcbd0cf780c2fe87ac2`.
- Nested GoofCord worktree: clean.

## Human-needed and deferred release validation

`human_needed: false` for Stage 3. Every behavior Stage 3 claims is verifiable
from the committed source, deterministic injected transport/cache/race tests,
build guards, server suite, and compatibility harness.

The following are deliberately not claimed by Stage 3 and remain pending Stage
5 device-release gates:

1. Controlled Kettu/Hermes Android and iOS proof that `redirect:"error"` does
   not follow a 307/308 secret-bearing request.
2. Real-runtime proof that timeout, configuration replacement, and unload abort
   both fetch and active body reading.
3. Real-runtime proof of the selected response mode and exact 16 KiB boundary.
4. Full Stage 4 cold-path/device UX scenarios after remote hooks exist.

These are future release validation, not implementation gaps in the isolated
Stage 3 setup/cache boundary.

## Gaps

None for `REMOTE-KDF-STAGE-3`.
