import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ROOM_TTL_MS, RoomManager } from './room-manager.js';

function createRoom(manager: RoomManager, peerId = 'sender') {
  const result = manager.create(peerId);
  if (!result.success) {
    throw new Error('Expected room creation to succeed.');
  }
  return result.room;
}

describe('RoomManager', () => {
  afterEach(() => vi.useRealTimers());

  it('creates an in-memory room with secure identifiers and lifecycle timestamps', () => {
    const manager = new RoomManager();
    const room = createRoom(manager);

    expect(room.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(room.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    expect(room.token).toMatch(/^[a-f0-9]{64}$/);
    expect(room.createdAt).toBeLessThanOrEqual(Date.now());
    expect(room.expiresAt - room.createdAt).toBe(DEFAULT_ROOM_TTL_MS);
    expect(room.state).toBe('waiting-for-peer');
    expect(room.peerIds).toEqual(new Set(['sender']));
  });

  it('allows one authorized peer to join and transitions the room to ready', () => {
    const manager = new RoomManager();
    const room = createRoom(manager);
    const result = manager.join('receiver', room.code, room.token);

    expect(result).toMatchObject({ success: true, existingPeerId: 'sender' });
    expect(room.state).toBe('ready');
    expect(room.peerIds).toEqual(new Set(['sender', 'receiver']));
  });

  it('rejects invalid room codes and unauthorized room access', () => {
    const manager = new RoomManager();
    const room = createRoom(manager);

    expect(manager.join('receiver', 'INVALID', room.token)).toEqual({
      success: false,
      reason: 'invalid-room-code',
    });
    expect(manager.join('receiver', room.code, '0'.repeat(64))).toEqual({
      success: false,
      reason: 'room-access-denied',
    });
  });

  it('prevents duplicate joins and peers joining more than one room', () => {
    const manager = new RoomManager();
    const firstRoom = createRoom(manager);
    const secondRoom = createRoom(manager, 'another-sender');

    expect(manager.join('sender', firstRoom.code, firstRoom.token)).toEqual({
      success: false,
      reason: 'duplicate-join',
    });

    expect(manager.join('receiver', firstRoom.code, firstRoom.token)).toMatchObject({
      success: true,
    });
    expect(manager.join('receiver', secondRoom.code, secondRoom.token)).toEqual({
      success: false,
      reason: 'peer-already-in-room',
    });
  });

  it('enforces the two-peer room capacity', () => {
    const manager = new RoomManager();
    const room = createRoom(manager);
    expect(manager.join('receiver', room.code, room.token)).toMatchObject({ success: true });
    expect(manager.join('third-peer', room.code, room.token)).toEqual({
      success: false,
      reason: 'room-full',
    });
  });

  it('updates room state on leave and deletes rooms that become empty', () => {
    const manager = new RoomManager();
    const room = createRoom(manager);
    manager.join('receiver', room.code, room.token);

    expect(manager.leave('receiver')).toMatchObject({ remainingPeerId: 'sender' });
    expect(room.state).toBe('waiting-for-peer');
    expect(manager.leave('sender')).toMatchObject({ remainingPeerId: undefined });
    expect(manager.getRoomByCode(room.code)).toBeUndefined();
    expect(manager.roomCount).toBe(0);
  });

  it('expires rooms and removes every expired peer membership using fake timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'));
    const manager = new RoomManager({ roomTtlMs: 1_000 });
    const room = createRoom(manager);
    manager.join('receiver', room.code, room.token);

    vi.advanceTimersByTime(1_000);
    expect(manager.expireRooms()).toEqual([room]);
    expect(manager.getRoomByCode(room.code)).toBeUndefined();
    expect(manager.getRoomForPeer('sender')).toBeUndefined();
    expect(manager.getRoomForPeer('receiver')).toBeUndefined();
  });
});
