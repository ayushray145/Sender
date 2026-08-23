import {
  createRoomCode,
  createRoomId,
  createRoomToken,
  tokensMatch,
} from '../security/identifiers.js';

export type Room = {
  readonly id: string;
  readonly code: string;
  readonly token: string;
  readonly peerIds: Set<string>;
};
export type JoinRoomResult =
  | { readonly success: true; readonly room: Room; readonly existingPeerId: string | undefined }
  | {
      readonly success: false;
      readonly reason: 'room-not-found' | 'room-access-denied' | 'room-full';
    };

export class RoomRegistry {
  private readonly roomsByCode = new Map<string, Room>();
  private readonly roomCodeByPeerId = new Map<string, string>();

  create(peerId: string): Room {
    this.leave(peerId);
    const room = this.createUniqueRoom();
    room.peerIds.add(peerId);
    this.roomsByCode.set(room.code, room);
    this.roomCodeByPeerId.set(peerId, room.code);
    return room;
  }

  join(peerId: string, roomCode: string, roomToken: string): JoinRoomResult {
    this.leave(peerId);
    const room = this.roomsByCode.get(roomCode);
    if (room === undefined) return { success: false, reason: 'room-not-found' };
    if (!tokensMatch(room.token, roomToken))
      return { success: false, reason: 'room-access-denied' };
    if (room.peerIds.size >= 2) return { success: false, reason: 'room-full' };
    const existingPeerId = room.peerIds.values().next().value;
    room.peerIds.add(peerId);
    this.roomCodeByPeerId.set(peerId, room.code);
    return { success: true, room, existingPeerId };
  }

  leave(
    peerId: string,
  ): { readonly room: Room; readonly remainingPeerId: string | undefined } | undefined {
    const roomCode = this.roomCodeByPeerId.get(peerId);
    if (roomCode === undefined) return undefined;
    const room = this.roomsByCode.get(roomCode);
    this.roomCodeByPeerId.delete(peerId);
    if (room === undefined) return undefined;
    room.peerIds.delete(peerId);
    const remainingPeerId = room.peerIds.values().next().value;
    if (room.peerIds.size === 0) this.roomsByCode.delete(room.code);
    return { room, remainingPeerId };
  }

  getOtherPeerId(peerId: string): string | undefined {
    const roomCode = this.roomCodeByPeerId.get(peerId);
    const room = roomCode === undefined ? undefined : this.roomsByCode.get(roomCode);
    return room === undefined
      ? undefined
      : [...room.peerIds].find((candidate) => candidate !== peerId);
  }
  getRoomForPeer(peerId: string): Room | undefined {
    const roomCode = this.roomCodeByPeerId.get(peerId);
    return roomCode === undefined ? undefined : this.roomsByCode.get(roomCode);
  }
  get roomCount(): number {
    return this.roomsByCode.size;
  }

  private createUniqueRoom(): Room {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = createRoomCode();
      if (!this.roomsByCode.has(code))
        return { id: createRoomId(), code, token: createRoomToken(), peerIds: new Set() };
    }
    throw new Error('Could not allocate a unique room code.');
  }
}
