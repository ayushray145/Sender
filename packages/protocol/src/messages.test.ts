import { describe, expect, it } from 'vitest';

import { parseClientMessage } from './messages.js';

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

  it('rejects malformed signaling payloads and unexpected fields', () => {
    expect(parseClientMessage({ type: 'signal.ice-candidate', candidate: {} })).toMatchObject({
      success: false,
    });
    expect(parseClientMessage({ type: 'room.create', extra: true })).toMatchObject({
      success: false,
    });
  });
});
