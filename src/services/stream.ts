import type { StreamMessage } from './api';
import { getAccessToken } from './auth';

const envApiUrl = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL;

export function getStreamUrl(): string {
  if (envApiUrl) {
    const url = new URL('/ws/stream', envApiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
  if (typeof window !== 'undefined') {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isProd = Boolean((import.meta as ImportMeta & { env?: Record<string, string> }).env?.PROD);
    if (!isLocalhost || isProd) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/api/ws/stream`;
    }
  }
  return 'ws://localhost:8000/ws/stream';
}

export function connectStream(onMessage: (message: StreamMessage) => void, onStatus?: (connected: boolean) => void): () => void {
  const url = getStreamUrl();
  const token = getAccessToken();
  const socket = new WebSocket(url);
  socket.onopen = () => { if (!token) { onStatus?.(false); socket.close(4401, 'Sign in required'); return; } socket.send(JSON.stringify({ type: 'auth', token })); onStatus?.(true); };
  socket.onclose = () => { onStatus?.(false); };
  socket.onerror = () => { onStatus?.(false); };
  socket.onmessage = event => {
    try {
      const message = JSON.parse(String(event.data)) as StreamMessage;
      if (message.type === 'full_state' || message.type === 'tick_delta') onMessage(message);
    } catch (error) { console.error('Invalid Kavach stream message', error); }
  };
  return () => { if (socket.readyState < WebSocket.CLOSING) socket.close(); };
}
