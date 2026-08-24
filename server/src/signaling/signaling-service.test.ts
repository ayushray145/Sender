import { MAX_SIGNALING_MESSAGE_BYTES, type ServerMessage } from '@fastshare/protocol';
import { describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { RoomManager } from './room-manager.js';
import { SignalingService } from './signaling-service.js';

class FakeSocket {
  readonly sent: ServerMessage[] = [];
  readyState = 1;
  pingCount = 0;
  terminated = false;
  get OPEN(): number {
    return 1;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  ping(): void {
    this.pingCount += 1;
  }
  terminate(): void {
    this.terminated = true;
  }
}
const asWebSocket = (socket: FakeSocket): WebSocket => socket as unknown as WebSocket;
const lastMessage = (socket: FakeSocket): ServerMessage | undefined => socket.sent.at(-1);

describe('SignalingService', () => {
  it('creates a room, joins a peer, and routes signaling payloads only to that peer', () => {
    const service = new SignalingService();
    const sender = new FakeSocket();
    const receiver = new FakeSocket();
    const senderId = service.connect(asWebSocket(sender));
    const receiverId = service.connect(asWebSocket(receiver));
    service.handleRawMessage(senderId, JSON.stringify({ type: 'room.create' }));
    const created = lastMessage(sender);
    expect(created?.type).toBe('room.created');
    if (created?.type !== 'room.created') throw new Error('Expected a room.created message.');
    service.handleRawMessage(
      receiverId,
      JSON.stringify({
        type: 'room.join',
        roomCode: created.roomCode,
        roomToken: created.roomToken,
      }),
    );
    expect(lastMessage(receiver)).toMatchObject({ type: 'room.joined', peerId: receiverId });
    expect(lastMessage(sender)).toEqual({ type: 'peer.joined', peerId: receiverId });
    service.handleRawMessage(
      senderId,
      JSON.stringify({ type: 'signal.offer', description: { type: 'offer', sdp: 'v=0\r\n' } }),
    );
    expect(lastMessage(receiver)).toEqual({
      type: 'signal.offer',
      peerId: senderId,
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });
  });

  it('allows joining a room with code only without specifying a room token', () => {
    const service = new SignalingService();
    const sender = new FakeSocket();
    const receiver = new FakeSocket();
    const senderId = service.connect(asWebSocket(sender));
    const receiverId = service.connect(asWebSocket(receiver));
    service.handleRawMessage(senderId, JSON.stringify({ type: 'room.create' }));
    const created = lastMessage(sender);
    expect(created?.type).toBe('room.created');
    if (created?.type !== 'room.created') throw new Error('Expected a room.created message.');

    service.handleRawMessage(
      receiverId,
      JSON.stringify({
        type: 'room.join',
        roomCode: created.roomCode,
      }),
    );
    expect(lastMessage(receiver)).toMatchObject({ type: 'room.joined', peerId: receiverId });
    expect(lastMessage(sender)).toEqual({ type: 'peer.joined', peerId: receiverId });
  });
  it('safely rejects malformed JSON, unsupported types, and oversized messages', () => {
    const service = new SignalingService();
    const socket = new FakeSocket();
    const peerId = service.connect(asWebSocket(socket));
    service.handleRawMessage(peerId, '{not json');
    expect(lastMessage(socket)).toMatchObject({ type: 'error', code: 'malformed-json' });
    service.handleRawMessage(peerId, JSON.stringify({ type: 'file.chunk', body: 'blocked' }));
    expect(lastMessage(socket)).toMatchObject({ type: 'error', code: 'invalid-message' });
    service.handleRawMessage(peerId, '{}', MAX_SIGNALING_MESSAGE_BYTES + 1);
    expect(lastMessage(socket)).toMatchObject({ type: 'error', code: 'message-too-large' });
  });
  it('terminates clients after repeated invalid messages and rate limits bursts', () => {
    const service = new SignalingService();
    const socket = new FakeSocket();
    const peerId = service.connect(asWebSocket(socket));
    service.handleRawMessage(peerId, '{bad');
    service.handleRawMessage(peerId, '{bad');
    service.handleRawMessage(peerId, '{bad');
    expect(socket.terminated).toBe(true);
  });
  it('cleans up room membership and notifies the remaining peer on disconnect', () => {
    const service = new SignalingService();
    const first = new FakeSocket();
    const second = new FakeSocket();
    const firstId = service.connect(asWebSocket(first));
    const secondId = service.connect(asWebSocket(second));
    service.handleRawMessage(firstId, JSON.stringify({ type: 'room.create' }));
    const created = lastMessage(first);
    if (created?.type !== 'room.created') throw new Error('Expected a room.created message.');
    service.handleRawMessage(
      secondId,
      JSON.stringify({
        type: 'room.join',
        roomCode: created.roomCode,
        roomToken: created.roomToken,
      }),
    );
    service.disconnect(secondId);
    expect(lastMessage(first)).toEqual({ type: 'peer.left', peerId: secondId });
    service.disconnect(firstId);
    expect(service.rooms.roomCount).toBe(0);
  });
  it('pings live sockets and terminates connections that miss a heartbeat', () => {
    const service = new SignalingService();
    const socket = new FakeSocket();
    const peerId = service.connect(asWebSocket(socket));
    service.checkHeartbeats();
    expect(socket.pingCount).toBe(1);
    expect(service.connectionCount).toBe(1);
    service.checkHeartbeats();
    expect(socket.terminated).toBe(true);
    expect(service.connectionCount).toBe(0);
    expect(service.rooms.getRoomForPeer(peerId)).toBeUndefined();
  });
  it('removes expired rooms before routing room-specific signaling', () => {
    let now = 0;
    const service = new SignalingService(new RoomManager({ roomTtlMs: 1_000, now: () => now }));
    const sender = new FakeSocket();
    const receiver = new FakeSocket();
    const senderId = service.connect(asWebSocket(sender));
    const receiverId = service.connect(asWebSocket(receiver));
    service.handleRawMessage(senderId, JSON.stringify({ type: 'room.create' }));
    const created = lastMessage(sender);
    if (created?.type !== 'room.created') throw new Error('Expected a room.created message.');
    service.handleRawMessage(
      receiverId,
      JSON.stringify({
        type: 'room.join',
        roomCode: created.roomCode,
        roomToken: created.roomToken,
      }),
    );

    now = 1_000;
    service.handleRawMessage(
      senderId,
      JSON.stringify({ type: 'signal.offer', description: { type: 'offer', sdp: 'v=0\r\n' } }),
    );

    expect(lastMessage(sender)).toMatchObject({ type: 'error', code: 'peer-unavailable' });
    expect(receiver.sent).toContainEqual({
      type: 'error',
      code: 'room-expired',
      message: 'The room has expired.',
    });
  });
});
