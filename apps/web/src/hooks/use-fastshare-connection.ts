import { useCallback, useEffect, useRef, useState } from 'react';
import { FileTransferManager, type TransferProgress } from '@fastshare/transfer-core';
import type { PeerConnectionStatus } from '../network/peer-connection-manager.js';
import { PeerConnectionManager } from '../network/peer-connection-manager.js';
import { SignalingClient } from '../network/signaling-client.js';

type RoomCredentials = { readonly roomCode: string; readonly roomToken: string };

export function useFastShareConnection(signalingUrl: string, stunUrl: string) {
  const clientRef = useRef<SignalingClient | undefined>(undefined);
  const managerRef = useRef<PeerConnectionManager | undefined>(undefined);
  const transferRef = useRef<FileTransferManager | undefined>(undefined);
  const [credentials, setCredentials] = useState<RoomCredentials>();
  const [status, setStatus] = useState<PeerConnectionStatus>({
    connectionState: 'closed',
    iceConnectionState: 'closed',
    dataChannelState: 'none',
  });
  const [receivedTest, setReceivedTest] = useState(false);
  const [error, setError] = useState<string>();
  const [sendProgress, setSendProgress] = useState<TransferProgress>();
  const [receiveProgress, setReceiveProgress] = useState<TransferProgress>();
  const [receivedFile, setReceivedFile] = useState<File>();

  const disconnect = useCallback(() => {
    transferRef.current?.destroy();
    transferRef.current = undefined;
    managerRef.current?.destroy();
    managerRef.current = undefined;
    clientRef.current?.close();
    clientRef.current = undefined;
    setStatus({
      connectionState: 'closed',
      iceConnectionState: 'closed',
      dataChannelState: 'none',
    });
  }, []);

  useEffect(() => disconnect, [disconnect]);

  const connect = useCallback(
    async (action: 'create' | 'join', room?: RoomCredentials) => {
      disconnect();
      setError(undefined);
      setReceivedTest(false);
      const client = new SignalingClient(signalingUrl);
      const configuration: RTCConfiguration =
        stunUrl.trim() === '' ? {} : { iceServers: [{ urls: stunUrl.trim() }] };
      const manager = new PeerConnectionManager({
        signaling: client,
        configuration,
        onStatusChange: setStatus,
        onConnectionTestMessage: () => setReceivedTest(true),
        onError: (connectionError) => setError(connectionError.message),
        onDataChannelAvailable: (channel) => {
          transferRef.current?.destroy();
          transferRef.current = new FileTransferManager({
            channel,
            onSendProgress: setSendProgress,
            onReceiveProgress: setReceiveProgress,
            onFileReceived: ({ file }) => setReceivedFile(file),
            onError: (transferError) => setError(transferError.message),
          });
        },
        onDataChannelUnavailable: () => {
          transferRef.current?.destroy();
          transferRef.current = undefined;
        },
      });
      clientRef.current = client;
      managerRef.current = manager;
      client.onError((connectionError) => setError(connectionError.message));
      client.onMessage((message) => {
        if (message.type === 'room.created')
          setCredentials({ roomCode: message.roomCode, roomToken: message.roomToken });
      });
      try {
        await client.connect();
        if (action === 'create') client.send({ type: 'room.create' });
        else if (room !== undefined) client.send({ type: 'room.join', ...room });
      } catch (connectionError) {
        setError(connectionError instanceof Error ? connectionError.message : 'Unable to connect.');
        disconnect();
      }
    },
    [disconnect, signalingUrl, stunUrl],
  );

  const createRoom = useCallback(() => connect('create'), [connect]);
  const joinRoom = useCallback(
    (roomCode: string, roomToken: string) => connect('join', { roomCode, roomToken }),
    [connect],
  );
  const sendConnectionTest = useCallback(() => {
    try {
      managerRef.current?.sendConnectionTest();
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : 'Unable to send the connection test.',
      );
    }
  }, []);

  const sendFile = useCallback(async (file: File) => {
    try {
      setSendProgress(undefined);
      await transferRef.current?.sendFile(file);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send the file.');
    }
  }, []);
  const cancelTransfer = useCallback(() => transferRef.current?.cancel(), []);

  return {
    credentials,
    status,
    receivedTest,
    error,
    createRoom,
    joinRoom,
    sendConnectionTest,
    sendFile,
    cancelTransfer,
    sendProgress,
    receiveProgress,
    receivedFile,
    disconnect,
  };
}
