# FastShare

FastShare is a browser-based peer-to-peer file-sharing project. This repository
contains a web-focused foundation and a WebSocket signaling server. Room state is
ephemeral and exists only to route signaling messages; WebRTC transfer and file
handling have not been implemented.

## Workspace

- `apps/web` — React and Vite web application shell.
- `packages/protocol` — reserved boundary for shared signaling contracts.
- `packages/transfer-core` — reserved boundary for browser transfer orchestration.
- `packages/config` — shared linting and formatting configuration.
- `server` — reserved boundary for the future signaling server.
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
