import { useState } from 'react';
import { useFastShareConnection } from './hooks/use-fastshare-connection.js';

const signalingUrl = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080';
const stunUrl = import.meta.env.VITE_STUN_URL ?? '';

export function App() {
  const [open, setOpen] = useState(true);
  const [joining, setJoining] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [roomToken, setRoomToken] = useState('');
  const connection = useFastShareConnection(signalingUrl, stunUrl);
  const ready = connection.status.dataChannelState === 'open';
  const progress = connection.sendProgress ?? connection.receiveProgress;
  const download = () => {
    const file = connection.receivedFile;
    if (file === undefined) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="artwork" aria-label="Village road illustration">
      {!open && (
        <button
          className="launcher"
          aria-label="Open FastShare controls"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true" />
          <b>Send</b>
        </button>
      )}
      {open && (
        <section className="dialog" aria-label="FastShare controls">
          <div className="dialog-header">
            <b>Send files seamlessly</b>
            <button className="icon" aria-label="Close controls" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          {connection.credentials === undefined && !joining && (
            <div className="dialog-actions">
              <button className="primary" onClick={connection.createRoom}>
                Create room
              </button>
              <button className="secondary" onClick={() => setJoining(true)}>
                Join room
              </button>
            </div>
          )}
          {joining && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                connection.joinRoom(roomCode, roomToken);
                setJoining(false);
              }}
            >
              <label>
                Room code
                <input
                  value={roomCode}
                  maxLength={10}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                />
              </label>
              <label>
                Room token
                <input value={roomToken} onChange={(event) => setRoomToken(event.target.value)} />
              </label>
              <div className="dialog-actions">
                <button
                  className="primary"
                  disabled={roomCode.length !== 10 || roomToken.length !== 64}
                >
                  Join
                </button>
                <button className="secondary" type="button" onClick={() => setJoining(false)}>
                  Back
                </button>
              </div>
            </form>
          )}
          {connection.credentials && (
            <div className="room-info">
              <small>Share these room details</small>
              <strong>{connection.credentials.roomCode}</strong>
              <code>{connection.credentials.roomToken}</code>
              <span className={ready ? 'connected' : ''}>
                {ready ? '● Peer connected' : '● Waiting for peer'}
              </span>
            </div>
          )}
          {ready && (
            <label className="file">
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void connection.sendFile(file);
                  event.target.value = '';
                }}
              />
              Choose file
            </label>
          )}
          {progress && (
            <div className="progress">
              <b>{progress.name}</b>
              <progress value={progress.transferred} max={progress.total} />
              <small>{Math.round((progress.transferred / progress.total) * 100)}% complete</small>
              <button className="text" onClick={connection.cancelTransfer}>
                Cancel
              </button>
            </div>
          )}
          {connection.receivedFile && (
            <button className="primary" onClick={download}>
              Download {connection.receivedFile.name}
            </button>
          )}
          {connection.error && (
            <p className="error" role="alert">
              {connection.error}
            </p>
          )}
          {connection.credentials && (
            <button className="text" onClick={connection.disconnect}>
              Leave room
            </button>
          )}
        </section>
      )}
    </main>
  );
}
