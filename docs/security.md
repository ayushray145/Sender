# FastShare security

## Threat model and trust boundaries

FastShare has unauthenticated browsers, a signaling server, and direct WebRTC
peers. The server is trusted only to validate and route small room-control, SDP,
and ICE messages; it must never receive file payloads. Peers are mutually
untrusted until possession of the room token is proven. Files, filenames, SDP,
ICE values, and every network message are untrusted input.

## Attack surfaces and mitigations

- WebSocket abuse: strict schemas, a 64 KiB message limit, origin allowlisting,
  per-connection rate limits, and termination after repeated violations.
- Room guessing and unauthorized signaling: cryptographically random room tokens,
  constant-time token comparison, two-peer limits, expiry, and membership-only
  signal routing.
- Web rendering: React text rendering only; do not use unsafe HTML injection.
  Send CSP and standard browser security headers.
- Transfer abuse: metadata schema and 100 MiB Phase-4 maximum, ordered chunk and
  size validation, bounded DataChannel buffering, cancellation, and SHA-256
  integrity verification.

## Known limitations

WebRTC transport encryption does not provide application authorization; room
membership remains the authorization boundary. There are no accounts or durable
audit logs. TURN, malware scanning, and content-policy enforcement are outside
the MVP. Production deployments must use HTTPS and WSS and configure allowed
origins explicitly.
