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
  const downloadReceivedFile = () => {
    if (connection.receivedFile === undefined) return;
    const url = URL.createObjectURL(connection.receivedFile);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = connection.receivedFile.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main>
      <h1>FastShare connection test</h1>
      <p>
        Transfer one file directly between two browsers. This correctness-first phase supports up to
        100 MiB; it does not claim 5 GiB support yet.
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
      <section>
        <label>
          File to send (up to 100 MiB)
          <input
            type="file"
            disabled={!ready}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void connection.sendFile(file);
              event.target.value = '';
            }}
          />
        </label>
        {connection.sendProgress !== undefined && (
          <p>
            Sending {connection.sendProgress.name}: {connection.sendProgress.transferred} /{' '}
            {connection.sendProgress.total} bytes
          </p>
        )}
        {connection.receiveProgress !== undefined && (
          <p>
            Receiving {connection.receiveProgress.name}: {connection.receiveProgress.transferred} /{' '}
            {connection.receiveProgress.total} bytes
          </p>
        )}
        <button type="button" onClick={connection.cancelTransfer}>
          Cancel transfer
        </button>
        {connection.receivedFile !== undefined && (
          <button type="button" onClick={downloadReceivedFile}>
            Download {connection.receivedFile.name}
          </button>
        )}
      </section>
      {connection.error !== undefined && <p role="alert">{connection.error}</p>}
      <button type="button" onClick={connection.disconnect}>
        Disconnect
      </button>
    </main>
  );
}
