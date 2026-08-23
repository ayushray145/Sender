import { describe, expect, it } from 'vitest';
import { SignalingClient, type WebSocketLike } from './signaling-client.js';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly sent: string[] = [];
  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  emit(type: string, event: Event = new Event(type)): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener(event);
  }
}

describe('SignalingClient', () => {
  it('sends only JSON client protocol messages after the socket opens', async () => {
    const socket = new FakeSocket();
    const client = new SignalingClient('ws://test', () => socket);
    const connected = client.connect();
    socket.readyState = 1;
    socket.emit('open');
    await connected;
    client.send({ type: 'room.create' });
    expect(socket.sent).toEqual(['{"type":"room.create"}']);
  });

  it('rejects malformed server messages before notifying consumers', async () => {
    const socket = new FakeSocket();
    const client = new SignalingClient('ws://test', () => socket);
    const errors: Error[] = [];
    client.onError((error) => errors.push(error));
    const connected = client.connect();
    socket.readyState = 1;
    socket.emit('open');
    await connected;
    socket.emit('message', new MessageEvent('message', { data: '{bad json' }));
    expect(errors[0]?.message).toContain('invalid JSON');
  });
});
