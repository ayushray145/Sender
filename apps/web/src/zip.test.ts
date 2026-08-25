import { describe, expect, it } from 'vitest';
import { crc32, createZipBlob } from './zip.js';

describe('ZIP utility', () => {
  it('calculates CRC-32 correctly for a known string', () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('123456789');
    // Standard test check: CRC-32 of "123456789" is 0xCBF43926 (3421780262)
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('creates a valid ZIP blob with multiple files', async () => {
    const file1 = new File(['Hello World!'], 'hello.txt', { type: 'text/plain' });
    const file2 = new File(['Senderrr P2P Transfer'], 'readme.md', { type: 'text/markdown' });

    const zipBlob = await createZipBlob([file1, file2]);
    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.type).toBe('application/zip');
    expect(zipBlob.size).toBeGreaterThan(file1.size + file2.size);

    const buffer = await zipBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Verify PK\x03\x04 signature at the start
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});

