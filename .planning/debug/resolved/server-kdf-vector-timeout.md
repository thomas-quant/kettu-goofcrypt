---
status: resolved
trigger: "Stage 5 full server suite intermittently fails the real service-vector test at Bun's implicit 5-second timeout"
created: 2026-07-18T23:58:00+01:00
updated: 2026-07-19T00:09:50+01:00
---

## Current Focus

hypothesis: Confirmed and fixed — valid fixed-cost real decoder/Worker work varied across Bun's implicit 5-second harness boundary, while production job timeouts remained independently bounded.
test: Complete.
expecting: Met — only service.test.ts changed in the server; all focused/full/mobile/bridge/typecheck/build gates passed; no production timeout or assertion changed.
next_action: None; session resolved.
reasoning_checkpoint: The explicit 90000 ms test budget matches existing real-Worker integration tests. Focused service passed 6/6, three consecutive full suites passed 82/82, Stage 5 bridge passed 1/1, mobile passed 163/163, and build/typecheck/scope gates passed.
tdd_checkpoint: null

## Symptoms

expected: The unchanged full goofcord-cloudserver suite passes reliably while the real service-vector test exercises the fixed-cost decoder and Worker path.
actual: Independent Stage 5 verification twice returned 81/82; the real service-vector test exceeded Bun's implicit 5-second timeout by 1.98 ms and 0.47 ms, while the same test passed alone in 4.77 seconds.
errors: Bun test timeout at 5000 ms in the real service-vector integration test.
reproduction: Run `bun test` in ../goofcord-cloudserver after the Worker-backed Stage 5 bridge and mobile gates; compare with the focused real service-vector test in isolation.
started: First observed during independent Stage 5 verification; the test predates Stage 5 and has no explicit timeout.

## Eliminated

## Evidence

- timestamp: 2026-07-18T23:58:00+01:00
  checked: Independent Stage 5 verification reruns
  found: Full suite failed twice at 5 seconds by less than 2 ms; focused test passed in 4.77 seconds.
  implication: Evidence favors an implicit test-harness timeout flake over a protocol, decoder, or Worker correctness regression.

- timestamp: 2026-07-19T00:04:02+01:00
  checked: Exact service test, pool bounds, configuration defaults, and analogous real-Worker tests
  found: service.test.ts has no explicit timeout; the pool uses a separately enforced 30000 ms job timeout, configuration permits 5000-120000 ms, worker.test.ts and the full-app v2 vector test use 90000 ms test budgets, and the mobile full-batch contract allows 270000 ms.
  implication: Raising only the Bun test harness timeout to the established 90000 ms integration-test budget will not weaken production timeouts or assertions.

- timestamp: 2026-07-19T00:05:00+01:00
  checked: Unchanged focused service file and unchanged full server suite
  found: Focused service vector completed in 4507.60 ms and the full-suite instance in 4602.74 ms; both passed, while the immediately preceding verifier runs recorded the same unchanged case at 5001.98 ms and 5000.47 ms failures.
  implication: Timing variance straddles Bun's implicit 5000 ms test budget. The hypothesis is confirmed; a bounded test-only timeout is the smallest fix.

- timestamp: 2026-07-19T00:08:56+01:00
  checked: Post-fix focused service test, server typecheck, three consecutive full server suites, Stage 5 bridge, and complete mobile acceptance harness
  found: Focused service passed 6/6; server typecheck passed; each full suite passed 82/82 and 424 assertions; the service vector took 4705.24, 4815.35, and 4561.37 ms; bridge passed 1/1 with 8 assertions; mobile passed 163/163.
  implication: The one-line harness timeout removes the false deadline without weakening any real Worker/decoder assertion or production bound.

## Resolution

root_cause: The real service-vector test inherited Bun's implicit 5000 ms test timeout even though it performs startup self-test plus two sequential fixed-cost Argon derives; ordinary timing variance moved valid work from about 4.5-4.8 seconds to just over 5 seconds.
fix: Added an explicit bounded 90000 ms timeout only to the existing real service-vector test, matching other real-Worker integration tests and leaving production jobTimeoutMs, decoder/Worker behavior, fixtures, and assertions unchanged.
verification: Focused service 6/6; server typecheck; three consecutive full server suites 82/82 and 424 assertions; Stage 5 bridge 1/1 and 8 assertions; mobile harness 163/163; mobile build/typecheck, fixture equality, diff hygiene, and exact scope gates all passed.
files_changed:
  - ../goofcord-cloudserver/test/kdf/service.test.ts
