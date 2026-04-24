/**
 * WebSocketHub — manages WebSocket connections and topic-based pub/sub.
 *
 * Clients subscribe to topics (e.g. "system:metrics", "traffic:live").
 * Plugins register subscriptions with a collect() function and interval.
 * The hub calls collect() on schedule and pushes data to all subscribers.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Subscription } from '../types/plugin.js';

interface ClientState {
  ws: WebSocket;
  topics: Set<string>;
}

interface TopicState {
  subscription: Subscription;
  timer?: ReturnType<typeof setInterval>;
  lastData?: unknown;
}

export class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientState>();
  private topics = new Map<string, TopicState>();

  /** Attach to an existing HTTP server */
  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const state: ClientState = { ws, topics: new Set() };
      this.clients.set(ws, state);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(state, msg);
        } catch {
          ws.send(JSON.stringify({ error: 'invalid message' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // Send available topics on connect
      ws.send(JSON.stringify({
        type: 'topics',
        topics: Array.from(this.topics.keys())
      }));
    });
  }

  /** Register a subscription from a plugin */
  registerSubscription(sub: Subscription): void {
    const state: TopicState = { subscription: sub };
    this.topics.set(sub.topic, state);

    if (sub.interval > 0) {
      state.timer = setInterval(async () => {
        await this.collectAndPush(sub.topic);
      }, sub.interval);
    }
  }

  /** Push data to all subscribers of a topic (callable from plugins for event-driven pushes) */
  push(topic: string, data: unknown): void {
    const msg = JSON.stringify({ type: 'data', topic, data, ts: Date.now() });

    for (const client of this.clients.values()) {
      if (client.topics.has(topic) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** Collect fresh data for a topic and push to subscribers */
  private async collectAndPush(topic: string): Promise<void> {
    const state = this.topics.get(topic);
    if (!state) return;

    try {
      const data = await state.subscription.collect();
      state.lastData = data;
      this.push(topic, data);
    } catch (err) {
      console.error(`[ws] collect failed for ${topic}:`, err);
    }
  }

  private handleMessage(client: ClientState, msg: { type: string; topic?: string; topics?: string[] }): void {
    switch (msg.type) {
      case 'subscribe':
        if (msg.topic && this.topics.has(msg.topic)) {
          client.topics.add(msg.topic);
          // Send last known data immediately
          const state = this.topics.get(msg.topic);
          if (state?.lastData !== undefined) {
            client.ws.send(JSON.stringify({
              type: 'data', topic: msg.topic, data: state.lastData, ts: Date.now()
            }));
          }
        }
        if (msg.topics) {
          for (const t of msg.topics) {
            if (this.topics.has(t)) client.topics.add(t);
          }
        }
        break;

      case 'unsubscribe':
        if (msg.topic) client.topics.delete(msg.topic);
        if (msg.topics) {
          for (const t of msg.topics) client.topics.delete(t);
        }
        break;
    }
  }

  /** Clean up all timers */
  shutdown(): void {
    for (const state of this.topics.values()) {
      if (state.timer) clearInterval(state.timer);
    }
    this.wss?.close();
  }
}
