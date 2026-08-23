import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_SIGNALING_MESSAGE_BYTES } from '@fastshare/protocol';
import { SignalingService } from '../signaling/signaling-service.js';

export type SignalingWebSocketServer = {
  readonly httpServer: Server;
  readonly websocketServer: WebSocketServer;
  readonly signaling: SignalingService;
  close(): Promise<void>;
};
export function createSignalingWebSocketServer(options?: {
  readonly heartbeatIntervalMs?: number;
}): SignalingWebSocketServer {
  const signaling = new SignalingService();
  const httpServer = createServer(handleHttpRequest);
  const websocketServer = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_SIGNALING_MESSAGE_BYTES,
  });
  const heartbeat = setInterval(
    () => signaling.checkHeartbeats(),
    options?.heartbeatIntervalMs ?? 30_000,
  );
  websocketServer.on('connection', (socket) => bindConnection(signaling, socket));
  websocketServer.on('close', () => clearInterval(heartbeat));
  return {
    httpServer,
    websocketServer,
    signaling,
    close: async () => {
      clearInterval(heartbeat);
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}
function bindConnection(signaling: SignalingService, socket: WebSocket): void {
  const peerId = signaling.connect(socket);
  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      signaling.handleRawMessage(peerId, '', MAX_SIGNALING_MESSAGE_BYTES + 1);
      return;
    }
    const text = data.toString();
    signaling.handleRawMessage(peerId, text, Buffer.byteLength(text));
  });
  socket.on('pong', () => signaling.markAlive(peerId));
  socket.on('close', () => signaling.disconnect(peerId));
  socket.on('error', () => signaling.disconnect(peerId));
}
function handleHttpRequest(_request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
}
