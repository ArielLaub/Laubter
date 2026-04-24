/** WebSocket store — auto-reconnecting, topic-based live data */

import { writable, type Readable } from 'svelte/store';

const WS_URL = import.meta.env.DEV ? 'ws://192.168.50.1:3001/ws' : `ws://${location.host}/ws`;

type Listener = (data: unknown) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Map<string, Set<Listener>>();
const subscribedTopics = new Set<string>();

export const connected = writable(false);

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected.set(true);
    // Re-subscribe to all topics
    for (const topic of subscribedTopics) {
      ws?.send(JSON.stringify({ type: 'subscribe', topic }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data' && msg.topic) {
        const fns = listeners.get(msg.topic);
        if (fns) for (const fn of fns) fn(msg.data);
      }
    } catch { /* ignore parse errors */ }
  };

  ws.onclose = () => {
    connected.set(false);
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

/** Subscribe to a WebSocket topic. Returns an unsubscribe function. */
export function subscribe<T = unknown>(topic: string): Readable<T | null> {
  const store = writable<T | null>(null);

  const listener: Listener = (data) => store.set(data as T);

  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(listener);
  subscribedTopics.add(topic);

  // Send subscribe message if connected
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', topic }));
  }

  // Start connection if not already
  connect();

  // Return a readable with custom unsubscribe
  return {
    subscribe: (run, invalidate) => {
      const unsub = store.subscribe(run, invalidate);
      return () => {
        unsub();
        listeners.get(topic)?.delete(listener);
        if (listeners.get(topic)?.size === 0) {
          listeners.delete(topic);
          subscribedTopics.delete(topic);
          ws?.send(JSON.stringify({ type: 'unsubscribe', topic }));
        }
      };
    }
  };
}

/** Start the WebSocket connection */
export function init() {
  connect();
}
