# FastShare — Codex Agent Instructions

## Project

FastShare is a lightweight peer-to-peer file-sharing web application.

The primary goal is fast, temporary, browser-to-browser file transfer without storing the transferred files on our infrastructure.

Core constraints:

* Maximum transfer size: 5 GiB per room/session.
* No permanent file storage.
* No user accounts in the MVP.
* One sender and one receiver in the MVP.
* Temporary rooms.
* Room code, shareable link, and QR code.
* WebRTC DataChannel for file transfer.
* WebSocket-based signaling.
* STUN-first connectivity.
* TURN is not required for the MVP.
* HTTPS/WSS in production.
* Security, integrity, validation, and reliability are first-class requirements.
* Target infrastructure cost: ₹0 for the college-project deployment where practical.

## Important engineering principles

1. Do not build the entire application in one change.
2. Work in small, testable phases.
3. Before implementing a large change, inspect the existing repository and relevant documentation.
4. Preserve existing working behavior.
5. Do not introduce dependencies without a concrete reason.
6. Prefer simple solutions over unnecessary abstractions.
7. Do not add a database or object storage unless explicitly required.
8. Never route file payloads through the signaling server.
9. Never load an entire multi-GiB file into memory.
10. Never use `Math.random()` for security-sensitive identifiers.
11. Never invent cryptographic algorithms or protocols.
12. Never disable browser security controls merely to make development easier.
13. Never silently weaken security to fix a failing test.
14. Do not claim a feature is complete without testing it.

## Architecture

The system consists of:

* `apps/web/` — React + TypeScript web application.
* `server/` — Node.js signaling server.
* `packages/protocol/` — shared protocol types and validation contracts.
* `packages/transfer-core/` — browser-side transfer orchestration.
* `packages/config/` — shared development tooling configuration.
* `tests/` — integration, performance, and fixture locations.
* `docs/` — source of truth for architecture, requirements, protocol, security, performance, testing, and deployment.

The signaling server coordinates peers but must not receive, store, or relay normal file payloads.

File payload path:

Sender browser
|
| WebRTC DataChannel
v
Receiver browser

Signaling path:

Sender browser
|
| WebSocket
v
Signaling server
|
| WebSocket
v
Receiver browser

## Repository knowledge

Before making architectural changes, read:

* `ARCHITECTURE.md`
* `docs/requirements.md`
* `docs/protocol.md`
* `docs/security.md`

For performance work, also read:

* `docs/performance.md`

For test or deployment work, read:

* `docs/testing.md`
* `docs/deployment.md`

If these documents conflict with the code, do not silently choose one. Explain the conflict and propose the smallest safe resolution.

## WebRTC rules

* Use `RTCPeerConnection`.
* Use `RTCDataChannel` for file transfer.
* Use reliable, ordered delivery for file data unless a documented reason exists to change it.
* Implement WebRTC negotiation carefully.
* Prefer the standard perfect-negotiation pattern.
* Exchange SDP and ICE information through the signaling server.
* Never send file chunks through WebSocket.
* Monitor DataChannel backpressure.
* Do not assume a particular maximum DataChannel message size.
* Chunk large files.
* Never send an entire multi-GiB file as one message.

## File-transfer rules

The transfer layer must support:

* Multiple files.
* Per-file metadata.
* Chunked binary transfer.
* Transfer progress.
* Transfer speed.
* Estimated remaining time.
* Cancellation.
* File integrity verification.
* 5 GiB aggregate room/session limit.

Initial chunk size may be approximately 256 KiB, but it must be benchmarked rather than treated as a permanent constant.

Use backpressure based on `RTCDataChannel.bufferedAmount`.

Do not accumulate a 5 GiB file in JavaScript memory.

## Security rules

Security-sensitive values must use cryptographically secure randomness.

Validate every signaling message.

Enforce:

* room membership
* room expiration
* message-size limits
* room participant limits
* rate limits
* valid message types
* valid state transitions

Never trust client-side validation as the only security control.

Escape untrusted filenames before rendering them.

Do not expose unnecessary file metadata to the signaling server.

WebRTC transport encryption is mandatory.

Application-level encryption may be implemented later using established Web Crypto primitives after the base system is stable.

## Room rules

MVP:

* One sender.
* One receiver.
* Temporary room.
* Room expires automatically.
* No permanent room history.
* No file storage.
* No authentication account system.

Room codes must not be the sole security boundary. Internal room identifiers/secrets must have sufficient entropy and room-join attempts must be rate-limited.

## Coding standards

* TypeScript with strict type checking.
* Prefer explicit types at system boundaries.
* Avoid `any`.
* Keep functions focused.
* Avoid unnecessary global state.
* Keep networking logic separate from UI.
* Keep transfer logic separate from WebRTC connection management.
* Keep cryptographic functionality separate from transfer logic.
* Keep protocol definitions in `packages/protocol/`.
* Use clear names instead of clever abstractions.

## Error handling

Never swallow errors.

Every important failure should produce:

1. A structured internal error.
2. Appropriate logging in development.
3. A safe user-facing message where applicable.

Do not expose secrets, internal stack traces, or sensitive network information to users.

## Testing

Every feature should have appropriate tests.

At minimum:

* unit tests for protocol validation
* room lifecycle tests
* signaling tests
* transfer-state tests
* file-size validation tests
* security validation tests
* integration tests for sender/receiver flows

Large-file performance testing should use generated test data rather than committing large binaries to Git.

## Performance

Performance is a primary project requirement.

Avoid:

* unnecessary copying of large buffers
* base64 encoding of file chunks
* JSON encoding of binary chunks
* server-side file proxying
* loading entire files into memory
* unbounded DataChannel buffering

Measure:

* total transfer time
* average throughput
* instantaneous throughput
* bytes transferred
* failure rate
* memory usage where practical

Do not optimize based solely on intuition. Benchmark changes.

## Dependencies

Before adding a dependency:

* determine whether browser/platform APIs already solve the problem;
* check whether the dependency is maintained;
* explain why it is needed;
* avoid dependencies that duplicate existing functionality.

Do not add a large framework for a small feature.

## Git discipline

Make focused commits.

Do not rewrite unrelated code.

Do not modify existing commits unless explicitly instructed.

Do not commit:

* secrets
* `.env` files containing credentials
* generated build artifacts
* large test files
* node_modules

## Agent behavior

When asked to implement a feature:

1. Inspect the repository.
2. Read the relevant documentation.
3. Identify affected files.
4. Explain the implementation plan briefly.
5. Implement the smallest complete change.
6. Run relevant tests/type checks/lint/build.
7. Fix failures caused by the change.
8. Summarize changed files and verification results.
9. Mention remaining risks or untested areas.

Do not pretend that untested behavior works.

## Definition of done

A feature is complete only when:

* implementation exists;
* relevant tests exist;
* type checking passes;
* linting passes where configured;
* build passes;
* security implications have been considered;
* documentation is updated when behavior or architecture changes;
* no unrelated files were modified.