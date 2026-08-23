export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const CHUNK_SIZE = 64 * 1024;
export const CHUNK_HEADER_BYTES = 12;
const CHUNK_MAGIC = 0x46534852; // "FSHR"

export type FileMetadata = {
  readonly type: 'file.metadata';
  readonly transferId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly chunkSize: number;
  readonly totalChunks: number;
  readonly sha256: string;
};
export type TransferComplete = {
  readonly type: 'file.complete';
  readonly transferId: string;
  readonly totalChunks: number;
  readonly size: number;
};
export type TransferCancel = { readonly type: 'file.cancel'; readonly transferId: string };
export type TransferControlMessage = FileMetadata | TransferComplete | TransferCancel;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}
function isTransferId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function parseTransferControlMessage(value: unknown): TransferControlMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'file.metadata') {
    if (
      !hasOnlyKeys(value, [
        'type',
        'transferId',
        'name',
        'mimeType',
        'size',
        'chunkSize',
        'totalChunks',
        'sha256',
      ]) ||
      !isTransferId(value.transferId) ||
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      value.name.length > 255 ||
      typeof value.mimeType !== 'string' ||
      value.mimeType.length > 255 ||
      !isIntegerInRange(value.size, 0, MAX_FILE_BYTES) ||
      !isIntegerInRange(value.chunkSize, 1, CHUNK_SIZE) ||
      !isIntegerInRange(value.totalChunks, 0, Math.ceil(MAX_FILE_BYTES / 1)) ||
      typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(value.sha256) ||
      value.totalChunks !== Math.ceil(value.size / value.chunkSize)
    )
      return undefined;
    return value as FileMetadata;
  }
  if (value.type === 'file.complete') {
    if (
      !hasOnlyKeys(value, ['type', 'transferId', 'totalChunks', 'size']) ||
      !isTransferId(value.transferId) ||
      !isIntegerInRange(value.totalChunks, 0, Math.ceil(MAX_FILE_BYTES / 1)) ||
      !isIntegerInRange(value.size, 0, MAX_FILE_BYTES)
    )
      return undefined;
    return value as TransferComplete;
  }
  if (
    value.type === 'file.cancel' &&
    hasOnlyKeys(value, ['type', 'transferId']) &&
    isTransferId(value.transferId)
  )
    return value as TransferCancel;
  return undefined;
}

export function encodeChunk(sequence: number, payload: ArrayBuffer): ArrayBuffer {
  if (!isIntegerInRange(sequence, 0, 0xffffffff)) throw new Error('Invalid chunk sequence.');
  const frame = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, CHUNK_MAGIC);
  view.setUint32(4, sequence);
  view.setUint32(8, payload.byteLength);
  new Uint8Array(frame, CHUNK_HEADER_BYTES).set(new Uint8Array(payload));
  return frame;
}

export function decodeChunk(frame: ArrayBuffer): {
  readonly sequence: number;
  readonly payload: ArrayBuffer;
} {
  if (frame.byteLength < CHUNK_HEADER_BYTES) throw new Error('Received an incomplete chunk frame.');
  const view = new DataView(frame);
  if (view.getUint32(0) !== CHUNK_MAGIC) throw new Error('Received an unexpected binary message.');
  const length = view.getUint32(8);
  if (length !== frame.byteLength - CHUNK_HEADER_BYTES)
    throw new Error('Received an invalid chunk length.');
  return { sequence: view.getUint32(4), payload: frame.slice(CHUNK_HEADER_BYTES) };
}
