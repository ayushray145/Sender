# Phase 3 WebRTC manual test

Automated tests validate the signaling boundary and mocked negotiation flow. A real
browser test is still required because WebRTC and NAT traversal rely on browser and
network behavior.

1. Start the signaling service: `pnpm --filter @fastshare/signaling-server start`.
2. Start the web app: `pnpm dev`.
3. Open the web app in two separate browser profiles (or two different browsers).
4. In browser A, enter the signaling WebSocket URL, optionally enter a STUN URL
   appropriate for the deployment, then select **Create room**.
5. Transfer the displayed room code and token to browser B over a secure channel.
   Browser B enters the same signaling/STUN configuration and selects **Join room**.
6. Confirm both pages report `Connection: connected` and `channel: open`.
7. Select **Send “FastShare connection test”** in either browser. The other browser
   must report receipt of that exact message.
8. Select **Disconnect** or close one page. The remaining page must no longer show
   an open channel. Repeat from step 4 to confirm a new peer can connect.

The signaling service only receives JSON room, SDP, and ICE messages during this
test. This phase deliberately has no file UI or file-transfer protocol.
