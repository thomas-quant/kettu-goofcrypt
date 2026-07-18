---
quick_id: 260718-tyu
phase: quick
status: passed
verified: 2026-07-18T23:20:00+01:00
score: 11/11 must-haves verified
behavior_unverified: 0
human_needed: false
gaps_found: 0
requirements_verified: [REMOTE-KDF-STAGE-4]
commits:
  kettu-goofcrypt: 2fe1285a0734b563a6d12dc7b039e0b98519ca84
  goofcord-cloudserver: 0af697eedaa3ae6797071ff60b991c3fa685ea64
reference:
  GoofCord: 16c551c5a6fbdde137e7f13b4dca01883e3a691d
release_device_validation: pending_stage_5
---

# Quick Task 260718-tyu Verification

## Verdict

Stage 4 passes. Mobile commit
`2fe1285a0734b563a6d12dc7b039e0b98519ca84` implements explicit
manual/remote source selection, structural receive preflight, ordered
current-plus-historical local decryption, fresh-current-selected sending, one
shared revision-keyed derive operation, bounded exact incoming retry state,
fixed cooldown, and cancellable outgoing `instead` interception without a
plaintext replay surface.

All eleven must-have truths, ten required artifacts, and eight key links are
present and substantive. Behavior-dependent cancellation, ordering, cooldown,
deduplication, lifecycle, and no-downgrade claims are exercised by the committed
deterministic harness. The rerun passes 163 mobile checks, the class-free Hermes
build/typecheck, the protected crypto/stego and exact fixture gates, and all 82
frozen server tests.

No human-only evidence is required for Stage 4 implementation completeness.
The documented Android Kettu redirect, active-fetch/body abort, response
bounding, and device UX exercises remain the separate Stage 5 release gate;
iOS is not applicable because Kettu has no iOS client. They are not counted as
Stage 4 gaps because the current implementation probes capabilities and fails
closed as `REMOTE_UNSUPPORTED` without a permissive fallback.

## Commit and scope audit

- Mobile HEAD is exactly `2fe1285`; its parent is the required verified Stage 3
  baseline `b795be7101c3a289928e2bd225fd3bd9745c1fb0`.
- The commit changes exactly the fifteen planned implementation, test, and
  documentation files. There are no dependency, lockfile, build-script, server,
  or reference changes.
- The current `README.md`, `docs/`, `src/`, and `tests/` implementation tree is
  byte-identical to commit `2fe1285`. User-owned `CLAUDE.md`, untracked
  `AGENTS.md`, and planning artifacts remain outside the implementation commit.
- Server HEAD remains `0af697e` and the nested GoofCord checkout remains
  `16c551c`; both worktrees are clean after the verification rerun.

## Must-have truth audit

| # | Result | Evidence |
|---:|:---:|---|
| 1 | Pass | `Settings` persists independent `keySource`/`remoteSendSlot`, defaults only absent fields to manual/0, and returns null for corrupt present values (`settings.ts:91-94,111-112,117-128,141-166`). Flux branches once on exact mode before any source work (`flux.ts:120-147`); send validates exact mode/slot before manual or remote calls (`send.ts:61-75`). Remote receive/send tests keep manual/remote counters separate and invalid state inert (`remoteKdfStage4.ts:794-808,849-859,1022-1062,1077-1092`). |
| 2 | Pass | `parseCloakedPayload` uses the existing `isCloaked` -> `extract` -> `unframe` path and returns null on any structural exception (`decrypt.ts:33-41`). Production Flux calls it before remote cache lookup or queueing (`flux.ts:132-147,175-187`). Plain, lone-ZWC, short, wrong-version, exact-minimum, and zero-waiter cases pass (`remoteKdfStage4.ts:183-205,801-809`). No structural rejection reaches remote status, cooldown, toast, or request state. |
| 3 | Pass | Remote decryption iterates supplied sets then keys by ascending index and stops only on authenticated plaintext/corruption (`decrypt.ts:81-95`); cache access returns current plus retained sets in stored order (`remoteKeycache.ts:229-237`). Sending obtains a defensive selected key only from a current/send-capable head (`remoteKeycache.ts:213-227`) and additionally requires supported configured transport plus a revision age inside 300,000 ms (`remoteKdf.ts:412-420`). Multi-slot current, historical fallback, demotion, unavailable slot, revision change, and failed-revision cached-send cases pass. |
| 4 | Pass | The derive key is internal configuration generation + authoritative revision/unknown + channel (`remoteKdf.ts:74-81,143-149`). `ensureRemoteChannelKeys` returns the exact active Promise, while send preparation coalesces by the same operation plus selected slot and ultimately joins the same derive (`remoteKdf.ts:340-389,393-410,423-456`). Tests prove exact Promise identity, one incoming/send derive, 20-send sharing, distinct fresh work after invalidation, and stale late rejection (`remoteKdfStage4.ts:303-341,531-566`). Outgoing pending state contains only internal strings, generation, and Promise; no message, content, args, `this`, `orig`, or replay callback exists (`remoteColdPath.ts:73-76,181-219`). |
| 5 | Pass | Each waiter is copied into the exact three-string interface, duplicate IDs replace their value, the per-operation cap is 200, and completed IDs are capped at 1,000 (`remoteColdPath.ts:22-29,68-70,103-110,146-179`). Success retries local cached decryption and dispatches the exact minimal action without spread fields (`remoteColdPath.ts:112-143,259-273`). Tests deep-compare the minimal action, prove newest duplicate ciphertext, 50-event one-dispatch-per-decryptable-ID behavior, exact snapshot keys, and inert overflow (`remoteKdfStage4.ts:597-662,722-750,821-847`). |
| 6 | Pass | Cooldown is fixed at 30,000 ms and contains only deadline plus stable code under the internal operation key (`remoteKdf.ts:40,64-67,79-81,151-174`). Only actual server/network/timeout/protocol derive failures enter it; local configuration/key/unsupported/stale/slot/send codes are excluded. `ensureRemoteChannelKeys` rejects inside the window without another derive, expiry is pruned, and explicit `refreshRemoteChannel` bypasses cooldown while joining identical active work (`remoteKdf.ts:327-389,392-410`). Fake-clock tests pass at 0/29999/30000 ms, explicit bypass, and local non-cooldown paths (`remoteKdfStage4.ts:437-500`). |
| 7 | Pass | Send and edit register only through `patcher.instead` (`send.ts:141-153,194-203`); there is no send/edit `before` registration. A cold branch calls the scalar-only queue, discards its synchronous indication, then allocates a separate `Promise.reject(RemoteKdfError("REMOTE_SEND_REJECTED"))` (`send.ts:44-52,110-138`). The cold coordinator attaches both preparation handlers internally before returning `started`/`joined` (`remoteColdPath.ts:181-219`). Deferred tests prove the fixed rejection settles while preparation is pending, differs from the preparation surface, preserves text, never calls `orig`, and only a later explicit hot resend encrypts/calls `orig` once (`remoteKdfStage4.ts:925-1020,1064-1075`). |
| 8 | Pass | Invalid mode/slot is checked before reading channel/message content or invoking any manual getter, cache, preparation, network, or `orig`; it emits only fixed text and fixed code with byte-identical content (`send.ts:61-69`). Invalid incoming mode exits before structural/manual/remote work (`flux.ts:120-135`). Every server/client/local remote code and an unknown caught marker map through a fixed non-reflective table (`remoteKdf.ts:511-532`, `remoteColdPath.ts:78-80,181-190`); UI/command remote catches use only that mapping. Counter and marker tests cover invalid state, all stable errors, unknown errors, message-too-long, and RNG/encryption failure. |
| 9 | Pass | The cold coordinator de-duplicates active send notifications by channel/slot, bounds waiting/completed state, and exposes aggregate counts only (`remoteColdPath.ts:92-110,192-244,301-307`). The single official `changeKeySource` helper persists the exact new mode, resets cold state, then calls `invalidateRemoteOperations` (`remoteColdPath.ts:310-318`); both UI and commands use it. Invalidation aborts, clears revision/derive/send/cooldown maps, increments configuration plus mutation/order gates, clears verification, and deliberately preserves client, host/token, cloud key, manual keys, and remote cache (`remoteKdf.ts:125-137,256-267`). Deferred tests prove zero late cache/readiness/dispatch/toast/counts and fresh committable work after switching back. |
| 10 | Pass | Settings visibly provide explicit manual/remote buttons and validated 0-7 slot input, explain manual default/no fallback, reject-and-resend, cached restart, and session-key-on-derive behavior (`Settings.tsx:179-199,221-242,261-320`). Commands add only secret-free `mode-manual`, `mode-remote`, and `remote-slot-next`; slot cycling uses the strict current send-key count, manual cycle/set/import remain manual state, and on/toggle warm Argon only in manual mode (`commands.ts:90-123,131-149,220-240,260-316`). Clear/forget never change mode. README and transport docs accurately record current/old policy, structural preflight, cooldown, no replay/fallback, restart behavior, and the pending Stage 5 gate. |
| 11 | Pass | The seven protected Argon/AEAD/Deflate/encrypt/payload/StegCloak/ZWC files are unchanged from `b795be7`; package/lock/build scripts are also unchanged. The real stegcloak-rs cross-compatibility and exact vector tests pass, and the shared fixture hashes match. `npm run build` produces a 291,085-byte bundle with hash `0e4e946fbcf03aca`; Kettu expression parsing and class/generator/yield/iterator guards pass. The server/reference worktrees are clean and the frozen server suite passes 82/82. |

**Score:** 11/11 truths verified; 0 present-but-behavior-unverified.

## Required artifact audit

| Artifact | Result | Evidence |
|---|:---:|---|
| `src/settings.ts` | Pass | Substantive explicit source/slot state with null-hostile-safe absent-only migration and strict accessors (`remoteSendSlot`, `keySource`). |
| `src/core/decrypt.ts` | Pass | Exports `parseCloakedPayload` and ordered `decryptWithRemoteKeys` while preserving the manual winner path. |
| `src/core/remoteKeycache.ts` | Pass | Exports defensive `getRemoteSendKey` and immutable ordered decrypt sets with current/send-capable enforcement. |
| `src/cloud/remoteKdf.ts` | Pass | Contains `REMOTE_FAILURE_COOLDOWN_MS`, revision-keyed derive sharing, freshness, preparation, cooldown, invalidation, and aggregate status. |
| `src/discord/remoteColdPath.ts` | Pass | Contains `MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION`, exact waiter/action types, internally caught send preparation, bounded completion state, production singleton, and shared mode helper. |
| `src/discord/flux.ts` | Pass | Wires `queueRemoteDecrypt` only after `parseCloakedPayload` and a failed ordered remote cache attempt; manual and invalid modes are separate. |
| `src/discord/send.ts` | Pass (locator corrected) | The plan's literal `prepareRemoteSend` marker is intentionally one layer below this file. `send.ts` calls only `queueRemoteSendPreparation`, so it cannot obtain/return the preparation Promise; `remoteColdPath.ts:259-281` owns the `prepareRemoteSend` connection. This satisfies the artifact's cancellation purpose more strongly than a direct import. |
| `src/ui/Settings.tsx` | Pass (label locator corrected) | The plan's literal `Remote message mode` string is rendered equivalently as the explicit `Message key source`, current-mode display, manual/remote buttons, and `Remote send slot` field (`:221-242`). The required control and fail-closed copy are present. |
| `src/discord/commands.ts` | Pass | Contains `mode-remote`, `mode-manual`, `remote-slot-next`, mode-aware enable/toggle/cycle/status, and no remote secret option. |
| `tests/remoteKdfStage4.ts` | Pass | Contains `REMOTE_FAILURE_COOLDOWN_MS` and four substantive Stage 4 sections covering structural, cache, race, cooldown, waiter, cancellation, rapid-event, lifecycle, and no-fallback behavior. |

**Artifacts:** 10/10 verified. The two corrected locators are plan wording/routing
differences, not missing behavior or wiring.

## Key-link audit

| From -> To | Result | Evidence |
|---|:---:|---|
| Settings -> Flux | Pass | Production injects `keySource`; exact manual/remote/invalid branches select one source (`flux.ts:120-147,175-187`). |
| Settings -> send | Pass | Production injects `keySource` and `remoteSendSlot`; validation precedes source/cache/preparation/orig work (`send.ts:61-75,176-191`). |
| Flux -> decrypt | Pass | Remote content crosses `parseCloakedPayload`, then `decryptWithRemoteKeys`; only a parsed miss may queue (`flux.ts:132-147,182-184`). |
| Flux -> cold coordinator | Pass | CREATE/UPDATE/history normalize top-level/fallback channel and exact copied snapshot fields before `queueRemoteDecrypt` (`flux.ts:143-160,184`). |
| Send -> remote coordinator/KDF | Pass | `instead` uses `getFreshRemoteSendKey` synchronously or calls scalar-only `queueRemoteSendPreparation`; cold coordinator alone owns `prepareRemoteSend` and catches it (`send.ts:110-153,176-201`; `remoteColdPath.ts:192-219,259-281`). |
| Cold coordinator -> Remote KDF | Pass | Production incoming uses `ensureRemoteChannelKeys`; outgoing uses `prepareRemoteSend`, which revision-checks then joins the same operation-keyed derive (`remoteColdPath.ts:259-273`; `remoteKdf.ts:393-456`). |
| Commands/UI -> mode invalidation | Pass | Both call the shared `changeKeySource`; it performs reset then cache/config/session-preserving `invalidateRemoteOperations` (`commands.ts:220-229`; `Settings.tsx:179-188`; `remoteColdPath.ts:310-318`). |
| Lifecycle -> cold/KDF coordinators | Pass | Load initializes remote KDF, then cold coordinator, then hooks; unload closes cold callbacks before aborting KDF and unpatching (`index.ts:85-90,118-124,131-137`). |

**Wiring:** 8/8 connections verified.

## Checker-correction and adversarial audit

- **Exact send cancellation:** production send/edit exposes only an `instead`
  patcher seam. The returned cold rejection is allocated after the scalar queue
  call and is structurally incapable of being the hidden preparation Promise.
  Deferred tests settle every rejection before readiness, keep 20 composer texts
  unchanged, produce one readiness notice, and keep `orig` at zero.
- **Structural preflight:** remote cache/preparation work is downstream of
  `parseCloakedPayload`; recognized ZWC presence alone is insufficient. The
  parser delegates size/version to the protected `unframe` implementation rather
  than duplicating constants.
- **No source downgrade:** the two live handlers branch on exact mode before
  source-specific dependencies. Static call-graph review and injected counters
  show no remote branch reaches `chosenPassword`, `getPasswordList`,
  `getCachedKey`, `deriveKey`, `passwordId`, winner hints, or local Argon; manual
  branches do not reach remote APIs.
- **Current-only send / historical decrypt:** send access revalidates current
  revision and `sendCapable` and applies the TTL; decrypt access keeps all three
  ordered revisions. Revision change demotes globally and unavailable slot never
  substitutes slot zero.
- **Promise and cooldown identity:** derives key on generation/revision/channel;
  rapid send preparation adds only selected slot while sharing the underlying
  derive. Cooldown is operation-local, expires exactly at 30 seconds, and is
  cleared/bypassed by the planned state transitions without storing raw errors.
- **Exact bounded pending state:** incoming operations contain only generation
  plus a Map of copied three-string values; the exact 200 bound, newest duplicate
  replacement, frozen minimal action, one-dispatch behavior, failure/overflow,
  and completed-ID reentrancy cap are present. Outgoing operations contain only
  generation and Promise under a channel/slot key.
- **Late invalidation:** mode change clears coordinator maps first and then
  aborts/advances every KDF commit gate. Tests prove preserved session key,
  configuration, manual cache, and remote cache; cleared readiness/pending/
  cooldown; no late cache/dispatch/toast; and a distinct successful operation
  after switching back.
- **No reflection/replay:** remote errors are normalized to stable codes and
  fixed messages. No remote caught value reaches logger, health last-error,
  toast, reply, status, debug, or dispatch. Preparation never holds message,
  content, args, `this`, or `orig`; only a later explicit send invokes `orig`.
- **Hermes constraints:** new Map/Set snapshots use `Array.from` plus index loops;
  no dependency, native module, worker, WASM shipment, XHR fallback, or remote
  runtime Buffer/TextEncoder assumption was added. Generated syntax guards pass.

## Anti-pattern audit

No blockers or warnings found in the Stage 4 implementation. Changed production
files contain no TODO/FIXME/stub/debugger/console placeholder, automatic replay,
remote error reflection, direct outgoing preparation Promise exposure, or
protected protocol duplication.

## Re-run evidence

Mobile committed tree:

- `npm test`: **163 passed, 0 failed**, including real stegcloak-rs WASM
  cross-compatibility in both directions and all Stage 1-4 remote checks.
- `npm run build`: passed; hash `0e4e946fbcf03aca`, 291,085 bytes, class-free.
- Kettu expression parse: passed.
- Generated syntax gates: no class, generator/yield, or
  `_iteratorNormalCompletion` lowering.
- `npm exec tsc -- --noEmit`: passed.
- `git diff --check`: passed.
- Protected baseline diff: empty for Argon, AEAD, Deflate, encrypt, payload,
  StegCloak, and ZWC files.
- Dependency/build-pipeline baseline diff: empty.

Server/reference:

- `bun install --frozen-lockfile`: passed with no changes.
- `bun run typecheck`: passed.
- `bun test`: **82 passed, 0 failed**, 424 expectations across 16 files.
- Server `git diff --check`: passed; server worktree clean.
- Mobile/server fixture SHA-256 values are identical:
  `876747b46785581b09421896abc801733ad4848dcfebcdcbd0cf780c2fe87ac2`.
- Nested GoofCord worktree: clean.

## Requirements coverage

| Requirement | Status | Blocking issue |
|---|:---:|---|
| `REMOTE-KDF-STAGE-4` | Satisfied | None |

**Coverage:** 1/1 requirements satisfied.

## Human-needed and deferred release validation

`human_needed: false` for Stage 4 implementation. Every behavior claimed by
Stage 4 is exercised by deterministic dependency-injected tests or established
by a small static invariant plus the full integration/build/server gates.

The following remain intentionally pending Stage 5 acceptance evidence and are
not Stage 4 gaps:

1. Controlled Android Kettu/Hermes proof that `redirect: "error"` does not
   follow a 307/308 secret-bearing derive request; iOS is not applicable.
2. Real Kettu/Hermes proof that timeout, configuration replacement, and unload
   abort active fetch and response-body reads.
3. Real-runtime proof of streaming or declared-length response mode and the
   exact 16,384-byte bound.
4. Real-device composer/toast/history UX confirmation for the already-tested
   reject/resend and bounded incoming flows.

Until those checks pass, the documented release policy does not claim device
transport semantics and does not permit a fallback.

## Gaps

None for `REMOTE-KDF-STAGE-4`.

---
*Verified: 2026-07-18T23:20:00+01:00*
*Verifier: independent GSD verification agent*
