---
quick_id: 260719-0lb
phase: quick
status: complete
completed: 2026-07-19
requirements-completed: [REMOTE-KDF-DEVICE-SCOPE]
commit: 7977d3e1a4ac453f504ca211b157073db4d0826b
device-release: pending
coverage:
  - id: D1
    description: "The physical ledger has 14 Android PENDING_DEVICE cells and 14 iOS NOT_APPLICABLE cells, with DEVICE_PENDING retained."
    requirement: REMOTE-KDF-DEVICE-SCOPE
    verification:
      - kind: other
        ref: "mechanical DEV-row and exact-column status counts in docs/REMOTE_KDF_ACCEPTANCE.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "Transport, architecture applicability, project/stack context, and current Stage 3-5 evidence consistently scope Kettu device validation to Android."
    requirement: REMOTE-KDF-DEVICE-SCOPE
    verification:
      - kind: other
        ref: "stale-scope search across README, docs, and current planning summaries/verifications"
        status: pass
    human_judgment: false
  - id: D3
    description: "All 14 Android device checks remain release-pending."
    requirement: REMOTE-KDF-DEVICE-SCOPE
    verification: []
    human_judgment: true
    rationale: "This docs-only correction does not supply physical Android Kettu/Hermes evidence."
---

# Quick Task 260719-0lb: Correct Remote KDF Device-Acceptance Scope

Kettu device acceptance is now accurately Android-only. iOS is explicitly
`NOT_APPLICABLE`, not passed and not pending, while the Android release gate
remains fully pending.

## Accomplishments

- Defined `NOT_APPLICABLE` and changed all 14 iOS device cells to it.
- Retained all 14 Android `PENDING_DEVICE` cells and the overall
  `AUTOMATED_PASS / DEVICE_PENDING` verdict.
- Scoped the transport checklist to Android Kettu/Hermes and added a narrow
  architecture note clarifying that hypothetical iOS secure storage does not
  create an iOS Kettu release requirement.
- Corrected current project/stack facts and Stage 3-5 summary/verification
  evidence; historical plans and README were left unchanged.

## Commit

- `7977d3e1a4ac453f504ca211b157073db4d0826b` —
  `docs(remote-kdf): correct Kettu device scope (260719-0lb)`

The commit contains only:

- `docs/REMOTE_KDF_ACCEPTANCE.md`
- `docs/REMOTE_KDF_ARCHITECTURE.md`
- `docs/REMOTE_KDF_MOBILE_TRANSPORT.md`

Planning evidence corrections, this PLAN/SUMMARY, and STATE remain uncommitted
as required. User-owned `CLAUDE.md` and `AGENTS.md` were preserved.

## Verification

- 14 `DEV-*` rows.
- 14 Android `PENDING_DEVICE` cells.
- 14 iOS `NOT_APPLICABLE` cells.
- 0 iOS `PENDING_DEVICE` cells.
- `AUTOMATED_PASS / DEVICE_PENDING` and final `DEVICE_PENDING` retained.
- No stale both-platform/28-pending claims in current docs or planning evidence.
- `git diff --check` passed; mobile code/package paths are unchanged.
- Server evidence HEAD and GoofCord reference HEAD/worktrees are unchanged and
  clean.

No code tests were rerun because this task changes documentation and planning
evidence only; the relevant mechanical and scope gates passed.

## Remaining release work

Physical Android validation for all 14 device rows is still required. iOS is
not part of the Kettu release gate.

---
*Quick task: 260719-0lb*
*Completed: 2026-07-19*
