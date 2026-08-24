import {
  createRoomCode,
  createRoomId,
  createRoomToken,
  isValidRoomCode,
  tokensMatch,
} from '../security/identifiers.js';
import { type Room, updateRoomState } from './room.js';

export const DEFAULT_ROOM_TTL_MS = 30 * 60 * 1000;
export const MAX_ROOM_PEERS = 2;

export type RoomManagerOptions = {
  readonly roomTtlMs?: number;
  readonly now?: () => number;
};

export type CreateRoomResult =
  | { readonly success: true; readonly room: Room }
  | { readonly success: false; readonly reason: 'peer-already-in-room' };

export type JoinRoomResult =
  | { readonly success: true; readonly room: Room; readonly existingPeerId: string }
  | {
      readonly success: false;
      readonly reason:
        | 'invalid-room-code'
        | 'room-not-found'
        | 'room-access-denied'
        | 'duplicate-join'
        | 'peer-already-in-room'
        | 'room-full';
    };

export class RoomManager {
  private readonly roomsByCode = new Map<string, Room>();
  private readonly roomCodeByPeerId = new Map<string, string>();
  private readonly roomTtlMs: number;
  private readonly now: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.roomTtlMs = options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  create(peerId: string): CreateRoomResult {
    this.expireRooms();
    if (this.roomCodeByPeerId.has(peerId)) {
      return { success: false, reason: 'peer-already-in-room' };
    }

    const createdAt = this.now();
    const room = this.createUniqueRoom(createdAt);
    room.peerIds.add(peerId);
    this.roomsByCode.set(room.code, room);
    this.roomCodeByPeerId.set(peerId, room.code);

    return { success: true, room };
  }

  join(peerId: string, roomCode: string, roomToken?: string): JoinRoomResult {
    this.expireRooms();
    if (!isValidRoomCode(roomCode)) {
      return { success: false, reason: 'invalid-room-code' };
    }

    const currentRoomCode = this.roomCodeByPeerId.get(peerId);
    if (currentRoomCode !== undefined) {
      return {
        success: false,
        reason: currentRoomCode === roomCode ? 'duplicate-join' : 'peer-already-in-room',
      };
    }

    const room = this.roomsByCode.get(roomCode);
    if (room === undefined) {
      return { success: false, reason: 'room-not-found' };
    }
    if (roomToken !== undefined && !tokensMatch(room.token, roomToken)) {
      return { success: false, reason: 'room-access-denied' };
    }
    if (room.peerIds.size >= MAX_ROOM_PEERS) {
      return { success: false, reason: 'room-full' };
    }

    const existingPeerId = room.peerIds.values().next().value;
    if (existingPeerId === undefined) {
      throw new Error('A joinable room must have a creator.');
    }
    room.peerIds.add(peerId);
    updateRoomState(room);
    this.roomCodeByPeerId.set(peerId, room.code);

    return { success: true, room, existingPeerId };
  }

  leave(
    peerId: string,
  ): { readonly room: Room; readonly remainingPeerId: string | undefined } | undefined {
    const roomCode = this.roomCodeByPeerId.get(peerId);
    if (roomCode === undefined) {
      return undefined;
    }

    const room = this.roomsByCode.get(roomCode);
    this.roomCodeByPeerId.delete(peerId);
    if (room === undefined) {
      return undefined;
    }

    room.peerIds.delete(peerId);
    updateRoomState(room);
    const remainingPeerId = room.peerIds.values().next().value;
    if (room.peerIds.size === 0) {
      this.roomsByCode.delete(room.code);
    }

    return { room, remainingPeerId };
  }

  expireRooms(): readonly Room[] {
    const now = this.now();
    const expiredRooms: Room[] = [];

    for (const room of this.roomsByCode.values()) {
      if (room.expiresAt > now) {
        continue;
      }

      this.roomsByCode.delete(room.code);
      for (const peerId of room.peerIds) {
        this.roomCodeByPeerId.delete(peerId);
      }
      expiredRooms.push(room);
    }

    return expiredRooms;
  }

  getOtherPeerId(peerId: string): string | undefined {
    const room = this.getRoomForPeer(peerId);
    return room === undefined
      ? undefined
      : [...room.peerIds].find((candidatePeerId) => candidatePeerId !== peerId);
  }

  getRoomForPeer(peerId: string): Room | undefined {
    const roomCode = this.roomCodeByPeerId.get(peerId);
    return roomCode === undefined ? undefined : this.roomsByCode.get(roomCode);
  }

  getRoomByCode(roomCode: string): Room | undefined {
    return this.roomsByCode.get(roomCode);
  }

  get roomCount(): number {
    return this.roomsByCode.size;
  }

  private createUniqueRoom(createdAt: number): Room {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = createRoomCode();
      if (!this.roomsByCode.has(code)) {
        return {
          id: createRoomId(),
          code,
          token: createRoomToken(),
          createdAt,
          expiresAt: createdAt + this.roomTtlMs,
          peerIds: new Set(),
          state: 'waiting-for-peer',
        };
      }
    }

    throw new Error('Could not allocate a unique room code.');
  }
}
