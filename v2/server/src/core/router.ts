/**
 * HTTP Router — minimal path-based routing with JSON helpers.
 *
 * No express, no koa — just a thin layer on top of node:http.
 * Supports path params like /api/clients/:mac
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Route, RouteHandler } from '../types/plugin.js';

interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class HttpRouter {
  private routes: CompiledRoute[] = [];

  /** Register a route */
  add(route: Route): void {
    const paramNames: string[] = [];
    const patternStr = route.path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method: route.method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler: route.handler,
    });
  }

  /** Handle an incoming request. Returns true if matched. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      try {
        await route.handler(req, res, params);
      } catch (err) {
        console.error(`[http] ${method} ${path} error:`, err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return true;
    }

    return false;
  }
}

/** Read the request body as JSON */
export async function readJson<T = unknown>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

/** Send a JSON response */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
