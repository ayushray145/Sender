import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage } from '@fastshare/protocol';
import { FileTransferManager, type TransferProgress } from '@fastshare/transfer-core';
import type { PeerConnectionStatus } from '../network/peer-connection-manager.js';
import { PeerConnectionManager } from '../network/peer-connection-manager.js';
import { SignalingClient } from '../network/signaling-client.js';

type RoomCredentials = { readonly roomCode: string; readonly roomToken?: string | undefined };

export type SendingFileStatus = 'queued' | 'transferring' | 'completed' | 'error' | 'cancelled';

export type SendingFileItem = {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly status: SendingFileStatus;
  readonly transferred: number;
};

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
  const [receivedFiles, setReceivedFiles] = useState<File[]>([]);
  const [sendingQueue, setSendingQueue] = useState<SendingFileItem[]>([]);

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
    setCredentials(undefined);
    setReceivedTest(false);
    setSendProgress(undefined);
    setReceiveProgress(undefined);
    setReceivedFiles([]);
    setSendingQueue([]);
    setError(undefined);
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
            onSendProgress: (progress) => {
              setSendProgress(progress);
              setSendingQueue((prev) =>
                prev.map((item) =>
                  item.status === 'transferring'
                    ? { ...item, transferred: progress.transferred }
                    : item,
                ),
              );
            },
            onReceiveProgress: setReceiveProgress,
            onFileReceived: ({ file }) => {
              setReceiveProgress(undefined);
              setReceivedFiles((prev) => [...prev, file]);
            },
            onCancelled: () => {
              setSendProgress(undefined);
              setReceiveProgress(undefined);
            },
            onError: (transferError) => {
              setSendProgress(undefined);
              setReceiveProgress(undefined);
              setError(transferError.message);
            },
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
        if (message.type === 'room.created') {
          setCredentials({ roomCode: message.roomCode, roomToken: message.roomToken });
        } else if (message.type === 'room.joined') {
          setCredentials({ roomCode: message.roomCode });
        }
      });
      try {
        await client.connect();
        if (action === 'create') {
          client.send({ type: 'room.create' });
        } else if (room !== undefined) {
          const cleanCode = room.roomCode.trim().toUpperCase();
          const cleanToken = room.roomToken?.trim();
          const joinMsg: ClientMessage =
            cleanToken && cleanToken.length === 64
              ? { type: 'room.join', roomCode: cleanCode, roomToken: cleanToken }
              : { type: 'room.join', roomCode: cleanCode };
          client.send(joinMsg);
        }
      } catch (connectionError) {
        setError(connectionError instanceof Error ? connectionError.message : 'Unable to connect.');
        disconnect();
      }
    },
    [disconnect, signalingUrl, stunUrl],
  );

  const createRoom = useCallback(() => connect('create'), [connect]);
  const joinRoom = useCallback(
    (roomCode: string, roomToken?: string) => connect('join', { roomCode, roomToken }),
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

  const sendFiles = useCallback(async (files: FileList | readonly File[] | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    const initialQueue: SendingFileItem[] = fileList.map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      name: file.name,
      size: file.size,
      status: 'queued',
      transferred: 0,
    }));
    setSendingQueue(initialQueue);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]!;
      const currentId = initialQueue[i]!.id;

      setSendingQueue((prev) =>
        prev.map((item) =>
          item.id === currentId ? { ...item, status: 'transferring' } : item,
        ),
      );

      try {
        setSendProgress(undefined);
        await transferRef.current?.sendFile(file);
        setSendingQueue((prev) =>
          prev.map((item) =>
            item.id === currentId
              ? { ...item, status: 'completed', transferred: item.size }
              : item,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (sendError) {
        setSendProgress(undefined);
        const isCancelled =
          sendError instanceof Error && sendError.message === 'Transfer cancelled.';
        setSendingQueue((prev) =>
          prev.map((item, idx) => {
            if (item.id === currentId) {
              return { ...item, status: isCancelled ? 'cancelled' : 'error' };
            }
            if (idx > i && item.status === 'queued') {
              return { ...item, status: 'cancelled' };
            }
            return item;
          }),
        );
        if (!isCancelled) {
          setError(sendError instanceof Error ? sendError.message : 'Unable to send the file.');
        }
        break;
      }
    }
  }, []);

  const sendFile = useCallback((file: File) => sendFiles([file]), [sendFiles]);

  const cancelTransfer = useCallback(() => {
    transferRef.current?.cancel();
    setSendProgress(undefined);
    setReceiveProgress(undefined);
    setSendingQueue((prev) =>
      prev.map((item) =>
        item.status === 'transferring' || item.status === 'queued'
          ? { ...item, status: 'cancelled' }
          : item,
      ),
    );
  }, []);

  const clearSendingQueue = useCallback(() => {
    setSendingQueue([]);
    setSendProgress(undefined);
  }, []);

  return {
    credentials,
    status,
    receivedTest,
    error,
    createRoom,
    joinRoom,
    sendConnectionTest,
    sendFile,
    sendFiles,
    cancelTransfer,
    sendProgress,
    receiveProgress,
    receivedFile: receivedFiles[receivedFiles.length - 1],
    receivedFiles,
    sendingQueue,
    clearSendingQueue,
    disconnect,
  };
}
