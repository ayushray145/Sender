import { parseServerMessage, type ClientMessage, type ServerMessage } from '@fastshare/protocol';

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

/** A small, validated boundary between browser WebSockets and the WebRTC layer. */
export class SignalingClient {
  private socket: WebSocketLike | undefined;
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly url: string,
    private readonly createWebSocket: WebSocketFactory = (endpoint) => new WebSocket(endpoint),
  ) {}

  connect(): Promise<void> {
    if (this.socket !== undefined) throw new Error('The signaling client is already connected.');
    const socket = this.createWebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('message', this.handleMessage as EventListener);
    socket.addEventListener('error', this.handleSocketError as EventListener);
    socket.addEventListener('close', this.handleClose as EventListener);

    return new Promise<void>((resolve, reject) => {
      const onOpen: EventListener = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onOpenError);
        resolve();
      };
      const onOpenError: EventListener = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onOpenError);
        reject(new Error('Unable to connect to the signaling server.'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onOpenError);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== 1) {
      throw new Error('The signaling connection is not open.');
    }
    this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket === undefined) return;
    socket.removeEventListener('message', this.handleMessage as EventListener);
    socket.removeEventListener('error', this.handleSocketError as EventListener);
    socket.removeEventListener('close', this.handleClose as EventListener);
    socket.close();
  }

  private readonly handleMessage = (event: Event): void => {
    const data = (event as MessageEvent<unknown>).data;
    if (typeof data !== 'string') {
      this.emitError(new Error('The signaling server sent a non-text message.'));
      return;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      const result = parseServerMessage(parsed);
      if (!result.success) {
        this.emitError(new Error('The signaling server sent an invalid message.'));
        return;
      }
      for (const listener of Array.from(this.messageListeners)) listener(result.value);
    } catch {
      this.emitError(new Error('The signaling server sent invalid JSON.'));
    }
  };

  private readonly handleSocketError = (): void =>
    this.emitError(new Error('The signaling connection failed.'));
  private readonly handleClose = (): void => {
    this.socket = undefined;
  };
  private emitError(error: Error): void {
    for (const listener of Array.from(this.errorListeners)) listener(error);
  }
}
