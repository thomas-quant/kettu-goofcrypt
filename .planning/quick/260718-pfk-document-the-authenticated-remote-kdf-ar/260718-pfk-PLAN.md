---
quick_id: 260718-pfk
status: planned
description: Document the authenticated remote KDF architecture for GoofCrypt mobile implementation
files_modified:
  - docs/REMOTE_KDF_ARCHITECTURE.md
---

# Quick Task 260718-pfk Plan

## Task 1: Write the canonical remote-KDF architecture specification

Create `docs/REMOTE_KDF_ARCHITECTURE.md` as the implementation handoff for a
future Codex Goal Mode run. Capture the locked product decisions, exact crypto
compatibility requirements, mobile and server responsibilities, authenticated
API contract, cache/concurrency behavior, security boundaries, failure modes,
test requirements, and a staged cross-repository implementation sequence.

### Verification

- The specification explicitly forbids modifying GoofCord.
- The worker decrypts the authenticated user's existing GoofCord cloud blob and
  returns derived channel keys without returning plaintext passwords.
- The cloud key is mandatory and memory-only by default on Kettu when no genuine
  OS keyring is available.
- The document covers one in-flight derivation per channel, settings revision,
  multiple password slots, request-storm protection, and byte-exact KDF gating.
- Goal Mode can identify the affected files and acceptance criteria without
  reconstructing decisions from conversation history.
