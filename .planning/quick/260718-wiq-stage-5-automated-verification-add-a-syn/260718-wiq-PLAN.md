---
quick_id: 260718-wiq
phase: quick
plan: 260718-wiq
type: execute
wave: 1
depends_on: [260718-tyu]
status: planned
description: Stage 5 - add the real cross-repository server-to-mobile crypto bridge and a requirement-level automated-versus-device acceptance ledger
autonomous: true
requirements: [REMOTE-KDF-STAGE-5]
files_modified:
  - package.json
  - tests/remoteKdfStage5.test.mjs
  - docs/REMOTE_KDF_ACCEPTANCE.md
must_haves:
  truths:
    - "One explicit workspace test reads the committed synthetic GoofCord encrypted cloud blob and canonical Argon fixture, uses their exact public cloud key and decimal channel, and obtains both ordered slot keys through the production cloud decoder, capacity-one self-tested Bun Worker pool, remote KDF service, authenticated v2 application, and strict mobile HTTP client"
    - "The bridge accepts the HTTP result only through the existing mobile v1 response contract, proves slots are exactly [0,1] with slot zero equal to the committed 32-byte vector, decodes the returned keys with the existing base64 utility, encrypts plaintext with returned slot one through unchanged encryptWithKey, parses it through parseCloakedPayload, and decrypts it through decryptWithRemoteKeys in exact returned order"
    - "The integration is hermetic and bounded: authentication/settings persistence are narrow in-memory boundary stubs, no external network or database is used, all unexpected touching auth/settings writes fail the test, and the client plus service/Worker pool are aborted/closed in finally even after initialization or assertion failure"
    - "No production crypto, KDF, stego, message, server, fixture, dependency, or reference code changes; the test does not implement Argon, cloud decoding, AEAD, compression, framing, ZWC, or base64 itself and the existing mobile and server test commands remain unchanged and green"
    - "A committed acceptance ledger gives every checkbox in docs/REMOTE_KDF_ARCHITECTURE.md and every Stage 5 automated scenario a stable requirement ID, status, exact test/source evidence, and reproducible command; existing direct wrong-key, passwordless, busy, offline, stale, malformed-ZWC, rapid-event, and restart-cache tests are referenced rather than duplicated"
    - "Automated acceptance and physical-device release evidence are separate: every authentication/session/rapid-message/rapid-send/error/offline/restart UX check and every Android/iOS redirect, abort, response-bound, and unsupported-capability check remains visibly PENDING until real device evidence exists, and no Node/Bun/build result is presented as physical proof"
  artifacts:
    - path: "tests/remoteKdfStage5.test.mjs"
      provides: "Executable authenticated full-app bridge from a committed GoofCord cloud blob through the real server Worker/service and strict mobile client into unchanged mobile message crypto"
      contains: "createKdfWorkerPool"
    - path: "package.json"
      provides: "A discoverable opt-in command for the sibling-workspace integration without weakening the standalone mobile test command"
      contains: "test:remote-kdf-stage5"
    - path: "docs/REMOTE_KDF_ACCEPTANCE.md"
      provides: "Requirement-level automated evidence ledger plus an explicitly pending Android/iOS device-release ledger"
      contains: "PENDING_DEVICE"
  key_links:
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json"
      via: "the full-app settings load returns the exact committed encrypted synthetic blob and the derive request supplies its exact committed cloudEncryptionKey"
      pattern: "cloud-blobs-v1"
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "../goofcord-cloudserver/src/runtime/application.ts"
      via: "an injected fetch adapter sends the strict mobile request through the real Hono security/auth/settings/v2 route composition"
      pattern: "createApplication"
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "../goofcord-cloudserver/src/kdf/service.ts"
      via: "the application receives a production service backed by the default decoder and a capacity-one production Worker pool whose initialization runs the exact self-test"
      pattern: "createRemoteKdfService"
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "src/cloud/client.ts"
      via: "createRemoteKdfClient creates the exact request, raw authorization, bounded body read, and strict response parsing before any key is consumed"
      pattern: "createRemoteKdfClient"
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "src/core/encrypt.ts"
      via: "returned slot one bytes are passed directly to encryptWithKey without local derivation or a test crypto reimplementation"
      pattern: "encryptWithKey"
    - from: "tests/remoteKdfStage5.test.mjs"
      to: "src/core/decrypt.ts"
      via: "the resulting cloaked message crosses the unchanged structural parser and ordered remote-key decrypt pipeline"
      pattern: "parseCloakedPayload|decryptWithRemoteKeys"
    - from: "docs/REMOTE_KDF_ACCEPTANCE.md"
      to: "docs/REMOTE_KDF_ARCHITECTURE.md"
      via: "AC-01 through AC-16 preserve checklist order and point to direct automated evidence or an explicit pending device row"
      pattern: "AC-16"
---

<objective>
Complete the automated portion of Stage 5 in `docs/REMOTE_KDF_ARCHITECTURE.md`: prove the missing cross-repository success chain from a real encrypted GoofCord fixture through the authenticated server KDF boundary to the unchanged GoofCrypt mobile message pipeline, then publish a precise acceptance ledger that distinguishes automated proof from still-pending physical-device release checks.

Purpose: Existing Stage 1-4 suites prove each boundary independently and directly cover the requested failure, concurrency, cache, and compatibility behavior, but no executable test currently carries one production-derived server key across the server/mobile repository boundary into the real mobile encrypt/parse/decrypt functions. This task closes only that evidence gap and makes the remaining device work impossible to mistake for completed automation.

Output: One hermetic Bun integration test in the mobile workspace, one additive package command, and one requirement-level ledger covering all architecture acceptance criteria, all Stage 5 automated cases, and every pending Android/iOS/manual release check.
</objective>

<execution_context>
@$HOME/.codex/gsd-core/workflows/execute-plan.md
@$HOME/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@CLAUDE.md
@.planning/STATE.md
@docs/REMOTE_KDF_ARCHITECTURE.md
@docs/REMOTE_KDF_MOBILE_TRANSPORT.md
@.planning/quick/260718-prx-stage-1-freeze-remote-kdf-contracts-exac/260718-prx-PLAN.md
@.planning/quick/260718-prx-stage-1-freeze-remote-kdf-contracts-exac/260718-prx-VERIFICATION.md
@.planning/quick/260718-qlx-stage-2-implement-authenticated-remote-k/260718-qlx-PLAN.md
@.planning/quick/260718-qlx-stage-2-implement-authenticated-remote-k/260718-qlx-VERIFICATION.md
@.planning/quick/260718-s4o-stage-3-implement-kettu-remote-cloud-ses/260718-s4o-PLAN.md
@.planning/quick/260718-s4o-stage-3-implement-kettu-remote-cloud-ses/260718-s4o-VERIFICATION.md
@.planning/quick/260718-tyu-stage-4-wire-remote-kdf-into-kettu-incom/260718-tyu-PLAN.md
@.planning/quick/260718-tyu-stage-4-wire-remote-kdf-into-kettu-incom/260718-tyu-VERIFICATION.md
@tests/fixtures/remoteKdf/argon2id-v1.json
@tests/harness.ts
@tests/remoteKdfStage3.ts
@tests/remoteKdfStage4.ts
@src/cloud/client.ts
@src/cloud/contracts.ts
@src/core/encrypt.ts
@src/core/decrypt.ts
@src/util/base64.ts
@../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json
@../goofcord-cloudserver/test/integration/v2.test.ts
@../goofcord-cloudserver/test/kdf/cloudBlob.test.ts
@../goofcord-cloudserver/test/kdf/pool.test.ts
@../goofcord-cloudserver/test/kdf/service.test.ts
@../goofcord-cloudserver/src/runtime/application.ts
@../goofcord-cloudserver/src/kdf/pool.ts
@../goofcord-cloudserver/src/kdf/service.ts
</context>

<constraints>
- Treat the locked architecture, all verified Stage 1-4 behavior, and byte-exact GoofCord/stegcloak-rs compatibility as canonical. This task adds verification and documentation only; it does not revise the protocol, runtime behavior, security model, or release policy.
- Use mobile baseline `fd7278443ecbb70295695371c924041e4dccf0b0`, server baseline `0af697eedaa3ae6797071ff60b991c3fa685ea64`, and GoofCord reference baseline `16c551c5a6fbdde137e7f13b4dca01883e3a691d` for scope gates. Preserve the user's modified `CLAUDE.md`, untracked `AGENTS.md`, and unrelated planning artifacts.
- Make implementation changes only to `package.json`, the new Stage 5 integration test, and the new acceptance ledger in `kettu-goofcrypt`. Do not edit `src/`, existing tests, existing fixtures, `package-lock.json`, build scripts, `goofcord-cloudserver`, `stegcloak-rs`, or nested GoofCord.
- Keep the existing `npm test` script unchanged and additive. Add a separately named `test:remote-kdf-stage5` Bun command because the cross-repository proof deliberately requires the sibling server checkout; do not make ordinary standalone mobile tests depend on Bun or a sibling directory.
- Use an `.mjs` Bun test so the mobile TypeScript project with `types: []` does not absorb Bun/server typings or start type-checking sibling production sources. Add no dependency: Bun and all server dependencies belong to the existing sibling server workspace.
- The integration must use the committed encrypted blob and exact values, not construct/regenerate a blob or embed a copied password/key expectation. Read the cloud blob/cloud key from `cloud-blobs-v1.json`, the channel/slot-zero expected key from the canonical `argon2id-v1.json`, and retain the existing byte-identical fixture comparison gate.
- Instantiate `createKdfWorkerPool({capacity:1,jobTimeoutMs:30000})` without a fake worker factory and `createRemoteKdfService(pool)` without an injected decoder. Await initialization so the production worker exact-vector self-test is part of the bridge. Do not import the Worker directly or call a local Argon function.
- Exercise the authenticated full application because it is feasible: use the real `loadConfig`, `createSecurity`, `createReadiness`, `createApplication`, and v2 router composition. Stub only external account/session/settings/OAuth/database seams; read-only auth must accept exactly one valid raw 32-character token, settings load must return the fixture only for that authenticated account, and touching auth/settings save/delete/revoke must fail the test.
- Inject a no-network fetch adapter into `createRemoteKdfClient` that converts its exact URL/init to a Request and calls `app.fetch` with a fixed non-secret direct peer. Do not bypass the strict mobile client, body bound, content type/status checks, response contract, raw auth, or HTTPS path.
- After strict acceptance, use existing `fromBase64` and defensive copies only. Pass returned slot one directly to `encryptWithKey`, then pass the resulting content to `parseCloakedPayload` and `decryptWithRemoteKeys` with returned keys in their exact response order. Do not reproduce AEAD, compression, payload framing, ZWC, or base64 logic in the test.
- Use a deterministic test RNG only to supply the existing encryption API's nonce bytes. It is test input, not a replacement cipher or production RNG path. Use a visibly synthetic plaintext/cover and never print fixture cloud keys, passwords, returned keys, channel IDs, request bodies, or caught error details.
- Always place `client.abortAll()` and `await kdf.close()` in `finally`; `close()` must also run if initialization or any assertion fails. Give the Worker-backed test an explicit bounded timeout (90 seconds maximum) and no retry loop.
- Do not add duplicate negative tests merely to populate the ledger. The current direct server/mobile suites already cover wrong key before Argon, passwordless settings, worker busy, offline/unavailable, stale revisions, malformed ZWC, rapid-message/send coalescing, and plain-JSON restart cache hits. Add only the missing success bridge unless execution discovers a genuine direct-evidence gap.
- The ledger may mark an automated item PASS only after its cited command is rerun successfully against the recorded commits. Physical behavior is not inferable from Node, Bun, source inspection, build output, or injected transport tests: mark every unevidenced Android/iOS/manual item `PENDING_DEVICE`, preserve the Stage 5 transport checklist, and state that release acceptance remains pending.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the authenticated real-server-to-mobile crypto bridge</name>
  <files>tests/remoteKdfStage5.test.mjs, package.json</files>
  <behavior>
    - The test reads the server encrypted fixture and the canonical mobile Argon fixture at runtime, uses `encrypted.blob`, `encrypted.cloudEncryptionKey`, and the fixture `channelId`, and never generates or copies GoofCord cloud settings/passwords.
    - A production capacity-one pool initializes a real Bun Worker and completes its self-test; the production remote service uses the default strict cloud decoder and sequentially returns exactly slots `[0,1]`, with slot zero exactly equal to the committed vector key.
    - The strict mobile client sends one authenticated HTTPS `POST /v2/kdf/derive` through the full Hono application. The route authenticates the exact raw token read-only, loads only the authenticated account's fixture blob, performs no touching auth or settings write/delete/revoke, and returns through the real security and contract boundary.
    - The mobile client accepts the result only after its response-size/content-type/status/exact-shape/canonical-32-byte/contiguous-slot validation. An explicit assertion also rechecks `parseDeriveResponse(result).ok` and exact slot order before base64 decoding.
    - The returned slot-one key encrypts a synthetic plaintext with unchanged `encryptWithKey`; `parseCloakedPayload` accepts the produced content; `decryptWithRemoteKeys` receives one set containing both returned keys in exact order and yields the original plaintext, forcing slot zero to miss before slot one succeeds.
    - The test has a 90-second cap, no network/database dependency, no Argon/decoder/crypto duplication, and closes/aborts the mobile client and real service/Worker pool in `finally` on success or failure.
    - `package.json` adds only `test:remote-kdf-stage5: bun test tests/remoteKdfStage5.test.mjs`; the existing `test`, build, dependency, and lockfile behavior remains unchanged.
  </behavior>
  <action>
    Create a Bun `.test.mjs` beside the existing mobile harnesses. Load both JSON fixtures with `readFileSync`/`JSON.parse` and validate the few fields needed by the test before starting expensive work. Import production server factories from the sibling source and production mobile client/contract/base64/encrypt/decrypt functions from `src`; do not import an existing test harness implementation or duplicate its crypto helpers.

    Build the real server KDF with the production default Worker factory and decoder, then await initialization. Compose the full authenticated app with actual configuration/security/readiness and narrow fakes for external state: one exact raw mobile-compatible token maps to one synthetic account, `settings.load` records and returns only that account's committed blob, all touch/write/delete/revoke methods throw, OAuth is inert, and Mongo readiness is a connected shape. Capture only safe aggregate call counts/account labels needed for assertions.

    Inject a fetch adapter into `createRemoteKdfClient` that forwards the exact client URL and RequestInit to `app.fetch` using a fixed documentation-range peer address. Call `derive` exactly once with fixture channel/cloud key. Assert the auth/load/no-write boundary, exact strict response, `[0,1]` order, and slot-zero vector. Decode returned keys only with `fromBase64`, encrypt using slot one and a fixed 24-byte-producing RNG, parse the cloaked result, and decrypt with the returned ordered array; assert exact plaintext equality.

    Define client/service variables outside the `try`, call `abortAll` if constructed, and always await `kdf.close()` in `finally`, including initialization failure. Add the additive package command only; do not fold it into `npm test` or touch dependencies/lockfiles.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt &amp;&amp; npm run test:remote-kdf-stage5 &amp;&amp; npm test &amp;&amp; npm exec tsc -- --noEmit &amp;&amp; git diff --check &amp;&amp; git diff --exit-code fd7278443ecbb70295695371c924041e4dccf0b0 -- src scripts package-lock.json tests/fixtures &amp;&amp; test -z "$(git -C ../goofcord-cloudserver status --porcelain)" &amp;&amp; test -z "$(git -C ../stegcloak-rs/GoofCord status --porcelain)"</automated>
  </verify>
  <done>The missing Stage 5 success chain is executable from one command: a committed GoofCord blob is authenticated and decoded by the real bounded server Worker/service, strictly parsed by the mobile client, and its ordered returned key round-trips plaintext through unchanged mobile encrypt/parse/decrypt code with all workers closed.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Publish the automated acceptance and pending device ledger</name>
  <files>docs/REMOTE_KDF_ACCEPTANCE.md</files>
  <behavior>
    - The ledger records the exact mobile/server/reference commits under test, the new cross-workspace command, the unchanged standalone mobile/server commands, expected sibling layout, and the latest successful automated rerun date/counts without embedding secret values.
    - Architecture rows `AC-01` through `AC-16` preserve the exact checklist order and wording scope. Each row distinguishes direct test evidence, supporting source/static gate, command, and status; no row relies only on a prior narrative verification report.
    - Stage 5 automated rows separately cover server authentication/account binding/format/bounds/rates/exact output, mobile schema/cache/dedup/cooldown/revision/32-byte validation, unchanged stegcloak-rs interop, the new real cross-repository success bridge, malformed ZWC, rapid incoming/send coalescing, wrong cloud key, passwordless cloud, busy worker, offline/unavailable server, stale revision, and plain-JSON restart cache hits.
    - Wrong-key evidence names the real decoder/service test proving zero Worker/Argon calls; passwordless names the real fixture/decoder stable error; busy names service/pool/route plus mobile safe mapping; offline names client/cold-send failure and no plaintext/orig behavior; restart names cache JSON restart plus current/historical hot-path behavior. No redundant test is added when this evidence is direct.
    - A separate physical-device table maps every Stage 5 architecture UX scenario and every transport checklist item for Android and iOS. All rows begin and remain `PENDING_DEVICE`, specify the evidence still required, and state that automated completion does not authorize shipment or a permissive transport fallback.
    - The ledger does not tick or rewrite the canonical architecture/transport checkboxes, does not call device items passed, and gives an honest split verdict such as `AUTOMATED_PASS / DEVICE_PENDING` only after all commands pass.
  </behavior>
  <action>
    Create `docs/REMOTE_KDF_ACCEPTANCE.md` as the canonical evidence index rather than rewriting the architecture. Begin with scope/status vocabulary and reproducible commands. Record `PASS_AUTOMATED` only for evidence rerun during execution; use `PENDING_DEVICE` for physical work and `FAIL` for any command failure. Link evidence to exact test file and test/check name (plus relevant production invariant where useful), not merely to broad stage summaries.

    Add the 16-row architecture acceptance table in source order. Then add a Stage 5 automated-case table that makes the four architecture verification bullets and requested negative/cache cases individually visible. Reuse current direct evidence from `tests/harness.ts`, `tests/remoteKdfStage3.ts`, `tests/remoteKdfStage4.ts`, server `test/kdf/*.test.ts`, `test/integration/v2.test.ts`, runtime lifecycle/security tests, fixture comparisons, protected-source diff gates, and the new bridge. If a row cannot cite a direct test/static gate, leave it unresolved and add only the smallest missing test; do not infer success from prose.

    Finish with a physically separate device-release table. Expand the architecture's authentication UX, session-only cloud key, rapid incoming, rapid sends, wrong key, missing passwords, unavailable server, and restart cache-hit exercises, plus the transport document's redirect 307/308, active fetch/body abort on timeout/config/unload, selected response mode/16,384-byte bound, and missing-capability fail-closed checks. Require Android and iOS evidence for each supported-platform claim and initialize every row to `PENDING_DEVICE`; include a prominent statement that no current Node/Bun result closes these rows.

    Run the new bridge, complete standalone mobile suite/build/typecheck, complete server typecheck/suite, exact fixture comparison, source-scope gates, and clean server/reference gates. Record only non-secret counts/commits/date in the ledger after they pass. Do not modify existing tests merely to make the table look fuller; their current named direct cases are sufficient for wrong-key/passwordless/busy/offline/stale/restart behavior.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt &amp;&amp; npm run test:remote-kdf-stage5 &amp;&amp; npm test &amp;&amp; npm run build &amp;&amp; npm exec tsc -- --noEmit &amp;&amp; cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json &amp;&amp; git diff --exit-code fd7278443ecbb70295695371c924041e4dccf0b0 -- src scripts package-lock.json tests/fixtures &amp;&amp; git diff --check &amp;&amp; test "$(git -C ../goofcord-cloudserver rev-parse HEAD)" = "0af697eedaa3ae6797071ff60b991c3fa685ea64" &amp;&amp; test -z "$(git -C ../goofcord-cloudserver status --porcelain)" &amp;&amp; test "$(git -C ../stegcloak-rs/GoofCord rev-parse HEAD)" = "16c551c5a6fbdde137e7f13b4dca01883e3a691d" &amp;&amp; test -z "$(git -C ../stegcloak-rs/GoofCord status --porcelain)" &amp;&amp; cd ../goofcord-cloudserver &amp;&amp; bun run typecheck &amp;&amp; bun test</automated>
  </verify>
  <done>Every architecture checkbox and Stage 5 automated scenario has direct reproducible evidence and an honest automated status, while every Android/iOS transport and UX release check remains separately and visibly pending; no negative test or cryptographic implementation was duplicated to manufacture coverage.</done>
</task>

</tasks>

<threat_model>
## Verification-boundary threats

| Threat | Risk | Plan mitigation |
|---|---|---|
| Fake integration | A test could reproduce expected keys or call a decoder/Argon helper directly, never crossing the real server/mobile boundary | Use committed fixtures, the default decoder, real initialized production Worker pool/service, full authenticated app, strict mobile client, and unchanged mobile pipeline; prohibit crypto/KDF reimplementation |
| Boundary bypass | Direct service calls could miss auth, account binding, HTTPS/security, raw authorization, response bounds, or strict mobile parsing | Route the mobile client's exact Request through `createApplication` with actual security and assert read-only authenticated account lookup/no writes |
| Resource leak | A failed Worker-backed test could leave a Bun Worker alive and hang CI | One capacity-one pool, 90-second test bound, client abort and awaited service/pool close in `finally`, including initialization failure |
| Fixture drift | Inline copied cloud/channel/key values could silently diverge from the Stage 1 contract | Read committed fixture fields at runtime, retain byte-identical fixture `cmp`, and protect fixture paths from edits |
| False completeness | Passing Node/Bun tests could be mislabeled as proof of React Native device semantics | Separate automated and device ledgers; initialize every Android/iOS row `PENDING_DEVICE`; preserve the no-fallback release gate |
| Coverage theater | Repeating mocked negative cases could inflate test counts without adding boundary evidence | Cite existing direct decoder/service/client/cold-path cases and add only the one missing real success bridge |
| Secret disclosure | Integration assertions or ledger output could log fixture/request/key material | Fixtures remain public synthetic data, but test output/ledger still record only stable case labels, aggregate counts, commits, and statuses; no secret-bearing logging |
</threat_model>

<verification>
Run after both tasks:

```bash
cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt

# New cross-repository bridge, then the unchanged standalone mobile gates.
npm run test:remote-kdf-stage5
npm test
npm run build
npm exec tsc -- --noEmit

# Frozen fixtures and a verification-only mobile diff.
cmp tests/fixtures/remoteKdf/argon2id-v1.json \
    ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json
git diff --exit-code fd7278443ecbb70295695371c924041e4dccf0b0 -- \
    src scripts package-lock.json tests/fixtures
git diff --check

# Server and GoofCord are read-only Stage 5 inputs.
test "$(git -C ../goofcord-cloudserver rev-parse HEAD)" = \
    "0af697eedaa3ae6797071ff60b991c3fa685ea64"
test -z "$(git -C ../goofcord-cloudserver status --porcelain)"
test "$(git -C ../stegcloak-rs/GoofCord rev-parse HEAD)" = \
    "16c551c5a6fbdde137e7f13b4dca01883e3a691d"
test -z "$(git -C ../stegcloak-rs/GoofCord status --porcelain)"

cd ../goofcord-cloudserver
bun run typecheck
bun test
```

Audit the new test imports: it may use server application/config/security/readiness/pool/service and mobile client/contracts/base64/encrypt/decrypt, but must not import `src/crypto/argon.ts`, `@noble/hashes`, the Worker entry directly, test-only cloud decoder code, stegcloak-rs, or any custom crypto implementation. Confirm the only server substitutes are external auth/settings/OAuth/Mongo seams and that all write/touch methods fail loudly.

Inspect failure cleanup by temporarily placing an assertion after initialization during development: the test process must still exit because `client.abortAll()` and `await kdf.close()` run from `finally`; remove the temporary failure before commit. Confirm the successful run makes one derive request, loads one authenticated account blob, returns `[0,1]`, matches slot zero to the fixture, encrypts with slot one, and decrypts through the ordered two-key array.

Check `docs/REMOTE_KDF_ACCEPTANCE.md` mechanically and manually: exactly 16 ordered `AC-*` rows; explicit Stage 5 automated rows for server/mobile/interop/bridge plus wrong-key/passwordless/busy/offline/stale/malformed/rapid/restart cases; Android and iOS rows covering all architecture/transport physical checks; no `PASS_DEVICE`; every physical row says `PENDING_DEVICE`; and the overall verdict does not claim release completion.
</verification>

<success_criteria>
- `npm run test:remote-kdf-stage5` proves one committed encrypted GoofCord settings blob crosses the real default server decoder, capacity-one self-tested production Worker pool/service, authenticated and secured v2 application, injected strict mobile HTTP client, and unchanged mobile encrypt/parse/decrypt pipeline.
- The server response is accepted only through the mobile contract, returns exact contiguous slots `[0,1]`, matches the canonical first vector key, and the returned second-slot key round-trips plaintext while keys remain in exact server order.
- The test uses no external service/database and always closes its client/Worker state; ordinary `npm test`, server `bun test`, mobile build/typecheck, fixture equality, and reference cleanliness remain green.
- Stage 5 changes no production source, server/reference code, fixture, dependency, lockfile, or existing test behavior and duplicates no cryptographic or already-direct negative automation.
- The acceptance ledger maps all 16 architecture criteria and every automated Stage 5 case to direct evidence and commands, specifically including wrong-key, passwordless, busy, offline, stale, malformed, rapid, and restart-cache behavior.
- Every real-device authentication/session/rapid/error/offline/restart UX check and Android/iOS redirect/abort/body-bound/capability check remains `PENDING_DEVICE`; the document reports automated completion separately and does not claim shipment readiness.
</success_criteria>

<output>
Create `.planning/quick/260718-wiq-stage-5-automated-verification-add-a-syn/260718-wiq-SUMMARY.md` after execution.
</output>
