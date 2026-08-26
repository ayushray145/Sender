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
  readonly allowedOrigins?: readonly string[];
}): SignalingWebSocketServer {
  const signaling = new SignalingService();
  const httpServer = createServer(handleHttpRequest);
  const websocketServer = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_SIGNALING_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      const origin = info.origin;
      const allowed = options?.allowedOrigins;
      done(
        allowed === undefined || origin === undefined || allowed.includes(origin),
        403,
        'Origin not allowed',
      );
    },
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
function handleHttpRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === 'GET' && (request.url === '/' || request.url === '/health')) {
    response.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    response.end(JSON.stringify({ status: 'ok', service: 'Senderrr Signaling Server' }));
    return;
  }
  response.writeHead(404, {
    'content-type': 'application/json',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  });
  response.end(JSON.stringify({ error: 'Not found' }));
}
