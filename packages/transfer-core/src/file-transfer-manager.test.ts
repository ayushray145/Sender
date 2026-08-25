import { describe, expect, it } from 'vitest';
import { FileTransferManager } from './file-transfer-manager.js';
import { encodeChunk } from './protocol.js';

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: FakeChannel | undefined;
  send(data: string | ArrayBuffer): void {
    const copy = data instanceof ArrayBuffer ? data.slice(0) : data;
    queueMicrotask(() => this.peer?.dispatchEvent(new MessageEvent('message', { data: copy })));
  }
}

function channels(): [FakeChannel, FakeChannel] {
  const left = new FakeChannel();
  const right = new FakeChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
}
const transferId = '123e4567-e89b-12d3-a456-426614174000';

describe('FileTransferManager', () => {
  it('ignores unrelated text messages on the shared data channel', async () => {
    const [, receiverChannel] = channels();
    const errors: Error[] = [];
    const receiver = new FileTransferManager({
      channel: receiverChannel,
      onError: (error) => errors.push(error),
    });
    receiverChannel.dispatchEvent(
      new MessageEvent('message', { data: 'FastShare connection test' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
    receiver.destroy();
  });

  it('transfers a small file in order and verifies its SHA-256 digest', async () => {
    const [senderChannel, receiverChannel] = channels();
    let received: File | undefined;
    const receiver = new FileTransferManager({
      channel: receiverChannel,
      onFileReceived: ({ file }) => {
        received = file;
      },
    });
    const sender = new FileTransferManager({ channel: senderChannel });
    await sender.sendFile(new File(['FastShare'], 'hello.txt', { type: 'text/plain' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received?.name).toBe('hello.txt');
    expect(received?.type).toBe('text/plain');
    expect(await received?.text()).toBe('FastShare');
    sender.destroy();
    receiver.destroy();
  });

  it('transfers multiple files sequentially without race conditions', async () => {
    const [senderChannel, receiverChannel] = channels();
    const receivedFiles: File[] = [];
    const receiver = new FileTransferManager({
      channel: receiverChannel,
      onFileReceived: ({ file }) => {
        receivedFiles.push(file);
      },
    });
    const sender = new FileTransferManager({ channel: senderChannel });

    const file1 = new File(['Content One'], 'file1.txt', { type: 'text/plain' });
    const file2 = new File(['Content Two'], 'file2.txt', { type: 'text/plain' });

    await sender.sendFile(file1);
    await sender.sendFile(file2);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(receivedFiles.length).toBe(2);
    expect(receivedFiles[0]?.name).toBe('file1.txt');
    expect(await receivedFiles[0]?.text()).toBe('Content One');
    expect(receivedFiles[1]?.name).toBe('file2.txt');
    expect(await receivedFiles[1]?.text()).toBe('Content Two');

    sender.destroy();
    receiver.destroy();
  });

  it('detects an invalid chunk sequence', async () => {
    const [, receiverChannel] = channels();
    const errors: Error[] = [];
    const receiver = new FileTransferManager({
      channel: receiverChannel,
      onError: (error) => errors.push(error),
    });
    receiverChannel.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'file.metadata',
          transferId,
          name: 'a.txt',
          mimeType: 'text/plain',
          size: 1,
          chunkSize: 1,
          totalChunks: 1,
          sha256: 'a'.repeat(64),
        }),
      }),
    );
    receiverChannel.dispatchEvent(
      new MessageEvent('message', { data: encodeChunk(1, new Uint8Array([1]).buffer) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors[0]?.message).toContain('out-of-order');
    receiver.destroy();
  });

  it('detects incorrect completion size and cancellation', async () => {
    const [senderChannel, receiverChannel] = channels();
    const cancelled: string[] = [];
    const errors: Error[] = [];
    const receiver = new FileTransferManager({
      channel: receiverChannel,
      onCancelled: (id) => cancelled.push(id),
      onError: (error) => errors.push(error),
    });
    const sender = new FileTransferManager({ channel: senderChannel });
    senderChannel.send(
      JSON.stringify({
        type: 'file.metadata',
        transferId,
        name: 'a.txt',
        mimeType: '',
        size: 2,
        chunkSize: 2,
        totalChunks: 1,
        sha256: 'a'.repeat(64),
      }),
    );
    senderChannel.send(
      JSON.stringify({ type: 'file.complete', transferId, totalChunks: 1, size: 2 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors[0]?.message).toContain('missing');
    senderChannel.send(JSON.stringify({ type: 'file.cancel', transferId }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toEqual([transferId]);
    sender.destroy();
    receiver.destroy();
  });
});
