import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { useFastShareConnection } from './hooks/use-fastshare-connection.js';
import { formatBytes, createShareableLink, parseShareableLink } from './utils.js';

const signalingUrl = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080';
const stunUrl = import.meta.env.VITE_STUN_URL ?? '';

export function App() {
  const [activeTab, setActiveTab] = useState<'send' | 'receive'>('send');
  const [roomCode, setRoomCode] = useState('');
  const [roomToken, setRoomToken] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [copiedField, setCopiedField] = useState<'code' | 'link' | null>(null);
  const [showQR, setShowQR] = useState(false);

  const connection = useFastShareConnection(signalingUrl, stunUrl);
  const isDataChannelOpen = connection.status.dataChannelState === 'open';
  const isPeerConnecting = connection.status.connectionState === 'connecting' || connection.status.iceConnectionState === 'checking';
  const progress = connection.sendProgress ?? connection.receiveProgress;

  // Automatically switch to receive tab and prefill inputs if URL has parameters
  useEffect(() => {
    const params = parseShareableLink();
    if (params) {
      setRoomCode(params.roomCode);
      setRoomToken(params.roomToken ?? '');
      setActiveTab('receive');
    }
  }, []);

  const copyToClipboard = useCallback(async (text: string, field: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
    }
  }, []);

  const handleDownload = useCallback(() => {
    const file = connection.receivedFile;
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }, [connection.receivedFile]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isDataChannelOpen) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void connection.sendFile(file);
    }
  };

  const shareableUrl = connection.credentials
    ? createShareableLink(connection.credentials.roomCode, connection.credentials.roomToken)
    : '';

  // Minimalist monochrome QR generator
  const qrImageUrl = shareableUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareableUrl)}&bgcolor=121212&color=ffffff&margin=2`
    : '';

  return (
    <div className="site-wrapper">
      {/* Floating Minimal Navigation Bar */}
      <nav className="nav-container">
        <div className="nav-inner">
          <div className="nav-brand">
            <div className="brand-logo-mark">S</div>
            <span className="brand-title">
              Senderrr
            </span>
            <span className="pill-badge">P2P v0.1</span>
          </div>

          <div className="nav-status">
            <span
              className={`status-pill ${
                isDataChannelOpen
                  ? 'connected'
                  : isPeerConnecting || connection.credentials
                  ? 'waiting'
                  : 'idle'
              }`}
            >
              <span className="dot" />
              <span className="status-label">
                {progress
                  ? 'Transferring'
                  : isDataChannelOpen
                  ? 'Connected'
                  : isPeerConnecting
                  ? 'Connecting'
                  : connection.credentials
                  ? 'Waiting for Peer'
                  : 'Ready'}
              </span>
            </span>
          </div>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="content-container">
        {/* Header / Hero */}
        <section className="hero-block">
          <div className="eyebrow-tag">
            <span>Direct WebRTC Protocol</span>
          </div>
          <h1 className="main-heading">
            Direct browser-to-browser file transfer.
          </h1>
          <p className="main-desc">
            No cloud relay. No permanent storage. Stream up to 5 GiB directly to a peer via encrypted WebRTC DataChannels.
          </p>
        </section>

        {/* Transfer Workspace Panel */}
        <div className="workspace-card">
          {/* Tab Selection */}
          {!connection.credentials && (
            <div className="tab-bar">
              <button
                type="button"
                className={`tab-item ${activeTab === 'send' ? 'active' : ''}`}
                onClick={() => setActiveTab('send')}
              >
                Send
              </button>
              <button
                type="button"
                className={`tab-item ${activeTab === 'receive' ? 'active' : ''}`}
                onClick={() => setActiveTab('receive')}
              >
                Receive
              </button>
            </div>
          )}

          {/* Connected Room Top Bar */}
          {connection.credentials && (
            <div className="room-top-bar">
              <div className={`room-top-title ${isDataChannelOpen ? 'connected' : 'waiting'}`}>
                <span className={`live-indicator ${isDataChannelOpen ? 'connected' : 'waiting'}`} />
                <span>{progress ? 'Transfer in Progress' : isDataChannelOpen ? 'Session Active' : 'Waiting for Peer'}</span>
              </div>
              <button
                type="button"
                className="btn-disconnect"
                onClick={connection.disconnect}
              >
                Disconnect
              </button>
            </div>
          )}

          {/* SEND TAB: Initialize Room */}
          {!connection.credentials && activeTab === 'send' && (
            <div className="panel-content">
              <p className="panel-helper">
                Initialize an ephemeral room session.
              </p>
              <button
                type="button"
                className="btn-solid"
                onClick={connection.createRoom}
              >
                Create Room
              </button>
            </div>
          )}

          {/* RECEIVE TAB: Join Room Form */}
          {!connection.credentials && activeTab === 'receive' && (
            <form
              className="panel-content"
              onSubmit={(e) => {
                e.preventDefault();
                connection.joinRoom(roomCode, roomToken || undefined);
              }}
            >
              <div className="input-group">
                <label htmlFor="input-room-code">Room Code</label>
                <input
                  id="input-room-code"
                  type="text"
                  placeholder="e.g. A1B2C3D4E5"
                  value={roomCode}
                  maxLength={10}
                  className="input-field font-mono"
                  onChange={(e) => setRoomCode(e.target.value.trim().toUpperCase())}
                />
                <span className="text-muted text-xs">Enter the 10-character code provided by the sender</span>
              </div>

              <button
                type="submit"
                className="btn-solid"
                disabled={roomCode.trim().length !== 10}
              >
                Join Room
              </button>
            </form>
          )}

          {/* ACTIVE ROOM DETAILS */}
          {connection.credentials && (
            <div className="session-details">
              <div className="credentials-row">
                <div className="cred-box">
                  <span className="meta-label">Room Code</span>
                  <div className="cred-action-row">
                    <span className="code-value">{connection.credentials.roomCode}</span>
                    <button
                      type="button"
                      className="btn-subtle-pill"
                      onClick={() => copyToClipboard(connection.credentials!.roomCode, 'code')}
                    >
                      {copiedField === 'code' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="cred-box">
                  <span className="meta-label">Share Link</span>
                  <div className="cred-action-row">
                    <button
                      type="button"
                      className="btn-outline-pill"
                      onClick={() => copyToClipboard(shareableUrl, 'link')}
                    >
                      {copiedField === 'link' ? 'Link Copied' : 'Copy Link'}
                    </button>
                    <button
                      type="button"
                      className="btn-outline-pill"
                      onClick={() => setShowQR(!showQR)}
                    >
                      {showQR ? 'Hide QR' : 'QR Code'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible QR Code */}
              {showQR && (
                <div className="qr-box">
                  <img src={qrImageUrl} alt="FastShare QR Code" className="qr-render" />
                  <span className="qr-hint">Scan with mobile camera to join</span>
                </div>
              )}

              {/* Status Alert Bar */}
              <div className={`connection-callout ${isDataChannelOpen ? 'callout-success' : 'callout-waiting'}`}>
                {isDataChannelOpen ? (
                  <span>Peer connected. You may now transfer files.</span>
                ) : (
                  <span>Waiting for peer to connect. Share the room code or link above.</span>
                )}
              </div>
            </div>
          )}

          {/* DRAG & DROP TRANSFER ZONE (When peer is connected) */}
          {connection.credentials && isDataChannelOpen && (
            <div
              className={`transfer-dropzone ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="dropzone-body">
                <div className="dropzone-text">
                  <p className="dropzone-main-text">Drag and drop file here</p>
                  <p className="dropzone-sub-text">Up to 5 GiB per room session</p>
                </div>
                <label className="btn-outline">
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void connection.sendFile(file);
                      event.target.value = '';
                    }}
                  />
                  Select File
                </label>
              </div>
            </div>
          )}

          {/* ACTIVE TRANSFER PROGRESS */}
          {progress && (() => {
            const percent = Math.min(100, Math.round((progress.transferred / progress.total) * 100));
            const isComplete = percent >= 100;
            return (
              <div className="progress-section">
                <div className="progress-meta">
                  <span className="progress-name">{progress.name}</span>
                  <span className={`progress-pct font-mono ${isComplete ? 'is-complete' : ''}`}>
                    {percent}%
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className={`progress-fill ${isComplete ? 'is-complete' : ''}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="progress-sub-row">
                  <span className="font-mono text-xs">
                    {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
                  </span>
                  <button
                    type="button"
                    className="btn-text-danger"
                    onClick={connection.cancelTransfer}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })()}

          {/* RECEIVED FILE CARD */}
          {connection.receivedFile && (
            <div className="received-card">
              <div className="received-meta">
                <span className="received-title">{connection.receivedFile.name}</span>
                <span className="font-mono text-xs text-muted">
                  {formatBytes(connection.receivedFile.size)}
                </span>
              </div>
              <button
                type="button"
                className="btn-solid"
                onClick={handleDownload}
              >
                Download
              </button>
            </div>
          )}

          {/* ERROR DISPLAY */}
          {connection.error && (
            <div className="error-callout" role="alert">
              <span>{connection.error}</span>
            </div>
          )}
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="footer-bar">
        <div className="footer-inner">
          <span>Senderrr</span>
          <span className="text-muted">Direct Browser P2P Protocol</span>
        </div>
      </footer>
    </div>
  );
}
