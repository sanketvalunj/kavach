import type { StreamMessage } from './api';
import { getAccessToken } from './auth';

const apiBase = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? 'http://localhost:8000';
export function connectStream(onMessage: (message: StreamMessage) => void, onStatus?: (connected: boolean) => void): () => void {
  const url = new URL('/ws/stream', apiBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
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
