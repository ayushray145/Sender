import type { IceCandidate, ServerMessage } from '@fastshare/protocol';
import type { SignalingClient } from './signaling-client.js';

const CONNECTION_TEST_MESSAGE = 'FastShare connection test';

export type PeerConnectionStatus = {
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly dataChannelState: RTCDataChannelState | 'none';
};

export type PeerConnectionManagerOptions = {
  readonly signaling: SignalingClient;
  readonly configuration?: RTCConfiguration;
  readonly createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  readonly onStatusChange?: (status: PeerConnectionStatus) => void;
  readonly onConnectionTestMessage?: (message: string) => void;
  readonly onError?: (error: Error) => void;
};

/** Owns exactly one temporary WebRTC connection and never handles file payloads. */
export class PeerConnectionManager {
  private readonly configuration: RTCConfiguration;
  private readonly createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  private connection: RTCPeerConnection | undefined;
  private channel: RTCDataChannel | undefined;
  private pendingCandidates: IceCandidate[] = [];
  private unsubscribe: (() => void) | undefined;
  private destroyed = false;

  constructor(private readonly options: PeerConnectionManagerOptions) {
    this.configuration = options.configuration ?? {};
    this.createPeerConnection =
      options.createPeerConnection ?? ((configuration) => new RTCPeerConnection(configuration));
    this.unsubscribe = options.signaling.onMessage((message) => {
      void this.handleSignal(message);
    });
  }

  async beginOffer(): Promise<void> {
    const connection = this.getOrCreateConnection();
    if (this.channel === undefined)
      this.attachDataChannel(connection.createDataChannel('fastshare-control'));
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      if (connection.localDescription?.sdp === undefined)
        throw new Error('WebRTC did not create an SDP offer.');
      this.options.signaling.send({
        type: 'signal.offer',
        description: { type: 'offer', sdp: connection.localDescription.sdp },
      });
    } catch (error) {
      this.reportError(error, 'Unable to create the WebRTC offer.');
    }
  }

  sendConnectionTest(): void {
    if (this.channel?.readyState !== 'open') throw new Error('The data channel is not open.');
    this.channel.send(CONNECTION_TEST_MESSAGE);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.resetConnection();
  }

  private async handleSignal(message: ServerMessage): Promise<void> {
    if (this.destroyed) return;
    try {
      switch (message.type) {
        case 'peer.joined':
          await this.beginOffer();
          return;
        case 'peer.left':
          this.resetConnection();
          return;
        case 'signal.offer':
          await this.handleOffer(message.description);
          return;
        case 'signal.answer':
          if (this.connection === undefined)
            throw new Error('Received an SDP answer before creating an offer.');
          await this.connection.setRemoteDescription(message.description);
          await this.flushPendingCandidates();
          return;
        case 'signal.ice-candidate':
          await this.handleCandidate(message.candidate);
          return;
        case 'error':
          this.options.onError?.(new Error(message.message));
          return;
        default:
          return;
      }
    } catch (error) {
      this.reportError(error, 'WebRTC negotiation failed.');
    }
  }

  private async handleOffer(description: RTCSessionDescriptionInit): Promise<void> {
    const connection = this.getOrCreateConnection();
    await connection.setRemoteDescription(description);
    await this.flushPendingCandidates();
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    if (connection.localDescription?.sdp === undefined)
      throw new Error('WebRTC did not create an SDP answer.');
    this.options.signaling.send({
      type: 'signal.answer',
      description: { type: 'answer', sdp: connection.localDescription.sdp },
    });
  }

  private async handleCandidate(candidate: IceCandidate): Promise<void> {
    const connection = this.connection;
    if (connection === undefined || connection.remoteDescription === null) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await connection.addIceCandidate(candidate);
  }

  private async flushPendingCandidates(): Promise<void> {
    const connection = this.connection;
    if (connection === undefined || connection.remoteDescription === null) return;
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) await connection.addIceCandidate(candidate);
  }

  private getOrCreateConnection(): RTCPeerConnection {
    if (this.connection !== undefined) return this.connection;
    const connection = this.createPeerConnection(this.configuration);
    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate === null) return;
      this.options.signaling.send({
        type: 'signal.ice-candidate',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        },
      });
    });
    connection.addEventListener('datachannel', (event) => this.attachDataChannel(event.channel));
    connection.addEventListener('connectionstatechange', () => {
      this.emitStatus();
      if (connection.connectionState === 'failed')
        this.handleConnectionFailure('The WebRTC connection failed.');
    });
    connection.addEventListener('iceconnectionstatechange', () => {
      this.emitStatus();
      if (connection.iceConnectionState === 'failed')
        this.handleConnectionFailure('ICE connectivity failed.');
    });
    this.connection = connection;
    this.emitStatus();
    return connection;
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.channel?.close();
    this.channel = channel;
    channel.addEventListener('open', () => this.emitStatus());
    channel.addEventListener('close', () => this.emitStatus());
    channel.addEventListener('error', () =>
      this.options.onError?.(new Error('The data channel failed.')),
    );
    channel.addEventListener('message', (event) => {
      if (typeof event.data === 'string' && event.data === CONNECTION_TEST_MESSAGE) {
        this.options.onConnectionTestMessage?.(event.data);
      }
    });
    this.emitStatus();
  }

  private resetConnection(): void {
    this.pendingCandidates = [];
    this.channel?.close();
    this.channel = undefined;
    this.connection?.close();
    this.connection = undefined;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.options.onStatusChange?.({
      connectionState: this.connection?.connectionState ?? 'closed',
      iceConnectionState: this.connection?.iceConnectionState ?? 'closed',
      dataChannelState: this.channel?.readyState ?? 'none',
    });
  }

  private reportError(error: unknown, fallback: string): void {
    this.options.onError?.(error instanceof Error ? error : new Error(fallback));
  }

  private handleConnectionFailure(message: string): void {
    this.options.onError?.(new Error(message));
    this.resetConnection();
  }
}
