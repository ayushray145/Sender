import { useState, useEffect, useCallback, type DragEvent } from 'react';
import { useFastShareConnection } from './hooks/use-fastshare-connection.js';
import { formatBytes, createShareableLink, parseShareableLink } from './utils.js';
import { createZipBlob } from './zip.js';

function getDefaultSignalingUrl(): string {
  const envUrl = import.meta.env.VITE_SIGNALING_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    return envUrl.trim();
  }
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${window.location.host}`;
  }
  return 'ws://localhost:8080';
}

const signalingUrl = getDefaultSignalingUrl();
const stunUrl =
  (import.meta.env.VITE_STUN_URL && import.meta.env.VITE_STUN_URL.trim() !== '')
    ? import.meta.env.VITE_STUN_URL.trim()
    : 'stun:stun.l.google.com:19302';

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

  const handleDownloadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadZip = useCallback(async () => {
    if (connection.receivedFiles.length === 0) return;
    const zipBlob = await createZipBlob(connection.receivedFiles);
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Senderrr-files.zip';
    link.click();
    URL.revokeObjectURL(url);
  }, [connection.receivedFiles]);

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
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void connection.sendFiles(files);
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
                setRoomCode('');
                setRoomToken('');
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
                  <span className="meta-label">
                    {shareableUrl ? 'Room Code' : 'Connected Room'}
                  </span>
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

                {shareableUrl && (
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
                )}
              </div>

              {/* Collapsible QR Code */}
              {showQR && shareableUrl && (
                <div className="qr-box">
                  <img src={qrImageUrl} alt="FastShare QR Code" className="qr-render" />
                  <span className="qr-hint">Scan with mobile camera to join</span>
                </div>
              )}

              {/* Status Alert Bar */}
              <div className={`connection-callout ${isDataChannelOpen ? 'callout-success' : 'callout-waiting'}`}>
                {isDataChannelOpen ? (
                  <span>Connected with peer. Ready to transfer and receive files.</span>
                ) : shareableUrl ? (
                  <span>Waiting for peer to connect. Share the room code or link above.</span>
                ) : (
                  <span>Connecting to peer session...</span>
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
                  <p className="dropzone-main-text">Drag and drop file(s) here</p>
                  <p className="dropzone-sub-text">Up to 5 GiB per room session</p>
                </div>
                <label className="btn-outline">
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const files = event.target.files;
                      if (files && files.length > 0) void connection.sendFiles(files);
                      event.target.value = '';
                    }}
                  />
                  Select Files
                </label>
              </div>
            </div>
          )}

          {/* SENDER: BATCH SENDING QUEUE STATUS */}
          {connection.sendingQueue.length > 0 && (() => {
            const totalBytes = connection.sendingQueue.reduce((acc, item) => acc + item.size, 0);
            const totalTransferred = connection.sendingQueue.reduce((acc, item) => acc + item.transferred, 0);
            const completedCount = connection.sendingQueue.filter((item) => item.status === 'completed').length;
            const totalPercent = totalBytes > 0 ? Math.min(100, Math.round((totalTransferred / totalBytes) * 100)) : 0;
            const isBatchComplete = totalPercent >= 100 && completedCount === connection.sendingQueue.length;
            const isAnyActive = connection.sendingQueue.some(
              (item) => item.status === 'transferring' || item.status === 'queued'
            );

            return (
              <div className="queue-section">
                <div className="queue-header">
                  <div>
                    <span className="queue-title">
                      Sending Files ({completedCount}/{connection.sendingQueue.length})
                    </span>
                    <span className="font-mono text-xs text-muted queue-total-size">
                      {formatBytes(totalTransferred)} / {formatBytes(totalBytes)} ({totalPercent}%)
                    </span>
                  </div>
                  {isAnyActive ? (
                    <button
                      type="button"
                      className="btn-text-danger"
                      onClick={connection.cancelTransfer}
                    >
                      Cancel All
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline-pill"
                      onClick={connection.clearSendingQueue}
                    >
                      Dismiss
                    </button>
                  )}
                </div>

                <div className="progress-track">
                  <div
                    className={`progress-fill ${isBatchComplete ? 'is-complete' : ''}`}
                    style={{ width: `${totalPercent}%` }}
                  />
                </div>

                <div className="queue-list">
                  {connection.sendingQueue.map((item) => {
                    const itemPct = item.size > 0 ? Math.min(100, Math.round((item.transferred / item.size) * 100)) : 0;
                    return (
                      <div key={item.id} className="queue-row">
                        <div className="queue-row-info">
                          <div className="queue-row-meta">
                            <span className="queue-file-name">{item.name}</span>
                            <span className="font-mono text-xs text-muted">
                              {formatBytes(item.size)}
                            </span>
                          </div>
                          {item.status === 'transferring' && (
                            <div className="queue-mini-track">
                              <div
                                className="queue-mini-fill"
                                style={{ width: `${itemPct}%` }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="queue-row-status">
                          {item.status === 'queued' && (
                            <span className="status-tag tag-queued">Queued</span>
                          )}
                          {item.status === 'transferring' && (
                            <span className="status-tag tag-transferring font-mono">{itemPct}%</span>
                          )}
                          {item.status === 'completed' && (
                            <span className="status-tag tag-completed">100% Sent</span>
                          )}
                          {item.status === 'cancelled' && (
                            <span className="status-tag tag-cancelled">Cancelled</span>
                          )}
                          {item.status === 'error' && (
                            <span className="status-tag tag-error">Failed</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* RECEIVER: ACTIVE INCOMING FILE PROGRESS */}
          {!connection.sendingQueue.length && connection.receiveProgress && (() => {
            const receivePct = Math.min(
              100,
              Math.round((connection.receiveProgress.transferred / connection.receiveProgress.total) * 100)
            );
            const isComplete = receivePct >= 100;
            return (
              <div className="progress-section">
                <div className="progress-meta">
                  <span className="progress-name">{connection.receiveProgress.name}</span>
                  <span className={`progress-pct font-mono ${isComplete ? 'is-complete' : ''}`}>
                    {receivePct}%
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className={`progress-fill ${isComplete ? 'is-complete' : ''}`}
                    style={{ width: `${receivePct}%` }}
                  />
                </div>
                <div className="progress-sub-row">
                  <span className="font-mono text-xs">
                    {formatBytes(connection.receiveProgress.transferred)} / {formatBytes(connection.receiveProgress.total)}
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

          {/* RECEIVED FILES */}
          {connection.receivedFiles.length === 1 && (
            <div className="received-card">
              <div className="received-meta">
                <span className="received-title">{connection.receivedFiles[0]!.name}</span>
                <span className="font-mono text-xs text-muted">
                  {formatBytes(connection.receivedFiles[0]!.size)}
                </span>
              </div>
              <button
                type="button"
                className="btn-solid"
                onClick={() => handleDownloadFile(connection.receivedFiles[0]!)}
              >
                Download
              </button>
            </div>
          )}

          {connection.receivedFiles.length > 1 && (
            <div className="received-section">
              <div className="received-section-header">
                <div>
                  <span className="received-section-title">
                    Received Files ({connection.receivedFiles.length})
                  </span>
                  <span className="font-mono text-xs text-muted received-total-size">
                    {formatBytes(connection.receivedFiles.reduce((sum, f) => sum + f.size, 0))} total
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-solid"
                  onClick={handleDownloadZip}
                >
                  Download All as ZIP
                </button>
              </div>

              <div className="received-list">
                {connection.receivedFiles.map((file, idx) => (
                  <div key={`${file.name}-${idx}`} className="received-list-row">
                    <div className="received-meta">
                      <span className="received-title">{file.name}</span>
                      <span className="font-mono text-xs text-muted">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-outline-pill"
                      onClick={() => handleDownloadFile(file)}
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
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
