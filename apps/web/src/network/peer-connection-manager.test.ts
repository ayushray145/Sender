import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@fastshare/protocol';
import { PeerConnectionManager } from './peer-connection-manager.js';
import type { SignalingClient } from './signaling-client.js';

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
  }
}

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  readonly channel = new FakeDataChannel();
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  createDataChannel(): RTCDataChannel {
    return this.channel as unknown as RTCDataChannel;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-sdp' };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }
  close(): void {
    this.connectionState = 'closed';
  }
}

describe('PeerConnectionManager', () => {
  it('creates an offer and control channel when a peer joins', async () => {
    const sent: unknown[] = [];
    let listener: ((message: ServerMessage) => void) | undefined;
    const signaling = {
      send: (message: unknown) => sent.push(message),
      onMessage: (next: (message: ServerMessage) => void) => {
        listener = next;
        return () => undefined;
      },
    } as unknown as SignalingClient;
    const connection = new FakePeerConnection();
    new PeerConnectionManager({
      signaling,
      createPeerConnection: () => connection as unknown as RTCPeerConnection,
    });
    listener?.({ type: 'peer.joined', peerId: 'receiver' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toContainEqual({
      type: 'signal.offer',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    expect(connection.channel.readyState).toBe('open');
  });

  it('queues ICE candidates until a remote offer has been set', async () => {
    const sent: unknown[] = [];
    let listener: ((message: ServerMessage) => void) | undefined;
    const signaling = {
      send: (message: unknown) => sent.push(message),
      onMessage: (next: (message: ServerMessage) => void) => {
        listener = next;
        return () => undefined;
      },
    } as unknown as SignalingClient;
    const connection = new FakePeerConnection();
    new PeerConnectionManager({
      signaling,
      createPeerConnection: () => connection as unknown as RTCPeerConnection,
    });
    listener?.({
      type: 'signal.ice-candidate',
      peerId: 'sender',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
    listener?.({
      type: 'signal.offer',
      peerId: 'sender',
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(connection.addedCandidates).toHaveLength(1);
    expect(sent).toContainEqual({
      type: 'signal.answer',
      description: { type: 'answer', sdp: 'answer-sdp' },
    });
  });
});
