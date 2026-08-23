import {
  MAX_SIGNALING_MESSAGE_BYTES,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
  type SignalingErrorCode,
} from '@fastshare/protocol';
import type WebSocket from 'ws';
import { createPeerId } from '../security/identifiers.js';
import { safeSend } from '../utils/safe-send.js';
import { RoomRegistry } from './room-registry.js';

type PeerConnection = { readonly id: string; readonly socket: WebSocket; alive: boolean };

export class SignalingService {
  readonly rooms = new RoomRegistry();
  private readonly peers = new Map<string, PeerConnection>();
  connect(socket: WebSocket): string {
    const peerId = createPeerId();
    this.peers.set(peerId, { id: peerId, socket, alive: true });
    return peerId;
  }
  disconnect(peerId: string): void {
    if (this.peers.delete(peerId)) this.notifyDeparture(peerId);
  }
  handleRawMessage(
    peerId: string,
    rawMessage: string,
    byteLength = Buffer.byteLength(rawMessage),
  ): void {
    if (!this.peers.has(peerId)) return;
    if (byteLength > MAX_SIGNALING_MESSAGE_BYTES) {
      this.sendError(
        peerId,
        'message-too-large',
        'Signaling messages must be smaller than 64 KiB.',
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage) as unknown;
    } catch {
      this.sendError(peerId, 'malformed-json', 'The signaling message must be valid JSON.');
      return;
    }
    const result = parseClientMessage(parsed);
    if (!result.success) {
      this.sendError(peerId, 'invalid-message', 'The signaling message is invalid.');
      return;
    }
    this.handleMessage(peerId, result.value);
  }
  markAlive(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer !== undefined) peer.alive = true;
  }
  checkHeartbeats(): void {
    for (const peer of [...this.peers.values()]) {
      if (!peer.alive) {
        peer.socket.terminate();
        this.disconnect(peer.id);
        continue;
      }
      peer.alive = false;
      peer.socket.ping();
    }
  }
  get connectionCount(): number {
    return this.peers.size;
  }

  private handleMessage(peerId: string, message: ClientMessage): void {
    switch (message.type) {
      case 'room.create': {
        if (this.rooms.getRoomForPeer(peerId) !== undefined) {
          this.sendError(
            peerId,
            'invalid-state',
            'Leave the current room before creating another room.',
          );
          return;
        }
        const room = this.rooms.create(peerId);
        this.sendTo(peerId, {
          type: 'room.created',
          roomId: room.id,
          roomCode: room.code,
          roomToken: room.token,
          peerId,
        });
        return;
      }
      case 'room.join': {
        if (this.rooms.getRoomForPeer(peerId) !== undefined) {
          this.sendError(
            peerId,
            'invalid-state',
            'Leave the current room before joining another room.',
          );
          return;
        }
        const result = this.rooms.join(peerId, message.roomCode, message.roomToken);
        if (!result.success) {
          this.sendError(peerId, result.reason, 'The requested room is not available.');
          return;
        }
        this.sendTo(peerId, {
          type: 'room.joined',
          roomId: result.room.id,
          roomCode: result.room.code,
          peerId,
        });
        if (result.existingPeerId !== undefined)
          this.sendTo(result.existingPeerId, { type: 'peer.joined', peerId });
        return;
      }
      case 'room.leave':
        this.notifyDeparture(peerId);
        return;
      case 'signal.offer':
        this.routeSignal(peerId, {
          type: 'signal.offer',
          peerId,
          description: message.description,
        });
        return;
      case 'signal.answer':
        this.routeSignal(peerId, {
          type: 'signal.answer',
          peerId,
          description: message.description,
        });
        return;
      case 'signal.ice-candidate':
        this.routeSignal(peerId, {
          type: 'signal.ice-candidate',
          peerId,
          candidate: message.candidate,
        });
        return;
    }
  }
  private notifyDeparture(peerId: string): void {
    const departure = this.rooms.leave(peerId);
    if (departure?.remainingPeerId !== undefined)
      this.sendTo(departure.remainingPeerId, { type: 'peer.left', peerId });
  }
  private routeSignal(
    peerId: string,
    message: Extract<ServerMessage, { readonly type: `signal.${string}` }>,
  ): void {
    const otherPeerId = this.rooms.getOtherPeerId(peerId);
    if (otherPeerId === undefined) {
      this.sendError(peerId, 'peer-unavailable', 'No other peer is available in this room.');
      return;
    }
    this.sendTo(otherPeerId, message);
  }
  private sendError(peerId: string, code: SignalingErrorCode, message: string): void {
    this.sendTo(peerId, { type: 'error', code, message });
  }
  private sendTo(peerId: string, message: ServerMessage): void {
    const peer = this.peers.get(peerId);
    if (peer !== undefined) safeSend(peer.socket, message);
  }
}
