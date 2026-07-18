---
quick_id: 260718-pfk
status: complete
completed: 2026-07-18
description: Document the authenticated remote KDF architecture for GoofCrypt mobile implementation
---

# Quick Task 260718-pfk Summary

## Outcome

Created `docs/REMOTE_KDF_ARCHITECTURE.md` as the canonical implementation
handoff for a future Codex Goal Mode run spanning `kettu-goofcrypt` and the
separate `goofcord-cloudserver` fork.

The specification records the agreed trusted-server design: Kettu supplies the
authenticated session, channel ID, and session-only GoofCord cloud encryption
key; the bounded server worker decrypts the existing settings blob in memory,
derives the exact GoofCord-compatible channel keys, and returns only ordered
32-byte keys plus a settings revision. Message encryption and decryption remain
local to the phone.

## Key decisions captured

- GoofCord itself is not modified.
- The existing message format and Argon2id parameters remain byte-exact.
- Plaintext message passwords are not returned to or persisted by Kettu in
  remote mode.
- The cloud encryption key is memory-only on Kettu by default.
- Cold traffic is deduplicated to one in-flight request per channel.
- The server reuses existing HTTPS/authentication and isolates bounded KDF work
  from the HTTP event loop without requiring a new service tier.
- The document defines revision-aware caching, failure/cooldown behavior,
  endpoint schemas, abuse controls, logging restrictions, test gates, staged
  cross-repository work, and completion criteria.

## Verification

- `git diff --check` passed.
- Confirmed the document contains a Goal Mode handoff, locked decisions, exact
  crypto/cloud formats, API and cache contracts, implementation stages, and an
  acceptance checklist.
- No project source code or unrelated user-owned worktree changes were altered.

## Artifact

- `docs/REMOTE_KDF_ARCHITECTURE.md`
