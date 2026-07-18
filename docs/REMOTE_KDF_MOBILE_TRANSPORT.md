# Remote KDF mobile transport contract

This document records the Stage 3 Kettu/Hermes transport boundary. Stage 3 can
configure, verify, cache, inspect, and clear remote KDF state, but it does not
connect remote keys to the live message send or receive paths. That integration
belongs to Stage 4.

## Accepted configuration

- Production origins must be absolute HTTPS origins with no credentials, path,
  query, or fragment.
- Direct HTTP is accepted only for exact `localhost`, `127.0.0.1`, or `[::1]`
  hosts when the separate development option is enabled.
- Authentication is the existing 32-character lowercase hexadecimal GoofCord
  token, sent unchanged as the raw `Authorization` value. It is never wrapped in
  `Bearer` and never placed in a URL or request body.
- The client calls only `POST /v2/kdf/derive` and `GET /v2/kdf/revision`. It does
  not call the server-owned `/v1/save`, `/v1/load`, or `/v1/delete` blob routes.

The normalized origin, development flag, raw revocable token, revision metadata,
and channel-scoped derived keys live in Kettu plugin storage. Kettu storage is
plaintext casual-privacy storage, not a keychain. The cloud encryption key is
held only in module memory for the current plugin session and is cleared when it
is replaced, configuration changes, credentials are forgotten, or the plugin
unloads. Managed JavaScript strings cannot be reliably overwritten in place;
clearing drops all references controlled by the plugin.

## Fail-closed capability probe

Before a secret-bearing request, the client verifies callable `fetch`, a
constructible and abortable `AbortController`, standards-compatible `URL`
parsing, and the Response status/header/text surfaces used by the client. It
must also prove one supported response-bounding mode:

1. `Response.body.getReader()` permits incremental byte accounting; or
2. a valid `Content-Length` permits a bounded `text()` fallback.

A missing or partial surface returns the stable `REMOTE_UNSUPPORTED` code. There
is no XMLHttpRequest, redirect-following, unbounded body, or other permissive
fallback.

Every request uses `redirect: "error"`, `cache: "no-store"`, one tracked abort
controller, a fixed 270,000 ms full derive-batch timeout or 15,000 ms revision
timeout, and a 16,384-byte response limit. A declared oversized body is rejected
before reading. A streamed body is cancelled as soon as accumulated bytes exceed
the limit. Without streaming, a missing, malformed, or oversized
`Content-Length` is rejected without calling `text()`. JSON, status, content
type, error code, revision, slot order, key encoding, and exact object shape are
validated before data reaches session state or storage.

## Revision and cache behavior

The remote cache is independent of manual password-derived and imported keys.
It retains at most three ordered revisions per channel: the current send-capable
set plus two older decrypt-only sets. A changed authoritative revision globally
demotes cached send capability. Revision checks are forced once on configured
plugin load and on explicit user checks; the Stage 4 pre-send API may reuse a
successful check for five minutes. Failed checks never advance freshness.

Clearing the remote cache keeps the remote credentials, manual passwords, and
manual/imported keys. Forgetting remote configuration additionally removes the
stored origin/token and remote cache and clears the in-memory session key, while
still preserving all manual settings.

## Stage 5 real-device checklist (pending)

Node tests and an eval-safe bundle do not prove React Native networking
semantics. Before remote cold-path operation is shipped on devices, Stage 5 must
record controlled Android and iOS Kettu/Hermes evidence that:

- [ ] `redirect: "error"` does not follow controlled 307 or 308 responses for a
  derive request containing the raw token and cloud key.
- [ ] Timeout, configuration replacement, and plugin-unload aborts cancel both
  an active fetch and an active response-body read.
- [ ] The runtime-selected streaming or declared-length mode enforces the exact
  16,384-byte body limit.
- [ ] Missing or incomplete response capabilities fail as
  `REMOTE_UNSUPPORTED`, without a network or body-read fallback.

These checks are intentionally pending. Stage 3 makes no unverified claim about
real-device redirect or cancellation behavior and does not authorize weakening
the boundary if a device fails it.
