# FastShare

FastShare is a browser-based peer-to-peer file-sharing project. This repository
contains a web-focused foundation and a WebSocket signaling server. Room state is
ephemeral and exists only to route signaling messages; WebRTC transfer and file
handling have not been implemented. Phase 3 adds a temporary RTCDataChannel used
only for a bidirectional connection-test message; file transfer remains unimplemented.

## Workspace

- `apps/web` — React and Vite web application shell.
- `packages/protocol` — shared signaling contracts and validation.
- `packages/transfer-core` — reserved boundary for browser transfer orchestration.
- `packages/config` — shared linting and formatting configuration.
- `server` — in-memory WebSocket signaling and temporary room lifecycle.
- `tests` — integration, performance, and fixture locations.

## Commands

```sh
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Start the signaling server with `pnpm --filter @fastshare/signaling-server start`.

For the two-browser WebRTC verification procedure, see
[`docs/webrtc-manual-test.md`](docs/webrtc-manual-test.md). Configure the browser
with `VITE_SIGNALING_URL` and, where needed, `VITE_STUN_URL`; no production service
is hard-coded.
