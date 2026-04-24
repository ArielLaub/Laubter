import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket } from 'ws';

/** Every plugin exports a manifest describing itself */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
}

/** HTTP route handler */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => void | Promise<void>;

/** HTTP route definition */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string; // e.g. '/api/system/board'
  handler: RouteHandler;
}

/** WebSocket subscription — server pushes data on this topic */
export interface Subscription {
  topic: string; // e.g. 'system:metrics'
  interval: number; // ms between pushes (0 = event-driven only)
  collect: () => unknown | Promise<unknown>;
}

/** A periodic background task (e.g. metrics sampling) */
export interface Collector {
  name: string;
  interval: number; // ms
  run: () => void | Promise<void>;
}

/** The core services passed to every plugin's setup() */
export interface PluginContext {
  ubus: import('../core/ubus.js').UbusClient;
  uci: import('../core/uci.js').UCIClient;
  ws: import('../core/websocket.js').WebSocketHub;
  log: (msg: string) => void;
}

/** The contract every plugin implements */
export interface Plugin {
  manifest: PluginManifest;
  setup(ctx: PluginContext): PluginRegistration | Promise<PluginRegistration>;
}

/** What a plugin returns from setup() */
export interface PluginRegistration {
  routes?: Route[];
  subscriptions?: Subscription[];
  collectors?: Collector[];
}
