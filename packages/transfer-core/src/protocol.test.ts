import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, decodeChunk, encodeChunk, parseTransferControlMessage } from './protocol.js';

const transferId = '123e4567-e89b-12d3-a456-426614174000';

describe('transfer protocol', () => {
  it('generates and decodes a sequenced binary chunk', () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    expect(decodeChunk(encodeChunk(7, payload))).toEqual({ sequence: 7, payload });
  });

  it('validates file metadata and its expected chunk count', () => {
    expect(
      parseTransferControlMessage({
        type: 'file.metadata',
        transferId,
        name: 'test.txt',
        mimeType: 'text/plain',
        size: CHUNK_SIZE + 1,
        chunkSize: CHUNK_SIZE,
        totalChunks: 2,
        sha256: 'a'.repeat(64),
      }),
    ).toMatchObject({ type: 'file.metadata' });
    expect(
      parseTransferControlMessage({
        type: 'file.metadata',
        transferId,
        name: 'test.txt',
        mimeType: '',
        size: 2,
        chunkSize: 2,
        totalChunks: 2,
        sha256: 'a'.repeat(64),
      }),
    ).toBeUndefined();
  });

  it('rejects malformed chunk frames', () => {
    expect(() => decodeChunk(new ArrayBuffer(2))).toThrow('incomplete');
  });
});
