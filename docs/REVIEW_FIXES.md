# Encryption and message-state review fixes

These fixes follow the review of mobile revision
`3eff4b16890ca14a8fc59afde4c1e43b3ba54ca4`. The crypto primitives, Argon2
parameters, wire format, dependencies, and server are unchanged.

## Behavior

- Ordinary joined emoji and short zero-width text no longer bypass outgoing
  encryption. Only complete supported encrypted frames pass through unchanged.
- Enabled manual sending without a selected password rejects both sends and
  edits, without invoking Discord's original operation or changing the text.
- Receive suppression matches exact plugin-produced display content, using
  bounded memory-only SHA-256 fingerprints. It does not retain plaintext in
  that cache or treat an ID or display prefix as proof of completed decryption.
  Encrypted edits and freshly loaded ciphertext decrypt again, including with
  an empty display mark.
- Content-bearing edits, empty updates, and deletions cancel obsolete pending
  decryptions. Metadata-only updates preserve them. Remote completion checks
  snapshot currency again during synchronous redispatch; manual completion
  checks its snapshot identity and emits only minimal message fields.
- Unchanged revision checks refresh the TTL without advancing stale-response
  fences. Actual revision transitions and local mutations still reject old
  results. Same-revision channel derives remain independent; an older failed
  derive cannot erase newer verification.
- Cache reads validate the requested channel without persistent assignments.
  Initialization and mutation boundaries still sanitize the full envelope;
  canonical 32-byte validation and decrypt-only retention remain enforced.

## Verification

All six primary regression checks failed against the old implementation before
production changes were applied. They are part of the existing Stage 3/4 files:

- `remote key reads preserve persisted state without storage writes`
- `unchanged revision checks preserve valid derivations in every start and completion order`
- `production sends and edits encrypt ordinary ZWC text and joined emoji in both modes`
- `enabled manual sends and edits without a password reject without sending or changing text`
- `completed messages decrypt encrypted edits and fresh history copies in both modes with an empty mark`
- `pending remote plaintext cannot overwrite newer edits or deleted messages`

TypeScript passed and the source `tests/harness.ts` passed 169 checks, including
both real stegcloak-rs interoperability directions. Local execution used `tsx`
and an in-memory WASM asset loader, not a new local bundle. A separate transient
production-Flux check exercised real manual Argon derivation followed by public
edits, encrypted edits, deletion, and metadata-only updates; all four passed.

CI now type-checks, runs `npm test`, and builds every branch and pull request.
The installable output is the `goofcrypt-site` artifact. Only `main` deploys
Pages. GSD is not required or used.

## Remaining release limits

Node tests and a class-free build do not establish Android Hermes networking or
composer behavior. The Android transport/device gates in
`REMOTE_KDF_ACCEPTANCE.md` remain pending. The cross-repository Stage 5 bridge
was not rerun for this fix pass because Bun is unavailable; no server or
GoofCord checkout was modified. These fixes do not authorize transport fallbacks
or claim to complete physical-device acceptance.
