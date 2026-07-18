---
phase: quick
plan: 260718-s4o
subsystem: remote-kdf
tags: [kettu, hermes, remote-kdf, fetch, revision-cache, security]

requires:
  - phase: 260718-prx
    provides: Frozen exact mobile/server Remote KDF contracts and Argon2id fixture
  - phase: 260718-qlx
    provides: Authenticated bounded server v2 derive and revision endpoints
provides:
  - Strict fail-closed mobile v2 client with raw-token auth, fixed abort budgets, and a 16 KiB response boundary
  - Memory-only cloud-key session plus ordered revision-aware remote channel-key cache and race-safe coordinator
  - Explicit masked settings and secret-free command controls for setup, verification, status, revision checks, and remote-only clearing
  - Mobile transport decision record with pending Stage 5 real-device redirect and abort checks
affects: [remote-kdf-stage-4, remote-kdf-stage-5, mobile-message-hooks]

tech-stack:
  added: []
  patterns: [fail-closed capability probing, configuration generations, mutation epochs, ordered revision retention]

key-files:
  created:
    - src/cloud/client.ts
    - src/cloud/session.ts
    - src/cloud/remoteKdf.ts
    - src/core/remoteKeycache.ts
    - tests/remoteKdfStage3.ts
    - docs/REMOTE_KDF_MOBILE_TRANSPORT.md
  modified:
    - src/settings.ts
    - src/index.ts
    - src/ui/Settings.tsx
    - src/discord/commands.ts
    - tests/harness.ts
    - README.md

key-decisions:
  - "Remote and manual keys remain structurally separate; Stage 3 does not modify live Flux/send/encrypt/decrypt paths."
  - "The cloud encryption key is session-only; configuration replacement validates first, then aborts old work and clears the session before reuse."
  - "Mobile networking is supported only after an explicit runtime probe and bounded streaming or Content-Length response mode."
  - "Only the current authoritative revision may send; two older revisions remain decrypt-only for future Stage 4 use."

patterns-established:
  - "Remote mutation gate: configuration generation + mutation epoch + request order + starting revision must all permit commit."
  - "Secret-safe output: status and errors expose only booleans, counts, fixed policy values, and stable codes."

requirements-completed: [REMOTE-KDF-STAGE-3]

coverage:
  - id: D1
    description: "Strict authenticated mobile v2 client and memory-only cloud-key session"
    requirement: REMOTE-KDF-STAGE-3
    verification:
      - kind: unit
        ref: "tests/remoteKdfStage3.ts#Remote KDF Stage 3 client/session boundary"
        status: pass
      - kind: integration
        ref: "npm run build (class-free Hermes eval bundle)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Versioned ordered remote cache, revision freshness, readiness, lifecycle, and adversarial race gates"
    requirement: REMOTE-KDF-STAGE-3
    verification:
      - kind: unit
        ref: "tests/remoteKdfStage3.ts#Remote KDF Stage 3 cache/migration/revision ordering"
        status: pass
      - kind: integration
        ref: "npm test (110 passed, 0 failed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Masked settings controls, secret-free slash actions, lifecycle wiring, and user/security documentation"
    requirement: REMOTE-KDF-STAGE-3
    verification:
      - kind: integration
        ref: "npm run build and npm exec tsc -- --noEmit"
        status: pass
      - kind: other
        ref: "source audit: no secret sinks, server imports, Bearer auth, or /v1 routes in src/cloud"
        status: pass
    human_judgment: false
  - id: D4
    description: "Byte-exact GoofCord compatibility and clean Stage 4 hook boundary"
    requirement: REMOTE-KDF-STAGE-3
    verification:
      - kind: integration
        ref: "npm test stegcloak-rs cross-compatibility harness"
        status: pass
      - kind: other
        ref: "fixture cmp plus byte-identical flux/send/decrypt/encrypt SHA-256 audit"
        status: pass
      - kind: integration
        ref: "goofcord-cloudserver bun test (82 passed, 0 failed)"
        status: pass
    human_judgment: false

duration: 38min
completed: 2026-07-18
status: complete
---

# Quick 260718-s4o: Stage 3 Remote Cloud Session Summary

**Kettu now has a strict session-only Remote KDF boundary, ordered revision cache, and explicit safe setup UX without changing live manual message behavior.**

## Performance

- **Duration:** 38 min
- **Started:** 2026-07-18T19:42:23Z
- **Completed:** 2026-07-18T20:20:23Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added exact HTTPS/loopback origin and raw-token validation, runtime capability probing, abortable derive/revision calls, strict response parsing, and a hard 16 KiB body limit.
- Added a memory-only cloud-key session and an independent v1 remote cache with exact 32-byte keys, current-plus-two-old retention, global revision demotion, readiness proof, coalescing, TTL, and adversarial late-response rejection.
- Added masked settings-only secret inputs plus safe `/encrypt` remote status/refresh/check/clear actions, lifecycle clearing, README guidance, and the pending Stage 5 device checklist.
- Preserved the manual password/import cache and byte-exact stegcloak-rs compatibility; Stage 4 message hooks remain byte-identical.

## Task Commits

The three tightly coupled TDD tasks were committed atomically as requested:

1. **Task 1: Strict remote configuration, session, and v2 client boundary** - `35bc02b`
2. **Task 2: Versioned cache, revision coordinator, and lifecycle gates** - `35bc02b`
3. **Task 3: Secret-safe setup UX, commands, docs, and compatibility gates** - `35bc02b`

**Plan metadata:** intentionally uncommitted per execution instructions.

## Files Created/Modified

- `src/cloud/client.ts` - Fail-closed runtime probe and exact bounded v2 HTTP client.
- `src/cloud/session.ts` - Memory-only cloud key and verified-session holder.
- `src/cloud/remoteKdf.ts` - Configuration generation, mutation ordering, refresh/readiness, and lifecycle coordinator.
- `src/core/remoteKeycache.ts` - Strict versioned ordered cache kept separate from manual keys.
- `src/settings.ts` - Persisted normalized remote configuration and cache shape.
- `src/index.ts` - Coordinator initialization, caught on-load revision refresh, and shutdown clearing.
- `src/ui/Settings.tsx` - Masked setup plus verify/check/status/clear/forget controls.
- `src/discord/commands.ts` - Secret-free remote status, refresh, check, and cache-clear actions.
- `tests/remoteKdfStage3.ts` / `tests/harness.ts` - 110-assertion integrated client/cache/race/lifecycle suite.
- `docs/REMOTE_KDF_MOBILE_TRANSPORT.md` / `README.md` - Transport contract, security limits, Stage boundary, and device checklist.

## Decisions Made

- Kept the stored revocable token honest as plaintext casual-privacy storage while never persisting or displaying the universal cloud encryption key.
- Required a bounded response-reading mode before any request and used no XHR, redirect-follow, unbounded-read, or server-side fallback.
- Made freshness conservative under clock rollback as well as expiry.
- Prevented a late stale derive from erasing readiness established by a newer successful mutation, while ordinary failed refreshes still clear their own proof.

## Deviations from Plan

None - the plan was executed within its Stage 3 boundary with no dependency or hook scope expansion.

## Issues Encountered

- An early test cleanup called the guarded cache API after coordinator shutdown; cleanup ordering was corrected and the full harness reran green.
- Race review found that unconditional failure invalidation could let an older stale derive erase newer verification. Invalidation is now snapshot/order-gated and both completion orders are covered.

## User Setup Required

None for the implementation. Remote use requires an existing GoofCord cloud origin/token and re-entry of the cloud encryption key in the masked settings screen each plugin session.

## Verification

- Mobile: `npm test` — 110 passed, 0 failed.
- Hermes: `npm run build` — 256,858-byte class-free bundle.
- Types/style: `npm exec tsc -- --noEmit`; `git diff --check`.
- Compatibility: mobile/server fixture byte comparison passed; stegcloak-rs checkout clean; all four Stage 4 hook hashes match baseline.
- Server: `bun install --frozen-lockfile`; `bun run typecheck`; `bun test` — 82 passed, 0 failed; `docker compose config --quiet`.
- Security audit: no cloud `/v1` routes, Bearer auth, runtime Buffer/TextEncoder, server imports, or secret-bearing output sinks in the new boundary.

## Next Phase Readiness

Stage 4 can consume the exported current send keys, ordered decrypt sets, and five-minute conservative revision freshness API without changing the Stage 3 trust/storage boundary.

Stage 5 must still complete the documented Android Kettu/Hermes redirect-error, abort-during-fetch/body-read, and 16 KiB enforcement checks before real-device remote cold-path release. iOS is not applicable because Kettu has no iOS client. There is no permissive fallback.

---
*Phase: quick 260718-s4o*
*Completed: 2026-07-18*
