---
quick_id: 260718-tyu
phase: quick
plan: 260718-tyu
type: execute
wave: 1
depends_on: [260718-s4o]
status: planned
description: Stage 4 - wire remote KDF into Kettu incoming and outgoing cold paths with structural gating, shared per-channel work, safe retry, and no silent fallback
autonomous: true
requirements: [REMOTE-KDF-STAGE-4]
files_modified:
  - src/settings.ts
  - src/core/decrypt.ts
  - src/core/remoteKeycache.ts
  - src/cloud/client.ts
  - src/cloud/remoteKdf.ts
  - src/discord/remoteColdPath.ts
  - src/discord/flux.ts
  - src/discord/send.ts
  - src/ui/Settings.tsx
  - src/discord/commands.ts
  - src/index.ts
  - tests/harness.ts
  - tests/remoteKdfStage4.ts
  - docs/REMOTE_KDF_MOBILE_TRANSPORT.md
  - README.md
must_haves:
  truths:
    - "Pre-Stage4 storage migrates to an explicit manual key-source mode by default; remote mode is a deliberate persisted selection with its own non-secret send-slot index, and every incoming/outgoing branch uses exactly one source so a remote miss/error can never call manual password lookup, manual keycache, local Argon, or plaintext fallback"
    - "Before any remote cache miss can start network work, incoming content must decode through the existing ZWC alphabet into a supported complete frame of at least version byte plus 24-byte nonce plus 16-byte tag; plain text, a lone ZWC, short frames, and unsupported versions cause no pending entry, cooldown change, toast, or request"
    - "Remote incoming hot-path decryption is synchronous and tries every strictly loaded remote set newest-to-oldest and every key within each set in exact server slot order, including decrypt-only historical revisions; remote outgoing hot-path encryption is synchronous only with the explicitly selected slot from the current send-capable revision and never chooses an old or different slot implicitly"
    - "Remote derivation has one Promise per internal (configuration generation, authoritative revision, channelId) operation shared by current-message, history-load, and rapid-send callers; a revision change may form a new operation while the old response remains subject to the Stage 3 generation/epoch/order commit gate, and no pending structure stores outgoing plaintext, message arguments, or an orig/replay callback"
    - "Incoming misses retain at most 200 exact `{messageId:string,channelId:string,ciphertext:string}` snapshots per operation and nothing else, replacing duplicate IDs with their newest snapshot; after a commit-approved derive each current/old cached key is retried locally and each success redispatches exactly `{type:\"MESSAGE_UPDATE\",channelId:snapshot.channelId,message:{id:snapshot.messageId,channel_id:snapshot.channelId,content:markedPlaintext}}`, while failures remain ciphertext and all waiting state clears"
    - "Server/network/protocol derive failures enter a fixed 30000 ms per-operation cooldown that blocks history/event storms without another request; REMOTE_STALE and local not-configured/key-required/unsupported failures do not poison a corrected generation, explicit user refresh bypasses cooldown, and key/config/revision/cache changes or expiry allow safe retry without retaining raw errors"
    - "The production send/edit wrapper remains `vendetta.patcher.instead`, and a fresh five-minute authoritative revision is a hard send prerequisite: a current selected key encrypts synchronously, while a cold/stale branch passes only channel ID and a validated slot to fire-and-forget preparation whose completion is caught internally, then immediately returns a distinct rejected Promise carrying fixed stable code `REMOTE_SEND_REJECTED`; the preparation Promise is never returned or replayed"
    - "On an outgoing attempt, invalid persisted keySource or remoteSendSlot performs no work: zero manual lookup/Argon calls, zero remote preparation/network calls, and zero orig calls, with a fixed safe rejection and byte-identical content; invalid keySource also leaves incoming ciphertext untouched, while all missing-key, invalid-token, missing-settings, passwordless-cloud, wrong-cloud-key, busy, unavailable, timeout, unsupported, stale, cooldown, unavailable-slot, and malformed-response paths fail closed without secret reflection"
    - "The shared cold-path coordinator bounds waiting messages, de-duplicates duplicate message events and send notifications, preserves stable multi-slot order, and reports only aggregate counts; official mode changes call both its reset and `invalidateRemoteOperations()`, which aborts active remote requests, advances every commit/lifecycle gate, clears revision/derive pending state, cooldown and verification/readiness, and preserves cloud key, host/token, and both persistent caches"
    - "Settings and /encrypt visibly expose manual versus remote operational mode and the remote send slot without accepting remote secrets in commands; selecting/forgetting/clearing remote configuration never silently switches to manual, existing manual on/off/toggle/cycle/set/import behavior remains intact when manual is selected, and documentation accurately describes cached restart behavior, reject/resend, cooldown, and the Stage 5 device gate"
    - "All message framing, AEAD, compression, ZWC encoding, Argon2 parameters, and stegcloak-rs byte compatibility remain unchanged; the Hermes bundle stays eval-safe/class-free/generator-free, the server/reference trees remain unchanged, and deterministic rapid-event tests prove no local Argon or plaintext downgrade in remote mode"
  artifacts:
    - path: "src/settings.ts"
      provides: "Null-hostile-safe explicit keySource mode and independent bounded remoteSendSlot selection helpers"
      contains: "remoteSendSlot"
    - path: "src/core/decrypt.ts"
      provides: "Reusable structural cloaked-frame parser plus stable ordered remote-key decrypt primitive"
      contains: "parseCloakedPayload"
    - path: "src/core/remoteKeycache.ts"
      provides: "Strict selected current send-key accessor while retaining ordered current/old decrypt sets"
      contains: "getRemoteSendKey"
    - path: "src/cloud/remoteKdf.ts"
      provides: "Revision-keyed derive sharing, conservative send preparation, fixed failure cooldown, and mode-change operation invalidation without cache/credential loss"
      contains: "REMOTE_FAILURE_COOLDOWN_MS"
    - path: "src/discord/remoteColdPath.ts"
      provides: "Exact three-string incoming snapshots/redispatch and internally caught outgoing notification preparation that never holds outgoing text"
      contains: "MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION"
    - path: "src/discord/flux.ts"
      provides: "Mode-exclusive synchronous manual/remote receive branches with structural preflight before remote cold work"
      contains: "queueRemoteDecrypt"
    - path: "src/discord/send.ts"
      provides: "Mode-exclusive vendetta.patcher.instead wrapper with immediate stable rejection distinct from fire-and-forget preparation"
      contains: "prepareRemoteSend"
    - path: "src/ui/Settings.tsx"
      provides: "Explicit live key-source and remote send-slot controls with fail-closed explanatory UX"
      contains: "Remote message mode"
    - path: "src/discord/commands.ts"
      provides: "Secret-free mode selection, remote slot cycling, and mode-aware enable/status behavior"
      contains: "mode-remote"
    - path: "tests/remoteKdfStage4.ts"
      provides: "Deterministic structural, cache-order, pending/waiting, rapid-send, cooldown, lifecycle, failure, and no-fallback tests"
      contains: "REMOTE_FAILURE_COOLDOWN_MS"
  key_links:
    - from: "src/settings.ts"
      to: "src/discord/flux.ts"
      via: "the exact keySource value selects one incoming branch; remote never falls through to getPasswordList/deriveKey"
      pattern: "keySource|remote"
    - from: "src/settings.ts"
      to: "src/discord/send.ts"
      via: "the exact keySource and validated remoteSendSlot choose one branch; invalid values reject with zero manual, remote, network, or orig calls"
      pattern: "remoteSendSlot|keySource"
    - from: "src/discord/flux.ts"
      to: "src/core/decrypt.ts"
      via: "parseCloakedPayload proves frame length/version before queueing, then ordered remote decryption handles synchronous hits and post-derive retries"
      pattern: "parseCloakedPayload|decryptWithRemoteKeys"
    - from: "src/discord/flux.ts"
      to: "src/discord/remoteColdPath.ts"
      via: "only structurally valid misses normalize to exactly messageId/channelId/ciphertext and successful retries emit the frozen minimal MESSAGE_UPDATE action"
      pattern: "queueRemoteDecrypt"
    - from: "src/discord/send.ts"
      to: "src/cloud/remoteKdf.ts"
      via: "an instead patch reads a fresh selected key synchronously; otherwise it queues scalar-only caught preparation and immediately returns a distinct REMOTE_SEND_REJECTED Promise"
      pattern: "patcher.instead|prepareRemoteSend|REMOTE_SEND_REJECTED"
    - from: "src/discord/remoteColdPath.ts"
      to: "src/cloud/remoteKdf.ts"
      via: "incoming and outgoing coordinators obtain the same per-generation/revision/channel Promise and stable cooldown result"
      pattern: "ensureRemoteChannelKeys|remoteOperationKey"
    - from: "src/discord/commands.ts"
      to: "src/cloud/remoteKdf.ts"
      via: "every official key-source mode change resets the cold coordinator and invalidates active remote operations without clearing configuration, session key, or caches"
      pattern: "invalidateRemoteOperations|resetRemoteColdPath"
    - from: "src/index.ts"
      to: "src/discord/remoteColdPath.ts"
      via: "lifecycle initializes after Stage 3 remote state and closes late callbacks/waiters around transport shutdown and hook removal"
      pattern: "initRemoteColdPath|shutdownRemoteColdPath"
---

<objective>
Implement Stage 4 of `docs/REMOTE_KDF_ARCHITECTURE.md` in the Kettu plugin: connect the verified Stage 3 remote session/coordinator/cache to incoming and outgoing Discord message paths without weakening manual mode, structural gating, revision safety, composer retention, or GoofCord byte compatibility.

Purpose: Make remote derivation operational on cold channels while eliminating the existing per-message Argon storm and ensuring every remote error fails closed. Remote mode must use only remote cached/derived keys, share one channel/revision operation across receive/send events, retry bounded incoming ciphertext locally, and require the user to resend outgoing text after asynchronous preparation.

Output: Explicit key-source/slot settings, structural and ordered remote decrypt primitives, a bounded shared cold-path coordinator, mode-exclusive Flux/send wiring, safe mode UX/commands/lifecycle, and deterministic rapid-event/no-downgrade coverage. Stage 5 real-device redirect/abort/device UX evidence remains separate.
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
@src/cloud/remoteKdf.ts
@src/core/remoteKeycache.ts
@src/core/decrypt.ts
@src/core/encrypt.ts
@src/core/payload.ts
@src/core/stegcloak.ts
@src/stego/zwc.ts
@src/discord/flux.ts
@src/discord/send.ts
@src/settings.ts
@src/discord/commands.ts
@src/index.ts
@tests/harness.ts
</context>

<constraints>
- Treat all locked architecture decisions, Stage 4 cold flows, prior Stage 1-3 verified contracts, and the current server stable-code mapping as canonical. Byte-exact GoofCord/stegcloak-rs interoperability wins over convenience or retry behavior.
- Use verified Stage 3 documentation HEAD `b795be7101c3a289928e2bd225fd3bd9745c1fb0` as the immutable Stage 4 mobile implementation baseline for protected-file diff gates; do not substitute `HEAD^`, because execution creates multiple task commits.
- Make changes only in `kettu-goofcrypt`. Keep `goofcord-cloudserver`, `stegcloak-rs`, and nested GoofCord read-only and clean. Preserve user-owned `CLAUDE.md`/`AGENTS.md` changes and planning artifacts outside the implementation commits.
- Add an explicit persisted key-source choice with absent pre-Stage4 state migrating to `manual`. Never infer remote mode from configured credentials/cache/readiness and never change modes automatically on save, clear, forget, failure, restart, or cache hit. Invalid persisted mode/slot values fail closed until an explicit valid selection; they do not silently choose manual or slot zero.
- On outgoing interception, invalid keySource or remoteSendSlot is inert: do not call any manual getter/derive, remote cache/preparation/revision/network API, or `orig`; show only fixed safe text, return a fixed stable-code rejection, and preserve `message.content` byte-for-byte. Incoming remote decryption does not consult the send slot, while invalid keySource leaves incoming ciphertext untouched.
- Manual and remote branches are mutually exclusive after the mode check. In remote mode do not call `chosenPassword`, `getPasswordList`, `getCachedKey`, `deriveKey`, `passwordId`, manual imports/winner hints, or any local Argon path; in manual mode do not call remote revision/derive/cache APIs. Existing manual command and hook semantics remain the default and are regression-tested.
- Decryption is always local. Remote service requests contain only the already-frozen cloud key/channel contract and return only keys; never send Discord content, message IDs, payload frames, ciphertext, plaintext, nonce, tag, cover, mark, or outgoing callback state to the server.
- Perform the cheap structural gate before creating/joining remote work. Use the existing `extract` plus `unframe`/AEAD constants so minimum length and version cannot drift; do not duplicate the ZWC alphabet, frame sizes, or version number in an adjustable setting.
- Remote incoming hot paths may use all strict cached revisions for decryption, newest set then exact slot order. Remote outgoing hot paths may use only the exact selected slot from `getRemoteSendKeys` when that set remains current/send-capable and revision freshness is inside the fixed Stage 3 TTL. Never use historical keys to send and never silently choose another slot.
- Preserve the Stage 3 configuration-generation, mutation-epoch, request-order, and starting-revision commit gates. Change derive coalescing only to represent the required configuration/revision/channel identity; old responses remain unable to cache, verify, redispatch, or restore send capability after newer state.
- Freeze a short 30000 ms client cooldown. Cooldown stores only operation identity, deadline, and stable code/category; it never stores Error/message/body/token/key/revision in output. Explicit setup refresh bypasses it, `REMOTE_STALE` is immediately retryable under the new operation identity, and local precondition failures that performed no derive request do not become worker-hammer cooldowns.
- Bound incoming waiting state at 200 snapshots per operation. The only permitted snapshot shape is `{ messageId: string, channelId: string, ciphertext: string }`; never retain/spread the Discord message or payload. De-duplicate IDs by replacing with the newest exact snapshot. A successful retry dispatches exactly `{ type: "MESSAGE_UPDATE", channelId: snapshot.channelId, message: { id: snapshot.messageId, channel_id: snapshot.channelId, content: markedPlaintext } }` with no extra fields. Overflow leaves additional ciphertext untouched and launches no extra request.
- Keep the production send/edit hook as `vendetta.patcher.instead`; a `before` patch cannot cancel the original and is forbidden for this boundary. Outgoing preparation accepts only channel ID and a validated remote slot, catches completion internally, and is launched fire-and-forget. The instead callback must immediately return a separate `Promise.reject(new RemoteKdfError("REMOTE_SEND_REJECTED"))`, never the preparation Promise, without storing message content, message objects, arguments, `this`, `orig`, or replay closures. Only a new explicit user send may encrypt/call `orig`.
- On every official manual/remote mode change, call both `resetRemoteColdPath()` and `invalidateRemoteOperations()`. The latter aborts the active client's requests; advances configuration/lifecycle generation plus mutation epoch/request-order gates; clears revision/derive pending maps, cooldowns, and verification/readiness; suppresses all late commits; and preserves the session cloud key, remote host/token, persistent remote cache, and manual passwords/cache. Switching back may use an otherwise-valid hot cache, but any required cold preparation must be a fresh operation.
- Show only fixed safe user messages via `remoteErrorMessage`/new stable local codes. Do not pass caught remote values into `vendetta.logger`, `noteError.lastError`, toasts, replies, debug hooks, status, or dispatch payloads. Waiting state/operation keys are internal and never printed.
- Preserve Hermes constraints and dependencies: no new package, native/WASM/worker, runtime Buffer/TextEncoder assumption, class/generator syntax in built output, unsafe Map/Set `for...of` lowering, or automatic plaintext replay. Use Array.from plus index loops for Map/Set snapshots.
- Do not change `src/crypto/argon.ts`, `src/crypto/aead.ts`, `src/crypto/deflate.ts`, `src/core/encrypt.ts`, `src/core/payload.ts`, `src/core/stegcloak.ts`, or `src/stego/zwc.ts` unless a failing compatibility test proves an unavoidable need; the plan's structural/decrypt refactor can be completed in `src/core/decrypt.ts` using their existing exports.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Define explicit key-source/slot state and structural ordered remote hot-path primitives</name>
  <files>src/settings.ts, src/core/decrypt.ts, src/core/remoteKeycache.ts, tests/remoteKdfStage4.ts, tests/harness.ts</files>
  <behavior>
    - Missing pre-Stage4 fields initialize as `keySource:"manual"` and `remoteSendSlot:0` without null writes or changing passwords, chosenIndex, manual keys/imports, remote cache/config, enabled state, or unrelated settings. Exact helpers accept only `manual|remote` and integer slots 0-7; corrupt present values return an invalid/fail-closed state rather than selecting another source/slot.
    - `parseCloakedPayload(content)` returns a framed nonce/ctAndTag only when the content contains recognized ZWC data whose extracted bytes pass existing `unframe`: minimum 41 bytes and supported version. Plain cover text, any lone/short ZWC sequence, and a complete wrong-version frame return null without throwing.
    - Existing manual `decryptWithCachedKeys` retains password winner ordering but reuses the structural parser. A new remote decrypt function accepts the parsed frame and `RemoteDecodedKeySet[]`, tries sets in supplied newest-to-oldest order and keys in exact array slot order, skips authentication failures, and returns plaintext on the first authenticated/decompressed key without any password/passwordId lookup.
    - `getRemoteSendKey(channelId, slot)` validates the exact integer slot and returns a defensive 32-byte copy only from the current head when `sendCapable` and `settingsRevision===currentRevision`; old sets, invalid slots, corrupt keys, missing channels, and demoted current data return null. Existing all-revision decrypt access remains unchanged and immutable.
  </behavior>
  <action>
    Create `tests/remoteKdfStage4.ts` first and import/await it from the harness. Add focused section tests before implementation: pre-Stage4/manual migration through the null-hostile proxy; exact/invalid key-source and slot setters; manual subtree deep equality; plain, lone-ZWC, short, exact-minimum, and wrong-version structural cases built with existing conceal/frame helpers; manual cached decrypt regression; current slot-1 remote decrypt; fallback to ordered historical sets; multi-slot order; corrupt authenticated plaintext behavior; current selected send key; old/demoted/out-of-range non-send cases; and immutable returned arrays.

    Extend `Settings` with primitive `keySource` and `remoteSendSlot` defaults plus named strict accessors/setters. Do not reuse `chosenIndex` or infer mode from Stage 3 configuration. Absent fields are the only case that defaults; if a present runtime value is invalid, surface null/invalid to callers so the send branch can reject and receive can leave ciphertext untouched. Keep settings independent of Discord/cloud modules.

    Refactor `core/decrypt.ts` around one exported `ParsedCloakedPayload` and `parseCloakedPayload` using existing `isCloaked`, `extract`, and `unframe`. Keep AEAD/decompress/UTF-8 behavior byte-identical. Add a small key-attempt helper so manual and remote wrappers share authenticated decompression semantics without merging identity/winner state. Remote results contain only text (and, if tests need it, non-secret set/slot indices), never key/revision/password output. Add the selected send-key accessor to `remoteKeycache.ts`, revalidating/copying exactly as existing accessors do.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt &amp;&amp; npm test &amp;&amp; npm exec tsc -- --noEmit &amp;&amp; git diff --check</automated>
  </verify>
  <done>Manual remains the explicit migrated default, invalid mode/slot state fails closed, malformed cloaked content has a reusable exact structural gate, remote incoming can synchronously try ordered current/old keys, and remote sending can retrieve only one explicit current send-capable slot.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build revision-keyed preparation, cooldown, and the bounded shared cold-path coordinator</name>
  <files>src/cloud/client.ts, src/cloud/remoteKdf.ts, src/discord/remoteColdPath.ts, tests/remoteKdfStage4.ts</files>
  <behavior>
    - Derive coalescing keys each request by internal configuration generation, starting authoritative revision (including an explicit unknown state), and channel ID. Same-operation callers receive the same Promise/network request; a changed revision/config/key can start a distinct operation, while the existing generation/epoch/revision/order gate still decides the sole valid cache/readiness commit.
    - `ensureRemoteChannelKeys(channelId)` is the cold-path API. It shares the revision-keyed derive, records a 30000 ms cooldown only for actual server/network/timeout/protocol derive failures, returns stable `REMOTE_COOLDOWN` without networking inside the window, clears expired entries, and does not cool down local `REMOTE_NOT_CONFIGURED`, `REMOTE_KEY_REQUIRED`, `REMOTE_UNSUPPORTED`, or `REMOTE_STALE`. Explicit `refreshRemoteChannel` always bypasses cooldown but still joins an identical active derive.
    - `getFreshRemoteSendKey(channelId,slot)` is synchronous and returns only a current selected key while Stage 3 revision freshness is true. `prepareRemoteSend(channelId,slot)` coalesces rapid callers, first awaits `ensureRemoteRevisionFresh`, rechecks the selected current key, derives through the shared cold path only on a true current miss, and finally requires that exact slot or returns stable `REMOTE_SLOT_UNAVAILABLE`; it never returns/stores plaintext or a send callback.
    - `invalidateRemoteOperations()` aborts active client requests, increments `configGeneration`, advances mutation epoch/request order, clears revision/derive pending maps and all cooldowns, clears remote verification/readiness, and preserves the current client/configuration, host/token, memory-only cloud key, persistent remote cache, and manual state. Every pre-invalidation settlement fails the existing commit gates and cannot update cache/readiness/status counts.
    - A factory-testable `RemoteColdPath` owns bounded incoming waiters and one completion observer per operation. Its waiter value is exactly `{messageId:string,channelId:string,ciphertext:string}`; it stores at most 200, replaces duplicate IDs with the newest exact value, retries cached remote decryption after derive, marks before dispatch, and emits exactly `{type:"MESSAGE_UPDATE",channelId:snapshot.channelId,message:{id:snapshot.messageId,channel_id:snapshot.channelId,content:markedPlaintext}}` with no spread/extra fields. Failure/overflow leaves ciphertext untouched.
    - The same coordinator de-duplicates outbound readiness notification per channel/slot preparation. Its public outbound method accepts only channel ID and validated slot, owns and catches the preparation Promise internally, returns only a synchronous started/joined indication (never that Promise), shows at most one safe ready/error toast, and never calls/holds `orig` or automatically invokes a send. Reset/shutdown prevents late dispatch/toast and clears all waiting/notification/re-entrancy state.
  </behavior>
  <action>
    Add deterministic fake-clock/deferred-client tests first. Prove exact Promise identity and one derive for many same-channel/revision callers; incoming plus send sharing; a new revision/config/key operation not joining the old; old late settlement rejected by the Stage 3 commit gate; explicit refresh bypass; cooldown at 0/29999/30000 ms; no cooldown for local preconditions/stale; key/config/cache reset; revision-first send preparation; unchanged revision cache hit without derive; changed revision global demotion plus one derive; selected-slot failure; and revision failure refusing a cached key. Start deferred revision/derive work, call `invalidateRemoteOperations()`, and prove abort was requested, pending/cooldown counts become zero immediately, verification clears, cloud key/config/token/caches remain deep-equal, late success cannot cache/verify, and a later cold call starts a new Promise/network request.

    Extend the client stable local-code union and safe message table only with bounded non-reflective `REMOTE_COOLDOWN`, `REMOTE_SLOT_UNAVAILABLE`, and `REMOTE_SEND_REJECTED` codes. In `remoteKdf.ts`, create one internal operation-key helper and use it consistently for derive in-flight state, cooldown, and tests without exposing its channel/revision contents through status/errors. Preserve `configGeneration`, `mutationEpoch`, `nextRequestOrder`, `lastAppliedOrder`, and conditional stale-failure verification logic exactly. Add injected `now` coverage, prune cooldowns, clear all new state in configuration/key/cache/init/shutdown paths, and implement/export `invalidateRemoteOperations()` with the exact preservation/invalidation contract above. Expose only safe aggregate cooldown/pending counts if status is extended.

    Implement `discord/remoteColdPath.ts` as a small factory with injected ensure/prepare/decrypt/cache/dispatch/toast/mode dependencies for Node tests and a production singleton initialized by Task 3. Use Map storage but snapshot with `Array.from` and index loops for Hermes. Normalize CREATE/UPDATE/history inputs immediately into the exact three-string snapshot; store no original payload/message reference and no outgoing content. Preserve insertion order, replace duplicate IDs, emit the exact minimal action above, and keep completed-ID re-entrancy state bounded/cleared with lifecycle. The outbound method must attach both fulfillment and rejection handlers internally before returning its synchronous indication so no unhandled rejection or caller closure is possible; never log raw values.

    Drive the factory with batches of 50 duplicate/mixed CREATE/UPDATE/history-like entries: cover top-level `payload.channelId`, `message.channel_id`, and history fallback extraction; assert stored snapshots have exactly the three named keys, duplicate replacement uses newest ciphertext, and successful dispatch deep-equals the frozen minimal action with no full-message/extra fields. Require one dispatch per successful unique ID, none for an undecryptable item, and no request/entry for structural rejects. Test rapid outbound preparations share one promise/notification, accept only `(channelId,slot)`, catch completion internally, and cannot replay. Test coordinator reset plus `invalidateRemoteOperations()` and unload before deferred completion produce zero late cache/verification/dispatch/toast, zero pending/cooldown counts, and fresh work after switching back.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt &amp;&amp; npm test &amp;&amp; npm exec tsc -- --noEmit &amp;&amp; git diff --check</automated>
  </verify>
  <done>One generation/revision/channel operation is shared across incoming and outgoing callers, actual failures are rate-damped without blocking corrected state or explicit refresh, waiters are bounded and retried locally once, and outgoing readiness has no technical path to retain or replay text.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire mode-exclusive Flux/send paths and expose safe operational UX/lifecycle</name>
  <files>src/discord/flux.ts, src/discord/send.ts, src/ui/Settings.tsx, src/discord/commands.ts, src/index.ts, tests/remoteKdfStage4.ts, docs/REMOTE_KDF_MOBILE_TRANSPORT.md, README.md</files>
  <behavior>
    - Flux parses structural content once before remote work. In manual mode valid content follows the existing cached/local-background flow only. In remote mode it synchronously tries all cached remote sets and either mutates a hot-hit in place or queues the bounded shared operation; no remote miss can reach manual passwords/Argon, and invalid mode leaves ciphertext untouched.
    - MESSAGE_CREATE, MESSAGE_UPDATE, and LOAD_MESSAGES_SUCCESS normalize only `{messageId,channelId,ciphertext}` using top-level channel ID then `message.channel_id` fallback and de-duplicate IDs by newest ciphertext. After remote success, each locally decrypted waiter emits the exact minimal marked MESSAGE_UPDATE action frozen in Task 2; failures remain untouched and MESSAGE_START_EDIT mark removal remains unchanged.
    - Production send/edit registration remains `vendetta.patcher.instead`, never `before`. The instead callback branches once on exact mode. Manual mode retains current behavior; remote hot mode encrypts/calls orig once. Remote cold/stale mode passes only channel ID and validated slot to internally caught fire-and-forget preparation, then immediately returns a distinct `REMOTE_SEND_REJECTED` rejected Promise before preparation settles. It never returns the preparation Promise.
    - Invalid keySource or remoteSendSlot is handled before any source/cache/preparation call: zero manual calls, zero remote calls/network, zero orig, fixed safe toast/rejection, and byte-identical input content. Valid rapid remote send attempts plus a simultaneous incoming miss issue one derive, reject every current send immediately, preserve every text, and generate one completion notice. Resolution never calls orig; only a later explicit resend encrypts/calls orig.
    - Settings and commands make `manual` versus `remote` explicit, display the 0-7 remote send slot, and on each actual official mode change call `resetRemoteColdPath()` then `invalidateRemoteOperations()` without clearing cloud key, host/token, remote cache, or manual state. `mode-remote` never imports a token/key argument; `remote-slot-next` cycles only within the current strict send-key count and fails safely without cache. Manual `cycle`, `set`, and `import` remain manual state only.
    - `/encrypt on|toggle` requires a manual password only in manual mode; remote mode never warms local Argon and may remain selected across restart/forgotten key so valid cached keys can work, while cold/stale sends fail closed until setup is repaired. Forget/clear never auto-switches to manual. Status shows only mode, slot, aggregate pending/waiting/cooldown state, Stage 3 redacted status, and existing safe manual counts.
    - Plugin load initializes the cold coordinator after settings/manual/remote cache and before hooks. Unload first closes late callbacks, then aborts Stage 3 transport, unpatches hooks, clears all waiting/pending/cooldown/re-entrancy state, and ignores every late promise settlement without unhandled rejection. A mode switch performs the lighter cache/config/session-preserving invalidation and switching back starts a new cold operation rather than joining pre-switch work.
  </behavior>
  <action>
    Refactor Flux/send with dependency-injected handler/interceptor factories so the custom harness can count manual derive calls, remote prepares, `orig`, dispatch, and toasts. Also inject a minimal patcher stub into the production registration seam and assert send/edit register with `instead` only: a `before` registration is a test failure. Invoke the captured instead callback with realistic send/edit argument positions. Tests must cover manual-default regression, remote hot incoming current and historical keys, remote cache miss, malformed structural no-request, exact CREATE/UPDATE/history normalization and dispatch shape, mode change during derive, every stable server/client failure, and absence of raw markers from output.

    For send and edit, use a deferred preparation that remains unresolved. Prove the captured instead callback starts it with exactly `(channelId, validatedSlot)`, returns a different Promise, and that returned Promise rejects with only `REMOTE_SEND_REJECTED` while preparation is still pending; `orig` remains zero and content stays equal before/after rejection and eventual readiness. Cover fresh slots 0/1; stale TTL; demoted/old-only cache; missing key/config; unsupported; every stable server/client error; and 20 rapid attempts plus an incoming miss. For invalid/missing keySource and slot, assert manual getter/derive, remote cache/preparation/revision/network, toast raw-detail, and orig counters are all zero except one fixed safe user rejection/toast. Finally prove explicit resend alone calls orig once with encrypted content, while RNG/message-too-long failures retain existing no-send behavior.

    Extend settings UI with an explicit `Remote message mode` control and validated remote slot field/cycle action. Make the copy state that manual is default, sources never fall back, remote cold sends are rejected with text kept, cached incoming/current-fresh keys can work after restart, and the session cloud key is required only when a derive is needed. Route actual mode transitions through one helper that first persists the valid mode, then resets `RemoteColdPath` and calls `invalidateRemoteOperations()`; prove cloud key/config/token and both caches remain deep-equal. Config/key/cache/forget handlers retain their stronger existing invalidations and never silently change mode.

    Add `mode-manual`, `mode-remote`, and `remote-slot-next` to the existing action picker without secret arguments and reuse the same official mode-transition helper as UI. Make on/toggle/cycle/status mode-aware while preserving manual behavior. Use only fixed remote messages. Wire cold-path init/shutdown in `index.ts`, ensuring callbacks close before Stage 3 abort and existing unload remains best-effort/idempotent. A deferred mode-switch test must prove the late response cannot cache, verify, dispatch, toast, or leave pending/cooldown counts, while switching back on a cold channel creates fresh work.

    Update README from the Stage 3 preview to explicit Stage 4 opt-in operation: manual default, mode/slot selection, synchronous cache hits, current-versus-old policy, structural receive gate, shared pending work, incoming retry, 30-second cooldown, outgoing reject/text-kept/manual resend, no automatic replay/fallback, session-key/cached-restart behavior, and actionable errors. Update the transport document without marking the Stage 5 Android/iOS redirect/abort/body-mode checklist complete.
  </action>
  <verify>
    <automated>cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt &amp;&amp; npm test &amp;&amp; npm run build &amp;&amp; npm exec tsc -- --noEmit &amp;&amp; git diff --check &amp;&amp; cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json &amp;&amp; git diff --exit-code b795be7101c3a289928e2bd225fd3bd9745c1fb0 -- src/crypto/argon.ts src/crypto/aead.ts src/crypto/deflate.ts src/core/encrypt.ts src/core/payload.ts src/core/stegcloak.ts src/stego/zwc.ts &amp;&amp; test -z "$(git -C ../stegcloak-rs/GoofCord status --short)" &amp;&amp; cd ../goofcord-cloudserver &amp;&amp; bun run typecheck &amp;&amp; bun test</automated>
  </verify>
  <done>Explicit remote mode now uses cached keys synchronously and one bounded remote cold operation safely: incoming successes retry/redispatch, outgoing attempts reject and retain text until manual resend, all errors/cooldowns fail closed, manual mode remains distinct/default, and full Hermes/GoofCord/server compatibility gates pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| persisted mode/slot -> live hooks | Corrupt or ambiguous source selection must not silently choose manual, another remote slot, or plaintext behavior |
| Discord content -> remote work | ZWC presence alone is attacker-controlled; only a supported complete frame may create pending derive work |
| cache revision/slot -> outgoing encryption | Only one explicit current send-capable key under a fresh authoritative revision may encrypt a send |
| rapid Flux/send events -> remote client | Same channel/revision events must share work; distinct callbacks must not multiply requests, toasts, or replay sends |
| pending incoming state -> redispatch | Only the exact three-string normalized snapshot may wait, and only authenticated local success may emit the frozen minimal MESSAGE_UPDATE shape |
| remote failure -> retry behavior | Wrong key, busy, unavailable, malformed responses, and history storms must be cooldown-bounded without blocking corrected generations |
| outgoing composer -> async preparation | The instead patch must immediately return its own stable rejection while scalar-only preparation is caught internally; plaintext/orig must never enter pending state |
| lifecycle/mode change -> late promise | Reset plus invalidateRemoteOperations must abort and gate old work without deleting configuration, session key, or persistent caches |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-RKDF-S4-01 | Elevation / downgrade | key-source branch | critical | mitigate | exact explicit persisted mode, manual default only for absent migration, and invalid mode/slot produces zero manual/remote/network/orig calls |
| T-RKDF-S4-02 | Denial of service | malformed/history ZWC | critical | mitigate | exact structural frame preflight, per-operation dedup, 200-waiter bound, fixed cooldown, server rate/concurrency limits |
| T-RKDF-S4-03 | Tampering | stale/current send key | critical | mitigate | five-minute revision prerequisite, current/sendCapable/slot-only accessor, global demotion, no old-slot fallback |
| T-RKDF-S4-04 | Information disclosure | outgoing async state | critical | eliminate | retain `patcher.instead`; scalar-only caught preparation plus a distinct immediate REMOTE_SEND_REJECTED Promise; no message/orig storage or replay |
| T-RKDF-S4-05 | Tampering | late derive/revision races | critical | mitigate | generation/revision/channel identity, preserved Stage 3 gates, and explicit cache-preserving operation invalidation on mode change |
| T-RKDF-S4-06 | Spoofing / integrity | incoming redispatch | high | mitigate | exact three-string waiter, strict local retry, exact minimal action, authenticated/decompressed success only, mark before dispatch |
| T-RKDF-S4-07 | Information disclosure | status/log/toast/health | high | mitigate | stable code-to-message only, aggregate counts, marker audits, no operation identity/channel/body/error reflection |
| T-RKDF-S4-08 | Repudiation / duplicate action | rapid sends | high | mitigate | reject every cold attempt, one readiness notification, zero orig calls until a new explicit user resend |
| T-RKDF-S4-09 | Compatibility | crypto/stego pipeline | critical | mitigate | unchanged framing/AEAD/Deflate/ZWC/Argon files, real stegcloak-rs harness, shared vector and server suites |
</threat_model>

<verification>
Run after all three tasks:

```bash
cd /mnt/e/backup/code/personal/oss/kettu-goofcrypt
npm test
npm run build
npm exec tsc -- --noEmit
git diff --check
cmp tests/fixtures/remoteKdf/argon2id-v1.json ../goofcord-cloudserver/test/fixtures/remoteKdf/argon2id-v1.json

# Stage 4 may change Flux/send/decrypt, but not the byte protocol/KDF primitives.
git diff --exit-code b795be7101c3a289928e2bd225fd3bd9745c1fb0 -- \
  src/crypto/argon.ts src/crypto/aead.ts src/crypto/deflate.ts \
  src/core/encrypt.ts src/core/payload.ts src/core/stegcloak.ts src/stego/zwc.ts

test -z "$(git -C ../stegcloak-rs/GoofCord status --short)"

cd ../goofcord-cloudserver
bun install --frozen-lockfile
bun run typecheck
bun test
git diff --check
```

Audit the mobile diff and generated bundle for any remote branch that can call manual password/keycache/Argon APIs; any invalid mode/slot path with nonzero manual/remote/network/orig work; any send/edit registration other than `vendetta.patcher.instead`; any cold branch returning its preparation Promise instead of a distinct immediate `REMOTE_SEND_REJECTED`; any old/demoted/unselected key used for sending; any remote request before structural framing; any outgoing message/content/args/orig retained by a pending closure; any incoming waiter outside the exact three-string shape or redispatch with extra/missing fields; automatic replay; raw remote exception; unbounded maps; mode invalidation that loses cloud key/config/token/cache or permits a late commit; runtime Buffer/TextEncoder; or surviving class/generator/iterator syntax.

Exercise deterministic tests with injected patcher, deferred revision/derive/preparation promises, and fake clock. Confirm: plain/lone/short/wrong-version ZWC causes zero remote work; current/old multi-slot decrypt order; exact CREATE/UPDATE/history snapshot normalization and minimal action; selected current-only send; 50 history events plus 20 sends share one derive; duplicate IDs use newest ciphertext and dispatch once; overflow is inert; cooldown boundaries and reset paths; invalid mode/slot has zero work; the instead-return rejection settles while preparation remains pending and is not the same Promise; revision failure blocks cached sending; mode invalidation aborts and gates late cache/readiness/dispatch/toast while preserving secrets/config/caches and allowing fresh work after switching back; unload prevents late work; no replay occurs; explicit resend encrypts exactly once; and remote-mode manual counters stay zero.

Confirm README/UI/commands never claim remote failure falls back, never put token/cloud key in command state, and leave the Stage 5 real-device redirect/AbortController/response-mode checklist pending. Confirm server/reference worktrees remain clean and the exact shared vector/current stegcloak-rs round-trips still pass.
</verification>

<success_criteria>
- Manual is the absent-storage default and remains behaviorally distinct; explicit remote mode never consults manual passwords/local Argon or silently falls back under any cache/network/key/config error.
- Only structurally valid supported frames can trigger remote work. Remote cache hits decrypt synchronously using every ordered current/old key; current fresh selected keys encrypt synchronously, while old/demoted/unselected keys can never send.
- Same configuration/revision/channel incoming and outgoing events share one derive. Incoming waiters contain only the exact three-string snapshot and successes emit only the frozen minimal MESSAGE_UPDATE; failures leave ciphertext and enter bounded cooldown.
- Every stale/cold remote send uses an `instead` patch, starts internally caught scalar-only preparation, and immediately returns a distinct fixed-code rejection before orig with exact text retained; invalid mode/slot performs zero work, and only explicit resend can later call orig.
- Wrong key, passwordless settings, invalid token, busy worker, unavailable server, timeout, unsupported runtime, malformed response, stale operation, cooldown, and slot errors all have explicit code-only no-downgrade behavior.
- Official mode changes reset the coordinator and invalidate remote operations so late work cannot cache/verify/dispatch/toast or remain counted, while cloud key/config/token and both persistent caches survive and switching back creates fresh cold work; unload remains fully closed/aborted.
- Full deterministic rapid-event tests, Hermes build/typecheck, unchanged crypto/stego diff, stegcloak-rs interop, shared vector, clean reference trees, and full frozen server tests pass; Stage 5 device transport evidence remains correctly pending.
</success_criteria>

<output>
Create `.planning/quick/260718-tyu-stage-4-wire-remote-kdf-into-kettu-incom/260718-tyu-SUMMARY.md` after execution.
</output>
