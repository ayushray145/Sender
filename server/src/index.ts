import { fileURLToPath } from 'node:url';
import { createSignalingWebSocketServer } from './websocket/signaling-websocket-server.js';

export function getPort(value: string | undefined): number {
  if (value === undefined) return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('PORT must be an integer between 1 and 65535.');
  return port;
}
export function startSignalingServer(port = getPort(process.env.PORT)): void {
  const server = createSignalingWebSocketServer();
  server.httpServer.listen(port, () =>
    console.info(`FastShare signaling server listening on port ${port}.`),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) startSignalingServer();
