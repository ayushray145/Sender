import { useState } from 'react';
import { useFastShareConnection } from './hooks/use-fastshare-connection.js';

const defaultSignalingUrl = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080';
const defaultStunUrl = import.meta.env.VITE_STUN_URL ?? '';

export function App() {
  const [signalingUrl, setSignalingUrl] = useState(defaultSignalingUrl);
  const [stunUrl, setStunUrl] = useState(defaultStunUrl);
  const [roomCode, setRoomCode] = useState('');
  const [roomToken, setRoomToken] = useState('');
  const connection = useFastShareConnection(signalingUrl, stunUrl);
  const ready = connection.status.dataChannelState === 'open';

  return (
    <main>
      <h1>FastShare connection test</h1>
      <p>
        Use two browsers to establish an encrypted browser-to-browser data channel. No files are
        transferred in this phase.
      </p>
      <label>
        Signaling WebSocket URL
        <input value={signalingUrl} onChange={(event) => setSignalingUrl(event.target.value)} />
      </label>
      <label>
        STUN URL (optional)
        <input
          value={stunUrl}
          onChange={(event) => setStunUrl(event.target.value)}
          placeholder="stun:stun.example.org:3478"
        />
      </label>
      <section>
        <button type="button" onClick={connection.createRoom}>
          Create room
        </button>
        {connection.credentials !== undefined && (
          <p>
            Share these credentials securely:
            <br />
            Code: <code>{connection.credentials.roomCode}</code>
            <br />
            Token: <code>{connection.credentials.roomToken}</code>
          </p>
        )}
      </section>
      <section>
        <label>
          Room code
          <input
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Room token
          <input value={roomToken} onChange={(event) => setRoomToken(event.target.value)} />
        </label>
        <button type="button" onClick={() => connection.joinRoom(roomCode, roomToken)}>
          Join room
        </button>
      </section>
      <p>
        Connection: {connection.status.connectionState}; ICE: {connection.status.iceConnectionState}
        ; channel: {connection.status.dataChannelState}
      </p>
      <button type="button" disabled={!ready} onClick={connection.sendConnectionTest}>
        Send “FastShare connection test”
      </button>
      {connection.receivedTest && (
        <p role="status">Received “FastShare connection test” over WebRTC.</p>
      )}
      {connection.error !== undefined && <p role="alert">{connection.error}</p>}
      <button type="button" onClick={connection.disconnect}>
        Disconnect
      </button>
    </main>
  );
}
