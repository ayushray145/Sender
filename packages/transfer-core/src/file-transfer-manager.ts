import {
  CHUNK_SIZE,
  decodeChunk,
  encodeChunk,
  parseTransferControlMessage,
  type FileMetadata,
} from './protocol.js';
import { sha256 } from './hash.js';

const MAX_BUFFERED_AMOUNT = 1024 * 1024;

export type TransferChannel = {
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};
export type TransferProgress = {
  readonly transferId: string;
  readonly name: string;
  readonly transferred: number;
  readonly total: number;
};
export type ReceivedFile = { readonly file: File; readonly transferId: string };
export type FileTransferManagerOptions = {
  readonly channel: TransferChannel;
  readonly onSendProgress?: (progress: TransferProgress) => void;
  readonly onReceiveProgress?: (progress: TransferProgress) => void;
  readonly onFileReceived?: (file: ReceivedFile) => void;
  readonly onError?: (error: Error) => void;
  readonly onCancelled?: (transferId: string) => void;
};

type Receiver = {
  readonly metadata: FileMetadata;
  readonly chunks: BlobPart[];
  nextSequence: number;
  received: number;
};

/** Streams one file at a time over an already-open, reliable ordered RTCDataChannel. */
export class FileTransferManager {
  private readonly channel: TransferChannel;
  private receiver: Receiver | undefined;
  private sending: { transferId: string; cancelled: boolean } | undefined;
  private destroyed = false;

  constructor(private readonly options: FileTransferManagerOptions) {
    this.channel = options.channel;
    this.channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
    this.channel.addEventListener('message', this.handleMessage as EventListener);
  }

  async sendFile(file: File): Promise<void> {
    if (this.sending !== undefined) throw new Error('A file transfer is already in progress.');
    if (file.size > 100 * 1024 * 1024) throw new Error('Phase 4 supports files up to 100 MiB.');
    if (this.channel.readyState !== 'open') throw new Error('The file data channel is not open.');
    const transferId = crypto.randomUUID();
    const sending = { transferId, cancelled: false };
    this.sending = sending;
    try {
      const digest = await sha256(file);
      this.throwIfCancelled(sending);
      const metadata: FileMetadata = {
        type: 'file.metadata',
        transferId,
        name: file.name || 'download',
        mimeType: file.type,
        size: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE),
        sha256: digest,
      };
      this.sendControl(metadata);
      let offset = 0;
      let sequence = 0;
      while (offset < file.size) {
        this.throwIfCancelled(sending);
        await this.waitForBackpressure();
        const chunk = await file
          .slice(offset, Math.min(offset + CHUNK_SIZE, file.size))
          .arrayBuffer();
        this.throwIfCancelled(sending);
        this.channel.send(encodeChunk(sequence, chunk));
        offset += chunk.byteLength;
        sequence += 1;
        this.options.onSendProgress?.({
          transferId,
          name: metadata.name,
          transferred: offset,
          total: file.size,
        });
      }
      this.throwIfCancelled(sending);
      this.sendControl({ type: 'file.complete', transferId, totalChunks: sequence, size: offset });
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Transfer cancelled.')) this.report(error);
      throw error;
    } finally {
      if (this.sending === sending) this.sending = undefined;
    }
  }

  cancel(): void {
    if (this.sending !== undefined) {
      this.sending.cancelled = true;
      this.sendControl({ type: 'file.cancel', transferId: this.sending.transferId });
    }
    if (this.receiver !== undefined) this.cancelReceiver(this.receiver.metadata.transferId);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.sending !== undefined) this.sending.cancelled = true;
    this.receiver = undefined;
    this.channel.removeEventListener('message', this.handleMessage as EventListener);
  }

  private readonly handleMessage = (event: Event): void => {
    void this.handleIncoming((event as MessageEvent<unknown>).data);
  };

  private async handleIncoming(data: unknown): Promise<void> {
    if (this.destroyed) return;
    try {
      if (typeof data === 'string') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const control = parseTransferControlMessage(parsed);
        if (control === undefined) return;
        if (control.type === 'file.metadata') this.startReceiver(control);
        else if (control.type === 'file.complete')
          await this.completeReceiver(control.transferId, control.totalChunks, control.size);
        else if (this.sending?.transferId === control.transferId) this.sending.cancelled = true;
        else if (this.receiver?.metadata.transferId === control.transferId)
          this.cancelReceiver(control.transferId);
        return;
      }
      if (data instanceof ArrayBuffer) this.receiveChunk(data);
      else this.report(new Error('Received an unsupported file transfer message.'));
    } catch (error) {
      this.report(error);
    }
  }

  private startReceiver(metadata: FileMetadata): void {
    if (this.receiver !== undefined) throw new Error('A file transfer is already being received.');
    this.receiver = { metadata, chunks: [], nextSequence: 0, received: 0 };
  }

  private receiveChunk(frame: ArrayBuffer): void {
    const receiver = this.receiver;
    if (receiver === undefined) throw new Error('Received a file chunk without metadata.');
    const { sequence, payload } = decodeChunk(frame);
    if (sequence !== receiver.nextSequence)
      throw new Error('Received a missing or out-of-order file chunk.');
    if (
      payload.byteLength === 0 ||
      payload.byteLength > receiver.metadata.chunkSize ||
      receiver.received + payload.byteLength > receiver.metadata.size
    )
      throw new Error('Received an invalid file chunk size.');
    receiver.chunks.push(payload);
    receiver.nextSequence += 1;
    receiver.received += payload.byteLength;
    this.options.onReceiveProgress?.({
      transferId: receiver.metadata.transferId,
      name: receiver.metadata.name,
      transferred: receiver.received,
      total: receiver.metadata.size,
    });
  }

  private async completeReceiver(
    transferId: string,
    totalChunks: number,
    size: number,
  ): Promise<void> {
    const receiver = this.receiver;
    if (receiver === undefined || receiver.metadata.transferId !== transferId)
      throw new Error('Received completion for an unknown transfer.');
    if (
      receiver.nextSequence !== receiver.metadata.totalChunks ||
      totalChunks !== receiver.metadata.totalChunks ||
      receiver.received !== receiver.metadata.size ||
      size !== receiver.metadata.size
    )
      throw new Error('File transfer completed with missing or unexpected chunks.');

    this.receiver = undefined;

    const file = new File(receiver.chunks, receiver.metadata.name, {
      type: receiver.metadata.mimeType,
    });
    const digest = await sha256(file);
    if (digest !== receiver.metadata.sha256) throw new Error('File integrity verification failed.');
    this.options.onFileReceived?.({ file, transferId });
  }

  private sendControl(message: object): void {
    this.channel.send(JSON.stringify(message));
  }
  private async waitForBackpressure(): Promise<void> {
    if (this.channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) return;
    await new Promise<void>((resolve) => {
      const onLow: EventListener = () => {
        this.channel.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      this.channel.addEventListener('bufferedamountlow', onLow);
    });
  }
  private throwIfCancelled(sending: { readonly cancelled: boolean }): void {
    if (sending.cancelled || this.destroyed) throw new Error('Transfer cancelled.');
  }
  private cancelReceiver(transferId: string): void {
    this.receiver = undefined;
    this.options.onCancelled?.(transferId);
  }
  private report(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error('File transfer failed.'));
  }
}
