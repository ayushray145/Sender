# Phase 1 signaling protocol

FastShare sends signaling and room-control messages as UTF-8 JSON over WebSocket.
The server enforces a 64 KiB incoming-message limit and rejects binary frames.
It does not accept, store, or relay file contents.

## Client messages

- `room.create`
- `room.join` with a 10-character `roomCode` and a 256-bit `roomToken`
- `room.leave`
- `signal.offer` and `signal.answer`, each with a `{ type, sdp }` description
- `signal.ice-candidate` with candidate fields matching the browser API shape

The server validates message shape, size, allowed fields, and state. SDP and ICE
values are treated as opaque signaling payloads and are only routed to the other
member of the same ephemeral two-peer room.

## Server messages

The server sends `room.created`, `room.joined`, `peer.joined`, `peer.left`, and
the routed `signal.*` messages. Invalid input receives a safe `error` message.

Rooms, peer IDs, room codes, and room tokens exist only in process memory. Native
WebSocket ping/pong heartbeats detect dead connections; a disconnect removes the
peer from its room and notifies the remaining peer.
