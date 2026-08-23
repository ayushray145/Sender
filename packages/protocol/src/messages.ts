export const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;
export const MAX_SDP_LENGTH = 48 * 1024;
export const MAX_ICE_CANDIDATE_LENGTH = 16 * 1024;

export type OfferDescription = {
  readonly type: 'offer';
  readonly sdp: string;
};

export type AnswerDescription = {
  readonly type: 'answer';
  readonly sdp: string;
};

export type IceCandidate = {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
};

export type ClientMessage =
  | { readonly type: 'room.create' }
  | { readonly type: 'room.join'; readonly roomCode: string; readonly roomToken: string }
  | { readonly type: 'room.leave' }
  | { readonly type: 'signal.offer'; readonly description: OfferDescription }
  | { readonly type: 'signal.answer'; readonly description: AnswerDescription }
  | { readonly type: 'signal.ice-candidate'; readonly candidate: IceCandidate };

export type ServerMessage =
  | {
      readonly type: 'room.created';
      readonly roomId: string;
      readonly roomCode: string;
      readonly roomToken: string;
      readonly peerId: string;
    }
  | {
      readonly type: 'room.joined';
      readonly roomId: string;
      readonly roomCode: string;
      readonly peerId: string;
    }
  | { readonly type: 'peer.joined'; readonly peerId: string }
  | { readonly type: 'peer.left'; readonly peerId: string }
  | {
      readonly type: 'signal.offer';
      readonly peerId: string;
      readonly description: OfferDescription;
    }
  | {
      readonly type: 'signal.answer';
      readonly peerId: string;
      readonly description: AnswerDescription;
    }
  | {
      readonly type: 'signal.ice-candidate';
      readonly peerId: string;
      readonly candidate: IceCandidate;
    }
  | { readonly type: 'error'; readonly code: SignalingErrorCode; readonly message: string };

export type SignalingErrorCode =
  | 'invalid-message'
  | 'malformed-json'
  | 'message-too-large'
  | 'invalid-state'
  | 'room-not-found'
  | 'room-expired'
  | 'invalid-room-code'
  | 'room-access-denied'
  | 'room-full'
  | 'peer-unavailable';

export type ValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: string };

const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
const ROOM_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const valueKeys = Object.keys(value);
  return valueKeys.length === keys.length && valueKeys.every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function parseDescription(
  value: unknown,
  expectedType: OfferDescription['type'] | AnswerDescription['type'],
): ValidationResult<OfferDescription | AnswerDescription> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['type', 'sdp']) ||
    value.type !== expectedType ||
    !isBoundedString(value.sdp, MAX_SDP_LENGTH)
  ) {
    return { success: false, error: 'Invalid session description.' };
  }

  return {
    success: true,
    value:
      expectedType === 'offer'
        ? { type: 'offer', sdp: value.sdp }
        : { type: 'answer', sdp: value.sdp },
  };
}

function isNullableString(value: unknown, maximumLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maximumLength);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function parseIceCandidate(value: unknown): ValidationResult<IceCandidate> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']) ||
    !isBoundedString(value.candidate, MAX_ICE_CANDIDATE_LENGTH) ||
    !isNullableString(value.sdpMid, 256) ||
    !isNullableNonNegativeInteger(value.sdpMLineIndex) ||
    !isNullableString(value.usernameFragment, 256)
  ) {
    return { success: false, error: 'Invalid ICE candidate.' };
  }

  return {
    success: true,
    value: {
      candidate: value.candidate,
      sdpMid: value.sdpMid,
      sdpMLineIndex: value.sdpMLineIndex,
      usernameFragment: value.usernameFragment,
    },
  };
}

export function parseClientMessage(value: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { success: false, error: 'A signaling message must be an object with a type.' };
  }

  switch (value.type) {
    case 'room.create':
    case 'room.leave':
      return hasExactKeys(value, ['type'])
        ? { success: true, value: { type: value.type } }
        : { success: false, error: 'Unexpected message fields.' };
    case 'room.join':
      return hasExactKeys(value, ['type', 'roomCode', 'roomToken']) &&
        typeof value.roomCode === 'string' &&
        ROOM_CODE_PATTERN.test(value.roomCode) &&
        typeof value.roomToken === 'string' &&
        ROOM_TOKEN_PATTERN.test(value.roomToken)
        ? {
            success: true,
            value: { type: 'room.join', roomCode: value.roomCode, roomToken: value.roomToken },
          }
        : { success: false, error: 'Invalid room credentials.' };
    case 'signal.offer': {
      const description = parseDescription(value.description, 'offer');
      return hasExactKeys(value, ['type', 'description']) && description.success
        ? {
            success: true,
            value: { type: 'signal.offer', description: description.value as OfferDescription },
          }
        : { success: false, error: 'Invalid offer message.' };
    }
    case 'signal.answer': {
      const description = parseDescription(value.description, 'answer');
      return hasExactKeys(value, ['type', 'description']) && description.success
        ? {
            success: true,
            value: { type: 'signal.answer', description: description.value as AnswerDescription },
          }
        : { success: false, error: 'Invalid answer message.' };
    }
    case 'signal.ice-candidate': {
      const candidate = parseIceCandidate(value.candidate);
      return hasExactKeys(value, ['type', 'candidate']) && candidate.success
        ? { success: true, value: { type: 'signal.ice-candidate', candidate: candidate.value } }
        : { success: false, error: 'Invalid ICE candidate message.' };
    }
    default:
      return { success: false, error: 'Unsupported signaling message type.' };
  }
}
