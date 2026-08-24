// Minimalist zero-dependency in-browser ZIP archive builder (RFC 1950 / ZIP format)

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createZipBlob(files: readonly File[]): Promise<Blob> {
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    offset: number;
    modTime: number;
    modDate: number;
  }> = [];

  const now = new Date();
  const modTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() / 2) & 0x1f);
  const modDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localChunks: Uint8Array[] = [];
  let currentOffset = 0;

  const encoder = new TextEncoder();

  for (const file of files) {
    const dataBuffer = await file.arrayBuffer();
    const dataBytes = new Uint8Array(dataBuffer);
    const nameBytes = encoder.encode(file.name);
    const fileCrc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(8, 0, true); // Compression method (0 = store)
    view.setUint16(10, modTime, true); // Last mod file time
    view.setUint16(12, modDate, true); // Last mod file date
    view.setUint32(14, fileCrc, true); // CRC-32
    view.setUint32(18, dataBytes.length, true); // Compressed size
    view.setUint32(22, dataBytes.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length

    localHeader.set(nameBytes, 30);

    fileRecords.push({
      nameBytes,
      dataBytes,
      crc: fileCrc,
      offset: currentOffset,
      modTime,
      modDate,
    });

    localChunks.push(localHeader);
    localChunks.push(dataBytes);
    currentOffset += localHeader.length + dataBytes.length;
  }

  const centralDirectoryOffset = currentOffset;
  const centralChunks: Uint8Array[] = [];

  for (const record of fileRecords) {
    const centralHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(centralHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central file header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(10, 0, true); // Compression method (0 = store)
    view.setUint16(12, record.modTime, true); // Last mod file time
    view.setUint16(14, record.modDate, true); // Last mod file date
    view.setUint32(16, record.crc, true); // CRC-32
    view.setUint32(20, record.dataBytes.length, true); // Compressed size
    view.setUint32(24, record.dataBytes.length, true); // Uncompressed size
    view.setUint16(28, record.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, record.offset, true); // Relative offset of local header

    centralHeader.set(record.nameBytes, 46);
    centralChunks.push(centralHeader);
    currentOffset += centralHeader.length;
  }

  const centralDirectorySize = currentOffset - centralDirectoryOffset;

  // End of Central Directory Record (EOCD)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true); // Disk number
  eocdView.setUint16(6, 0, true); // Disk where CD starts
  eocdView.setUint16(8, fileRecords.length, true); // Total entries on this disk
  eocdView.setUint16(10, fileRecords.length, true); // Total entries
  eocdView.setUint32(12, centralDirectorySize, true); // Size of central directory
  eocdView.setUint32(16, centralDirectoryOffset, true); // Offset of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  const allParts = [...localChunks, ...centralChunks, eocd];
  return new Blob(allParts as BlobPart[], { type: 'application/zip' });
}
