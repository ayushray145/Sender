import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createPeerId(): string {
  return randomUUID();
}
export function createRoomId(): string {
  return randomUUID();
}
export function createRoomCode(): string {
  const bytes = randomBytes(10);
  let code = '';
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}
export function createRoomToken(): string {
  return randomBytes(32).toString('hex');
}
export function tokensMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return (
    expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
  );
}
