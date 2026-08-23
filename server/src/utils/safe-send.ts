import type { ServerMessage } from '@fastshare/protocol';
import type WebSocket from 'ws';

export function safeSend(socket: WebSocket, message: ServerMessage): boolean {
  if (socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}
