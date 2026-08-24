import { describe, expect, it } from 'vitest';

import { parseClientMessage, parseServerMessage } from './messages.js';

describe('parseClientMessage', () => {
  it('accepts a structurally valid offer', () => {
    const result = parseClientMessage({
      type: 'signal.offer',
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });

    expect(result).toEqual({
      success: true,
      value: { type: 'signal.offer', description: { type: 'offer', sdp: 'v=0\r\n' } },
    });
  });

  it('rejects unsupported message types', () => {
    expect(parseClientMessage({ type: 'file.chunk', payload: 'not allowed' })).toMatchObject({
      success: false,
    });
  });

  it('accepts valid room.join with code only or code and token', () => {
    expect(
      parseClientMessage({
        type: 'room.join',
        roomCode: 'ABCDEFGH23',
      }),
    ).toEqual({
      success: true,
      value: { type: 'room.join', roomCode: 'ABCDEFGH23' },
    });

    const token = 'a'.repeat(64);
    expect(
      parseClientMessage({
        type: 'room.join',
        roomCode: 'ABCDEFGH23',
        roomToken: token,
      }),
    ).toEqual({
      success: true,
      value: { type: 'room.join', roomCode: 'ABCDEFGH23', roomToken: token },
    });
  });

  it('rejects malformed signaling payloads and unexpected fields', () => {
    expect(parseClientMessage({ type: 'signal.ice-candidate', candidate: {} })).toMatchObject({
      success: false,
    });
    expect(parseClientMessage({ type: 'room.create', extra: true })).toMatchObject({
      success: false,
    });
  });
});

describe('parseServerMessage', () => {
  it('accepts a routed ICE candidate', () => {
    expect(
      parseServerMessage({
        type: 'signal.ice-candidate',
        peerId: 'peer-1',
        candidate: {
          candidate: 'candidate:1',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
      }),
    ).toMatchObject({ success: true });
  });

  it('rejects malformed server messages', () => {
    expect(parseServerMessage({ type: 'peer.joined', peerId: '' })).toMatchObject({
      success: false,
    });
  });
});
