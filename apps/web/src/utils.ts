export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function createShareableLink(roomCode: string, roomToken?: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('code', roomCode);
  if (roomToken) {
    url.searchParams.set('token', roomToken);
  }
  return url.toString();
}

export function parseShareableLink(): { roomCode: string; roomToken?: string | undefined } | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const token = params.get('token') ?? undefined;
  if (code) {
    return { roomCode: code.toUpperCase(), roomToken: token };
  }
  return null;
}

