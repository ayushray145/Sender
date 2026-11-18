# FastShare

FastShare is a browser-based file-transfer application. Two people meet in a temporary room, use a signaling service to negotiate a WebRTC connection, and send file data directly between their browsers over a WebRTC DataChannel. The signaling service coordinates the connection; it is not the file-transfer path.

This repository is an actively evolving project foundation. The implementation currently supports one connected peer per room and sequential file transfers of up to **100 MiB per file**. The user interface contains copy that says “up to 5 GiB per room session”; that claim is ahead of the current transfer implementation. Do not rely on 5 GiB or aggregate-session enforcement until the transfer limit and memory behavior have been implemented and verified.

## Contents

- [Project status and current limits](#project-status-and-current-limits)
- [How a transfer works](#how-a-transfer-works)
- [Architecture](#architecture)
- [Repository map](#repository-map)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Configuration](#configuration)
- [Run the application](#run-the-application)
- [Use the application](#use-the-application)
- [Signaling protocol](#signaling-protocol)
- [WebRTC negotiation](#webrtc-negotiation)
- [File-transfer protocol](#file-transfer-protocol)
- [Room and server lifecycle](#room-and-server-lifecycle)
- [Security and privacy](#security-and-privacy)
- [Testing and manual verification](#testing-and-manual-verification)
- [Build and deployment](#build-and-deployment)
- [Troubleshooting](#troubleshooting)
- [Known gaps and next steps](#known-gaps-and-next-steps)

## Project status and current limits

The project has a React and TypeScript browser client, a Node.js WebSocket signaling server, shared runtime validation for signaling messages, and a browser transfer manager. Current behavior and limits visible in the source are:

| Area | Implemented behavior |
| --- | --- |
| Room participants | One room creator and at most one joining peer |
| Room lifetime | In-memory room; default lifetime is 30 minutes; room is removed when empty |
| File transfer | One active file at a time, sent sequentially over the open DataChannel |
| Maximum file size | 100 MiB per file (`100 * 1024 * 1024` bytes) |
| Chunk payload | 64 KiB, with a 12-byte binary frame header |
| Integrity | SHA-256 digest is sent in metadata and checked by the receiver before exposing the received file |
| Transfer storage | No server file storage; receiver retains chunks in browser memory until completion |
| Aggregate room quota | No enforced 5 GiB aggregate quota in the current transfer manager |
| Multiple selected files | The UI queues selected files and sends them one at a time; each file is still subject to the per-file limit |
| TURN | ICE configuration in the browser hook includes public STUN and a public OpenRelay TURN configuration; availability and terms are outside this repository’s control |
| Accounts | None |

The SHA-256 helper currently calls `Blob.arrayBuffer()`, and the receiver also accumulates chunk parts before creating and hashing a `File`. Consequently, the current implementation is not a bounded-memory streaming implementation for large files. Keep files within the implemented 100 MiB cap, and test on target devices before relying on large transfers.

## How a transfer works

There are two network paths. Keeping them separate is a central design requirement:

```text
                         signaling only
Browser A  <-------------------------------------->  Signaling server  <-------------------------------------->  Browser B
    |                                                                                                               |
    +-------------------------------- WebRTC DataChannel: control messages and file chunks -------------------------+
```

The signaling path carries room operations and WebRTC negotiation data (SDP offers/answers and ICE candidates). The file path is a peer-to-peer WebRTC DataChannel between the browsers. The signaling server does not accept a file-upload endpoint and does not relay the binary file frames.

### End-to-end sequence

1. **Configure both browsers.** Each browser loads the web application and obtains its signaling WebSocket URL and ICE configuration. `VITE_SIGNALING_URL` overrides the signaling URL; `VITE_STUN_URL` can add a STUN server. The hook also includes default public STUN and TURN entries.
2. **Create a temporary room.** The sending browser opens a WebSocket and sends `room.create`. The server creates an in-memory room, a random room code, a random room token, and a peer ID, then returns `room.created`.
3. **Share the invitation.** The creator can share a room code or a URL containing the code and token. A receiver opening a URL with `code` (and optionally `token`) is switched to the Receive tab and gets the values prefilled.
4. **Join the room.** The receiving browser opens its WebSocket and sends `room.join`. The server checks that the room exists, has not expired, has capacity, and—when a token is supplied—that the token matches. The server notifies both peers that the peer joined.
5. **Negotiate WebRTC.** The creator receives `peer.joined`, creates an `RTCPeerConnection` and a DataChannel, creates an SDP offer, and sends it through the signaling server. The receiver sets the remote offer, creates an answer, and sends it back. Both sides exchange ICE candidates through the server. Candidates received before the remote description are queued and applied afterward.
6. **Establish the DataChannel.** ICE connectivity establishes the peer connection. The DataChannel opens and the browser UI reports the connection state. A built-in connection-test message can be sent to check basic data-channel messaging before sending files.
7. **Prepare each file.** The sender checks that the channel is open and that the file is no larger than 100 MiB. It calculates a SHA-256 digest, generates a transfer ID, and sends a JSON `file.metadata` control message.
8. **Send chunks.** The sender reads successive 64 KiB `Blob` slices as `ArrayBuffer`s, adds a binary frame header, and sends them over the DataChannel. It checks `bufferedAmount` and waits for `bufferedamountlow` when the queue is above the configured threshold. Progress callbacks update the queue UI.
9. **Validate and assemble.** The receiver requires metadata before binary chunks, checks frame structure, sequence order, chunk length, and total declared size, then retains each payload. On `file.complete`, it checks chunk count and byte totals, assembles a `File`, calculates SHA-256, and only exposes the file if the digest matches.
10. **Download or cancel.** The receiver can download an individual received file or create a ZIP containing the received files. Either side can cancel the active transfer; disconnecting or closing the connection destroys transfer state. A room is removed when it becomes empty or expires.

## Architecture

### Browser application

`apps/web` is a Vite application using React 19 and TypeScript. `src/main.tsx` finds the HTML root element, mounts the React tree under `StrictMode`, and imports the stylesheet. `src/App.tsx` renders the user experience: send/receive tabs, room creation and joining, room credentials, share link and QR display, connection status, drag-and-drop and file selection, queue/progress states, cancellation, received-file downloads, and ZIP download.

The React component delegates connection lifecycle to `useFastShareConnection` in `src/hooks/`. That hook creates and owns the signaling client, peer-connection manager, and file-transfer manager. It translates callbacks from those components into React state and sequentially processes selected files. Browser networking is separated into `src/network/signaling-client.ts` and `src/network/peer-connection-manager.ts`; transfer framing and file validation live in the shared `packages/transfer-core` package.

`src/utils.ts` formats byte counts and builds/parses invitation URLs. `src/zip.ts` implements a small, dependency-free, uncompressed ZIP writer for downloading all received files together. It reads each file into an `ArrayBuffer` when building the archive, so ZIP creation also needs enough browser memory for the input files and output blob.

### Signaling server

`server` is a Node.js service built on the `ws` WebSocket library and Node’s HTTP server. The HTTP server responds to `GET /` and `GET /health` with a small JSON health response. WebSocket connections are bound to a `SignalingService`; incoming text is size-limited, parsed, validated by the shared protocol package, rate-limited, and then handled as a room operation or routed to the other room member.

The server keeps its peer and room maps in process memory. It sends room events, error messages, and SDP/ICE messages only. It has no database, object storage, file upload route, or durable room history. Restarting the process therefore drops all rooms and connections.

### Shared packages

- `packages/protocol` defines TypeScript message unions, limits, error codes, and strict runtime parsers for client-to-server and server-to-client signaling messages.
- `packages/transfer-core` defines file-transfer control messages and binary chunk framing, hashes files, manages one active sender/receiver operation, reports progress, applies DataChannel backpressure, and handles cancellation.
- `packages/config` exports shared ESLint and Prettier configuration.

### Important boundaries

1. **UI boundary:** React handles user interaction and presentation. It should not become the owner of WebRTC signaling rules or binary framing.
2. **Signaling boundary:** `SignalingClient` accepts validated server messages and sends typed client messages. It does not carry file bytes.
3. **Peer boundary:** `PeerConnectionManager` owns one `RTCPeerConnection`, negotiation, ICE candidates, and the DataChannel. It handles only the small connection-test text message itself; the transfer manager consumes file-control and binary messages.
4. **Transfer boundary:** `FileTransferManager` operates on an already-open reliable, ordered RTCDataChannel. It knows transfer metadata, chunks, integrity, progress, backpressure, and cancellation, but does not create rooms or negotiate WebRTC.
5. **Server boundary:** shared runtime parsers protect the server from malformed signaling inputs. The server routes SDP and ICE to a room peer but never interprets file payloads.

## Repository map

```text
.
├── apps/
│   └── web/                         React + Vite browser application
│       ├── public/images/           Static image assets
│       └── src/
│           ├── App.tsx              Main screen and user interactions
│           ├── hooks/               React connection and transfer state
│           ├── network/             WebSocket signaling and WebRTC manager
│           ├── styles.css           Application styles
│           ├── utils.ts             Byte formatting and invitation URLs
│           └── zip.ts               In-browser ZIP archive creation
├── docs/
│   ├── protocol.md                  Signaling protocol notes
│   ├── requirements.md              Phase 1 signaling requirements
│   ├── security.md                  Threat model and current mitigations
│   └── webrtc-manual-test.md        Two-browser verification procedure
├── packages/
│   ├── config/                      Shared lint/format configuration
│   ├── protocol/                    Shared signaling types and validators
│   └── transfer-core/               Browser file-transfer manager/protocol
├── scripts/                         Project scripts (if present)
├── server/
│   └── src/
│       ├── index.ts                 Server entry point and PORT validation
│       ├── security/                Secure room and peer identifiers
│       ├── signaling/               Room lifecycle and message routing
│       ├── utils/                   Safe WebSocket send helper
│       └── websocket/               HTTP and WebSocket server setup
├── tests/                           Integration/performance/fixture location
├── Dockerfile                       Signaling-server container definition
├── package.json                    Workspace scripts and toolchain metadata
├── pnpm-lock.yaml                  Locked dependency graph
├── pnpm-workspace.yaml              pnpm workspace package globs
├── tsconfig.base.json               Shared strict TypeScript options
├── tsconfig.json                    TypeScript project references
└── README.md                        This project guide
```

The `scripts/` and `tests/` directories are currently locations for future or additional project work; the commands and test files that actually exist are defined by each package’s `package.json`.

## Requirements

- Node.js **22 or newer**, as declared by the root package’s `engines` field.
- pnpm **10.33.0**, as declared in `packageManager`. Use Corepack or install that pnpm version directly.
- A modern browser with WebRTC, `RTCPeerConnection`, `RTCDataChannel`, Web Crypto (`crypto.subtle`), `File`, and `Blob` support.
- Network access between the browser and the signaling WebSocket endpoint.
- For peer connectivity across NATs/firewalls, usable STUN/TURN services. STUN-only direct connectivity is not guaranteed on every network.
- HTTPS/WSS for a production deployment. Browsers generally require a secure context for production WebRTC/Web Crypto use; `localhost` is suitable for local development.

The Dockerfile currently starts from Node 20 even though the workspace declares Node 22 or newer. Align the image version before treating container deployment as a supported build path.

## Local setup

Run commands from the repository root (the directory containing this README, `pnpm-workspace.yaml`, and the root `package.json`).

1. **Install Node.js 22+.** Confirm the executable:

   ```sh
   node --version
   ```

   It must report `v22` or higher.

2. **Enable the project’s pnpm version with Corepack** (if Corepack is included in your Node installation):

   ```sh
   corepack enable
   corepack prepare pnpm@10.33.0 --activate
   pnpm --version
   ```

   Confirm the final command reports `10.33.0`.

3. **Install the locked dependencies:**

   ```sh
   pnpm install --frozen-lockfile
   ```

   `--frozen-lockfile` makes pnpm use `pnpm-lock.yaml` as-is and fail instead of silently changing the dependency graph.

4. **Set local browser configuration if needed.** Copy `apps/web/.env.example` to `apps/web/.env.local` and edit the values. Vite loads the variables from the web app’s environment. `.env*` files are ignored by Git except for `.env.example`; do not place credentials in a variable prefixed with `VITE_`, because Vite embeds those values into browser code.

5. **Start both processes** in separate terminals as described in [Run the application](#run-the-application).

## Configuration

| Variable | Used by | Default / behavior | Notes |
| --- | --- | --- | --- |
| `VITE_SIGNALING_URL` | Browser build/runtime | `ws://localhost:8080`; if unset on an HTTPS page, the app derives `wss://<current-host>` | Must point to the signaling WebSocket service. Use `wss://` in production. This is a public client setting, not a secret. |
| `VITE_STUN_URL` | Browser build/runtime | `stun:stun.l.google.com:19302` | Adds the configured STUN URL before the hook’s built-in ICE server list. Despite the variable name, this setting accepts a STUN URL; it does not configure credentials for a private TURN service. |
| `PORT` | Signaling server | `8080` | Must be an integer from 1 to 65535. |

The web hook currently also includes public Google STUN entries and a public OpenRelay TURN entry with public example credentials. These are convenience defaults in code, not a managed or guaranteed production service. Production operators should review, replace, or remove them and configure infrastructure they control. The current server entry point does not wire an origin allowlist from environment configuration; review and explicitly configure origin policy before public deployment.

## Run the application

The web development server and signaling server are separate processes.

**Terminal 1 — signaling server:**

```sh
pnpm --filter @fastshare/signaling-server start
```

The server listens on `PORT` or `8080` and logs its port. Check its health endpoint in a browser or with a request to `http://localhost:8080/health`; it should return JSON similar to `{"status":"ok","service":"Senderrr Signaling Server"}`.

**Terminal 2 — web application:**

```sh
pnpm dev
```

Vite prints the local URL (normally `http://localhost:5173`). Open that address in the browser. If the signaling server is not on `localhost:8080`, set `VITE_SIGNALING_URL` before starting Vite.

### Root scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the web app’s Vite development server. It does **not** start the signaling server. |
| `pnpm build` | Builds the web package: TypeScript project build followed by Vite production bundle. |
| `pnpm test` | Runs the `test` script recursively in workspace packages that define one. |
| `pnpm typecheck` | Runs TypeScript in build mode using the root project references. |
| `pnpm lint` | Runs ESLint from the workspace root. |
| `pnpm format:check` | Checks formatting with the shared Prettier configuration. |
| `pnpm format` | Rewrites formatting across the workspace; inspect the resulting diff before accepting it. |
| `pnpm --filter @fastshare/signaling-server start` | Starts only the signaling server. |

There is no root script that starts both the web app and server together.

## Use the application

### Create a room (sender)

1. Open the application and leave the **Send** tab selected.
2. Select **Create Room**.
3. Wait for the signaling connection and room response. The displayed room code and share controls appear after the server returns `room.created`.
4. Share the code with the other person. When available, you can copy the share link or show the QR code.
5. Keep the page open while the other person joins. The room is temporary and the connection is tied to the current process/page lifecycle.

### Join a room (receiver)

1. Open the application, select **Receive**, and enter the room code. A valid code is 10 characters from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (ambiguous characters are excluded).
2. If the sender provided the full link, open it instead; the app reads the `code` and optional `token` query parameters and prefills the form.
3. Select **Join Room**. When the peer connection and DataChannel are ready, the connection status changes to connected.

### Send and receive files

1. Wait until the page reports the DataChannel as open.
2. Select files or drag them into the drop zone. The hook builds a queue and sends each file sequentially.
3. Each file must be no larger than 100 MiB. If one queued file fails or is cancelled, later queued files are marked cancelled.
4. Progress is reported per active file and in the queue. Select **Cancel**/**Cancel All** to cancel active work.
5. The receiver sees the received file after metadata, all chunks, completion totals, and SHA-256 integrity checks pass. Download a file individually or download the received set as a ZIP.
6. Select **Disconnect** when finished. Disconnect tears down local transfer, WebRTC, and WebSocket objects and clears current page state.

### Share-link and QR privacy

The share URL can contain both the room code and the 256-bit room token as query parameters. Treat the full link like a temporary credential and share it only with the intended receiver. The current QR image is fetched from `api.qrserver.com` with the full share URL included in the request URL, so that third-party QR service can receive the room code and token. Do not use the remote QR option for sensitive transfers unless that disclosure is acceptable; a locally generated QR code would remove this third-party request.

## Signaling protocol

Signaling messages are UTF-8 JSON text frames over WebSocket. `packages/protocol/src/messages.ts` defines both message types and runtime parsers. Parsers require exact fields, validate lengths and types, and reject unknown message types. The WebSocket server rejects binary frames and caps incoming payloads at 64 KiB. SDP is capped at 48 KiB; an ICE candidate string is capped at 16 KiB.

### Client-to-server messages

| Message | Purpose |
| --- | --- |
| `room.create` | Create a new room for the connected peer. |
| `room.join` | Join a room by `roomCode`, optionally including `roomToken`. |
| `room.leave` | Remove the connected peer from its room. |
| `signal.offer` | Route an SDP offer to the other peer in the same room. |
| `signal.answer` | Route an SDP answer to the other peer in the same room. |
| `signal.ice-candidate` | Route an ICE candidate to the other peer in the same room. |

### Server-to-client messages

| Message | Purpose |
| --- | --- |
| `room.created` | Returns the room ID, code, token, and creator peer ID. |
| `room.joined` | Confirms the joining peer and returns room ID and code. |
| `peer.joined` | Tells the existing peer that a second peer joined. |
| `peer.left` | Tells a remaining peer that the other peer left or disconnected. |
| `signal.offer`, `signal.answer`, `signal.ice-candidate` | Deliver validated negotiation data from the other room member. |
| `error` | Returns a bounded safe message and a defined error code. |

Every room control, SDP, and ICE message is validated before it is acted on. SDP and ICE values are treated as opaque payloads by the server: it routes them to the other peer and does not use them as file-transfer data.

## WebRTC negotiation

`PeerConnectionManager` creates one `RTCPeerConnection` for the room. When the creator receives `peer.joined`, it creates the `fastshare-control` DataChannel, creates an SDP offer, sets its local description, and sends the resulting SDP through signaling. The joiner receives the offer, sets it as the remote description, creates and sets an answer, then signals the answer back. Each side sends gathered ICE candidates as signaling messages.

ICE candidates may arrive before the remote description is ready. The manager stores those candidates in a pending list and flushes them after applying the remote offer or answer. Candidate-addition failures are treated as non-fatal because candidates can be redundant or obsolete. The manager reports connection, ICE, and DataChannel states to the hook and closes/reset resources on peer departure or connection failure.

The connection uses the browser’s WebRTC transport security. TURN may relay encrypted WebRTC packets when direct connectivity cannot be established; it still does not imply application-level end-to-end authorization or protect a room invitation that has been shared with the wrong person.

## File-transfer protocol

The transfer protocol is separate from the signaling protocol and runs only over the established DataChannel. Text frames are JSON control messages; binary frames contain file bytes.

### Control messages

- **`file.metadata`** announces `transferId`, filename, MIME type, file size, chunk size, expected chunk count, and SHA-256 hex digest. Runtime validation rejects invalid IDs, oversized names/types, invalid sizes, invalid hashes, inconsistent chunk counts, extra properties, and unknown control types.
- **`file.complete`** announces the transfer ID, final number of chunks, and final byte count. The receiver compares these values to the metadata and what it actually received.
- **`file.cancel`** announces cancellation for a transfer ID.

### Binary chunk frames

Each binary frame has a 12-byte header followed by the payload:

| Byte offset | Width | Field |
| --- | ---: | --- |
| 0 | 4 bytes | Magic marker `0x46534852` (`FSHR`) |
| 4 | 4 bytes | Unsigned 32-bit chunk sequence number |
| 8 | 4 bytes | Unsigned 32-bit payload length |
| 12 | remaining bytes | Chunk payload, up to 64 KiB |

The sender emits sequence numbers starting at zero. The receiver rejects malformed frames, unexpected magic, incorrect length fields, missing metadata, out-of-order sequence numbers, zero-byte chunks, chunks larger than declared, and bytes exceeding the declared file size. `file.complete` is accepted only when actual chunk count and byte count equal the metadata values. SHA-256 is compared before the resulting `File` is reported as received.

### Backpressure, memory, and cancellation

The transfer manager sets `bufferedAmountLowThreshold` to 512 KiB and uses a 1 MiB high-water check before sending the next chunk. It waits for `bufferedamountlow` when the DataChannel queue is above that threshold. This limits queued outbound DataChannel data but does not make the whole file operation constant-memory: hashing currently reads the complete `Blob` into an `ArrayBuffer`, and the receiver stores all chunks until assembly and verification. The sender and receiver support cancellation of the current transfer; this is not resumable transfer, and closing/disconnecting loses the in-progress transfer.

## Room and server lifecycle

`RoomManager` stores rooms by code and peer-to-room membership in maps. Room IDs, peer IDs, and room tokens use Node cryptographic APIs (`randomUUID`, `randomBytes`). Room codes are 10 characters chosen from an ambiguity-reduced alphabet. Tokens are 32 random bytes encoded as 64 hex characters and compared with `timingSafeEqual` when supplied.

A room begins in `waiting-for-peer`, becomes `ready` when two peers are members, and is limited to two peers. The default TTL is 30 minutes. Expiration is checked during room operations and heartbeat cleanup; expired peers receive an error and room state is removed. A room is deleted as soon as its last peer leaves. WebSocket ping/pong heartbeats run every 30 seconds by default; a peer missing a heartbeat is terminated and removed, and its remaining peer receives `peer.left`.

The signaling service applies a limit of 60 messages per peer per 10-second window. Each protocol violation increments a counter; after three violations the server terminates that connection. The WebSocket implementation also applies its own maximum-payload limit. These controls are in-memory and per process; they are not a distributed abuse-prevention system.

## Security and privacy

Security behavior is summarized in [`docs/security.md`](docs/security.md), with signaling details in [`docs/protocol.md`](docs/protocol.md). Key properties and caveats:

- **Files do not go through the signaling server.** They travel as binary RTCDataChannel frames between browsers. Do not add file bytes to WebSocket signaling messages.
- **Rooms are temporary and unauthenticated.** The room code is an identifier, and the optional token is an additional room credential. Anyone given the invitation link can attempt to join while the room is available.
- **No permanent storage or account system exists.** Rooms, peer IDs, and connection state live in the signaling process memory; received files live in the browser page’s memory until the user downloads them or closes the page.
- **Use secure deployment URLs.** Production should serve the web app over HTTPS and signaling over WSS, usually with a TLS-terminating reverse proxy or hosting platform. No production TLS setup is included here.
- **Untrusted input is validated.** The protocol rejects unexpected fields and bounded strings; UI filenames are rendered as React text rather than injected HTML. Continue treating all remote metadata as untrusted.
- **Integrity is checked, authorization is separate.** SHA-256 detects content changes against the digest supplied by the sender. It does not prove the sender’s identity or protect against a malicious peer who chooses both content and digest.
- **QR sharing calls a third party.** As described above, the current external QR endpoint receives the share URL, including its token.
- **Review defaults before public deployment.** The current code includes public STUN/TURN defaults, and the server entry point does not configure a production origin allowlist. Configure controlled ICE services, origin policy, TLS, hosting limits, and operational monitoring for a real deployment.
- **No application-level file encryption protocol is implemented.** WebRTC encrypts transport; a separate application-level cryptographic protocol would need careful design using established Web Crypto primitives if required.

Do not commit credentials, `.env` files containing secrets, generated output, `node_modules`, or large test files. Variables beginning with `VITE_` are public browser configuration and must never contain secrets.

## Testing and manual verification

Automated tests are colocated with implementation files and currently cover protocol parsing, room lifecycle/signaling behavior, transfer framing/state, signaling-client and WebRTC manager behavior, and ZIP generation in selected cases. Run the workspace commands from the repository root:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Passing mocked tests does not verify browser ICE negotiation, NAT traversal, browser memory use, or real transfer performance. Use [`docs/webrtc-manual-test.md`](docs/webrtc-manual-test.md) for a two-browser check:

1. Start the signaling server and Vite web app in separate terminals.
2. Open two distinct browser profiles or browsers.
3. Create a room in the first and join from the second using the code/token.
4. Confirm both clients report a connected peer and open DataChannel.
5. Send the connection-test message and confirm it arrives.
6. Transfer test files up to the implemented 100 MiB per-file limit; compare the downloaded file’s SHA-256 with the original.
7. Disconnect or close one side and confirm the other side observes the channel/peer departure.

For performance measurements, use generated test files and record browser version, operating system, network conditions, file size, elapsed time, throughput, failures, and memory use. Do not commit large generated files.

## Build and deployment

The production web bundle is produced by:

```sh
pnpm build
```

Vite writes static assets to the web app’s `dist/` directory. Serve those files from a static web host over HTTPS and set `VITE_SIGNALING_URL` at build time to the WSS endpoint. Vite environment values are compiled into the client bundle, so they are configuration, not secrets.

The signaling process starts with:

```sh
PORT=8080 pnpm --filter @fastshare/signaling-server start
```

On PowerShell, set the variable in the current session first:

```powershell
$env:PORT = "8080"
pnpm --filter @fastshare/signaling-server start
```

The included `Dockerfile` is intended to run the signaling server and exposes port 8080. It copies the root package files, shared packages, and server before installation. Before using it, update its Node base image to satisfy the root Node >=22 engine, then build and run it according to your container platform’s process. The Dockerfile does not serve the React application, provision TLS, persist room state, or configure private STUN/TURN services.

Production checklist:

1. Use a supported Node version and install with the committed lockfile.
2. Build the static web app with the correct WSS signaling URL.
3. Put the web client behind HTTPS and the signaling server behind WSS/TLS.
4. Configure allowed origins and controlled STUN/TURN services; the current executable does not read origin allowlist configuration, so this requires a code/deployment change before public exposure.
5. Verify reverse proxy WebSocket upgrade support, idle timeouts, request limits, and health checks.
6. Test room creation, joining, signaling, file integrity, cancellation, expiry, and disconnect behavior across the actual deployment networks.
7. Review privacy implications of invitation URLs, browser memory usage, logs, and the external QR service.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Browser cannot connect to signaling | Confirm the signaling process is running, `VITE_SIGNALING_URL` uses the right host/port and `ws://` locally or `wss://` in production, and network/proxy rules allow WebSocket upgrades. Restart Vite after changing environment variables. |
| Room code is rejected or unavailable | Confirm all 10 characters are correct, the room has not expired, the server has not restarted, and the creator is still in the room. A room is deleted when empty. |
| Peer joins but DataChannel never opens | Check browser console ICE/connection state logs, firewall/NAT behavior, STUN/TURN reachability, and whether the deployed service allows the WebSocket signaling traffic. STUN does not guarantee a direct path on every network. |
| File send fails immediately | Ensure the DataChannel is open and the file is no larger than 100 MiB. Check the visible error and browser console. |
| Receiver reports an invalid or incomplete transfer | Keep both pages connected until completion; do not reload either page. Retry the transfer and compare SHA-256 only after a completed download. |
| Large file causes high memory use | This implementation hashes via full `Blob.arrayBuffer()` and retains received chunks in memory. Reduce file size; true bounded-memory streaming is not implemented. |
| QR link does not work | Ensure the receiver can open the same web app origin and the room/token are still valid. The QR image itself is fetched from the external QR service; copying the link manually is an alternative. |
| `pnpm install` rejects the environment | Check Node >=22, pnpm 10.33.0, and use `pnpm install --frozen-lockfile` from the project root. |

## Known gaps and next steps

These are implementation facts to keep in mind when extending the project, not claims that the features already exist:

1. **Resolve the file-size copy mismatch.** The UI currently advertises up to 5 GiB per session, while `packages/transfer-core/src/file-transfer-manager.ts` rejects individual files above 100 MiB and has no aggregate-session quota. Keep the user-facing copy aligned with enforced limits or implement and verify the intended quota first.
2. **Implement bounded-memory hashing and receiving before raising limits.** Current hashing reads the entire file into memory and the receiver stores all chunks before assembly. A larger limit requires a design for incremental hashing and a storage/streaming approach compatible with browsers.
3. **Set and enforce an aggregate transfer quota.** Multiple files can be queued, but there is no enforced total room/session byte limit or file-count limit in the transfer core.
4. **Review protocol resilience.** The WebRTC manager implements the current offerer/answerer flow and candidate queue, but not the full standardized perfect-negotiation pattern described as a preferred engineering principle in `AGENTS.md`.
5. **Make deployment security configurable.** Wire an explicit allowed-origin policy into the server entry point and provide deployment guidance for owned TURN credentials, TLS, and service limits.
6. **Remove or localize sensitive QR generation.** Avoid sending the room invitation URL to an external QR endpoint if the desired privacy boundary excludes that service.
7. **Align container runtime version.** Update the Docker image from Node 20 to Node 22+ to match the declared engine.
8. **Expand real-browser and performance coverage.** Automated mocks cannot establish NAT traversal reliability, realistic throughput, memory use, or behavior on mobile browsers.

When a design document conflicts with the implementation, document the discrepancy and resolve it in a focused change. The root `AGENTS.md` lists the project’s engineering constraints and the source documents contributors should read before architectural work.
