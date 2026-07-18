---
phase: quick
plan: 260718-tyu
subsystem: remote-kdf
tags: [kettu, hermes, remote-kdf, discord-flux, cold-path, security]

requires:
  - phase: 260718-s4o
    provides: Strict mobile Remote KDF client, memory-only cloud-key session, revision-aware cache, and ordered mutation gates
provides:
  - Explicit persisted manual/remote message-key mode with a strict 0-7 outgoing remote slot
  - Mode-exclusive synchronous remote receive/send cache paths with structural preflight and current-versus-old key policy
  - Shared revision-keyed cold derivation, bounded exact incoming snapshots, fixed failure cooldown, and safe invalidation
  - Instead-patched outgoing reject-and-resend behavior that cannot retain or automatically replay plaintext
  - Stage 4 operational settings, commands, lifecycle wiring, documentation, and deterministic rapid-event coverage
affects: [remote-kdf-stage-5, mobile-message-hooks, remote-kdf-device-verification]

tech-stack:
  added: []
  patterns: [explicit source selection, revision-keyed promise coalescing, bounded snapshot coordination, scalar-only send preparation]

key-files:
  created:
    - src/discord/remoteColdPath.ts
    - tests/remoteKdfStage4.ts
  modified:
    - src/settings.ts
    - src/core/decrypt.ts
    - src/core/remoteKeycache.ts
    - src/cloud/client.ts
    - src/cloud/remoteKdf.ts
    - src/discord/flux.ts
    - src/discord/send.ts
    - src/ui/Settings.tsx
    - src/discord/commands.ts
    - src/index.ts
    - tests/harness.ts
    - docs/REMOTE_KDF_MOBILE_TRANSPORT.md
    - README.md

key-decisions:
  - "Manual remains the migration default; invalid persisted mode or slot values remain invalid and fail closed rather than being repaired implicitly."
  - "Remote receive work begins only after exact ZWC/frame structural parsing and never reaches manual passwords, manual keycache, or local Argon2."
  - "Only a selected current send-capable key with a fresh authoritative revision may send; retained revisions are decrypt-only."
  - "Cold outgoing attempts reject immediately with text kept; preparation receives only channel ID and slot and has no replay surface."
  - "Mode invalidation clears volatile operations/readiness while preserving the cloud key, host/token, manual cache, and persistent remote cache."

patterns-established:
  - "Remote cold operation key: internal configuration generation + authoritative revision (including unknown) + channel ID."
  - "Incoming waiter boundary: at most 200 exact messageId/channelId/ciphertext snapshots per shared Promise."
  - "Outgoing cold boundary: internally observed preparation followed by one fixed ready/error notice and a later user-initiated resend."

requirements-completed: [REMOTE-KDF-STAGE-4]

coverage:
  - id: D1
    description: "Explicit fail-closed message mode, structural receive gate, ordered current/old remote decryption, and selected current send key"
    requirement: REMOTE-KDF-STAGE-4
    verification:
      - kind: unit
        ref: "tests/remoteKdfStage4.ts#Remote KDF Stage 4 mode and hot-path primitives"
        status: pass
      - kind: integration
        ref: "npm test (163 passed, 0 failed)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Revision-keyed shared derivation, 30-second failure cooldown, bounded incoming/outgoing coordinator, and lifecycle-safe invalidation"
    requirement: REMOTE-KDF-STAGE-4
    verification:
      - kind: unit
        ref: "tests/remoteKdfStage4.ts#Remote KDF Stage 4 shared preparation, cooldown, and invalidation"
        status: pass
      - kind: unit
        ref: "tests/remoteKdfStage4.ts#Remote KDF Stage 4 exact waiting and notification coordinator"
        status: pass
    human_judgment: false
  - id: D3
    description: "Mode-exclusive Flux handling and instead-patched send/edit reject-and-resend wiring with no local-Argon or plaintext downgrade"
    requirement: REMOTE-KDF-STAGE-4
    verification:
      - kind: integration
        ref: "tests/remoteKdfStage4.ts#Remote KDF Stage 4 Flux and instead-patch wiring"
        status: pass
      - kind: integration
        ref: "npm run build (291085-byte class-free Hermes eval bundle)"
        status: pass
      - kind: other
        ref: "source audit: send/edit use instead only; remote pending state stores no outgoing content, args, this, orig, or replay callback"
        status: pass
    human_judgment: false
  - id: D4
    description: "Stage 4 settings, secret-free commands, lifecycle, documentation, and unchanged GoofCord/server compatibility boundary"
    requirement: REMOTE-KDF-STAGE-4
    verification:
      - kind: integration
        ref: "npm exec tsc -- --noEmit and git diff --check"
        status: pass
      - kind: integration
        ref: "fixture cmp, protected crypto/stego baseline diff, and stegcloak-rs cross-compatibility harness"
        status: pass
      - kind: integration
        ref: "goofcord-cloudserver bun run typecheck and bun test (82 passed, 0 failed)"
        status: pass
    human_judgment: false

duration: 58min
completed: 2026-07-18
status: complete
---

# Quick 260718-tyu: Stage 4 Remote KDF Message Paths Summary

**Kettu now supports explicit fail-closed remote message encryption/decryption with shared bounded cold work, current-only sending, and no automatic plaintext replay or manual fallback.**

## Performance

- **Duration:** 58 min
- **Started:** 2026-07-18T22:11:26+01:00
- **Completed:** 2026-07-18T23:09:14+01:00
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments

- Added strict persisted manual/remote mode and remote send-slot selection, structural receive parsing, ordered current-plus-historical remote decryption, and current-selected send-key lookup.
- Added one generation/revision/channel derive Promise, revision-first send preparation, fixed 30-second failure cooldown, exact bounded incoming snapshots, safe minimal redispatch, and lifecycle/mode invalidation that preserves credentials, session key, and caches.
- Wired Flux and Vendetta `instead` send/edit hooks so hot keys act synchronously while cold sends reject immediately with byte-identical composer text and can only be retried by an explicit later user send.
- Added mode-aware settings/commands/lifecycle documentation and 163 deterministic harness checks, while preserving byte-exact stegcloak-rs interop and the frozen server/reference boundary.

## Task Commits

The three tightly coupled TDD tasks were committed atomically as requested:

1. **Task 1: Mode, structural parser, and remote hot-path primitives** - `2fe1285`
2. **Task 2: Shared preparation, cooldown, and bounded cold-path coordinator** - `2fe1285`
3. **Task 3: Flux/send wiring, operational UX/lifecycle, documentation, and final gates** - `2fe1285`

**Plan metadata:** intentionally uncommitted per execution instructions.

## Files Created/Modified

- `src/discord/remoteColdPath.ts` - Bounded exact incoming waiters, minimal redispatch, scalar-only outgoing preparation notices, and official mode-transition helper.
- `tests/remoteKdfStage4.ts` / `tests/harness.ts` - Structural, ordering, race, cooldown, lifecycle, rapid-event, no-fallback, and instead-patcher coverage.
- `src/cloud/remoteKdf.ts` / `src/cloud/client.ts` - Revision-keyed coalescing, conservative send freshness, stable local codes, cooldown, and cache/session-preserving operation invalidation.
- `src/core/decrypt.ts` / `src/core/remoteKeycache.ts` - Shared structural parsing, ordered remote decrypt attempts, and defensive selected current send-key access.
- `src/discord/flux.ts` / `src/discord/send.ts` - Mode-exclusive receive and send/edit paths with synchronous hot hits and safe cold rejection.
- `src/settings.ts` / `src/ui/Settings.tsx` / `src/discord/commands.ts` - Explicit mode and slot persistence, controls, mode-aware enable/cycle/status behavior, and secret-free remote actions.
- `src/index.ts` - Cold coordinator initialization and close-before-abort unload ordering.
- `docs/REMOTE_KDF_MOBILE_TRANSPORT.md` / `README.md` - Stage 4 cache, cooldown, reject/resend, restart, failure, and still-pending Stage 5 device behavior.

## Decisions Made

- Kept mode and outgoing slot independent of manual password selection and remote setup state; neither cache presence nor configuration can silently select a source.
- Kept remote incoming retry data to three copied strings and outgoing pending data to channel/slot scalars, eliminating original message/callback replay paths.
- Preserved Stage 3 generation, epoch, request-order, and starting-revision commit gates while adding exact Promise sharing and cooldown around them.
- Made revision freshness a synchronous send prerequisite and required an exact selected slot after preparation rather than substituting any available key.

## Deviations from Plan

None - the implementation stayed inside the Stage 4 mobile boundary and did not modify the server, reference checkout, or protected crypto/stego pipeline.

## Issues Encountered

- Final test review found several planned adversarial cases were only indirectly covered. The harness was expanded before commit with explicit refresh-bypass, local non-cooldown, revision-change, unavailable-slot, 50-waiter, 20-intercepted-send, RNG-failure, and late-mode-change checks; all 163 checks pass.
- A supplemental shell audit initially matched the word `class` inside an SWC helper error string. The build pipeline's syntax-aware guard and equivalent exact regex confirmed no class, generator, or iterator-protocol syntax survived.

## User Setup Required

No new build-time setup. Remote use remains opt-in and requires an existing GoofCord cloud origin/token plus re-entry of the cloud encryption key when a new channel derive is needed.

## Verification

- Mobile: `npm test` - 163 passed, 0 failed.
- Hermes: `npm run build` - hash `0e4e946fbcf03aca`, 291085-byte class-free eval bundle; generator and iterator-protocol guards passed.
- Types/style: `npm exec tsc -- --noEmit`; `git diff --check`; staged diff check passed.
- Compatibility: shared fixture `cmp` passed; protected Argon/AEAD/Deflate/payload/StegCloak/ZWC files are unchanged from `b795be7101c3a289928e2bd225fd3bd9745c1fb0`; stegcloak-rs round-trips passed.
- Server/reference: `bun install --frozen-lockfile` made no changes; `bun run typecheck`; `bun test` - 82 passed, 0 failed; both adjacent worktrees remain clean.
- Security audit: remote structural rejects do no work; invalid mode/slot calls no source/network/orig path; send/edit register only with `instead`; pending outgoing state retains no plaintext/args/orig; late invalidated work cannot cache, verify, dispatch, or toast.

## Next Phase Readiness

Stage 4 is ready for the documented Stage 5 Android Kettu/Hermes transport verification. iOS is not applicable because Kettu has no iOS client. The redirect-error, abort-during-fetch/body-read, and response-bounding checklist remains deliberately pending; there is no permissive transport or key-source fallback.

---
*Phase: quick 260718-tyu*
*Completed: 2026-07-18*
