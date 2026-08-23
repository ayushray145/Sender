export type RoomState = 'waiting-for-peer' | 'ready';

export type Room = {
  readonly id: string;
  readonly code: string;
  readonly token: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly peerIds: Set<string>;
  state: RoomState;
};

export function updateRoomState(room: Room): void {
  room.state = room.peerIds.size === 2 ? 'ready' : 'waiting-for-peer';
}
