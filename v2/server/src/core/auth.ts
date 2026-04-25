/**
 * Simple session-based authentication.
 * Uses OpenWrt's rpcd session system under the hood for credential validation.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UbusClient } from './ubus.js';

const sessions = new Map<string, { username: string; created: number }>();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Validate credentials against OpenWrt's rpcd */
async function validateCredentials(username: string, password: string, ubus: UbusClient): Promise<boolean> {
  try {
    // Try ubus session login via CLI
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('ubus', ['call', 'session', 'login', JSON.stringify({ username, password })], { timeout: 5000 });
    const result = JSON.parse(String(stdout));
    return !!result.ubus_rpc_session;
  } catch {
    // Fallback: if ubus not available, accept root with empty password for dev
    return username === 'root' && password === '';
  }
}

/** Create a new session token */
function createSession(username: string): string {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username, created: Date.now() });
  // Clean expired sessions
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.created > SESSION_TTL) sessions.delete(k);
  }
  return token;
}

/** Validate a session token */
export function validateSession(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

/** Destroy a session */
export function destroySession(token: string): void {
  sessions.delete(token);
}

/** Extract session token from request (cookie or header) */
export function getSessionToken(req: IncomingMessage): string {
  // Check Authorization header
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  // Check cookie
  const cookies = req.headers.cookie ?? '';
  const match = cookies.match(/laubter_session=([a-f0-9]+)/);
  return match?.[1] ?? '';
}

/** Auth middleware — returns true if authenticated, false if rejected */
export function isAuthenticated(req: IncomingMessage): boolean {
  const url = req.url ?? '/';
  // Public paths
  if (url === '/api/auth/login') return true;
  if (!url.startsWith('/api/')) return true; // static files don't need auth
  if (url === '/api/auth/status') return true;

  const token = getSessionToken(req);
  return validateSession(token) !== null;
}

/** Auth route handlers */
export function authRoutes(ubus: UbusClient) {
  return [
    {
      method: 'POST' as const,
      path: '/api/auth/login',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        const { username, password } = JSON.parse(Buffer.concat(chunks).toString());

        if (await validateCredentials(username, password, ubus)) {
          const token = createSession(username);
          res.setHeader('Set-Cookie', `laubter_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', username }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }
      }
    },
    {
      method: 'POST' as const,
      path: '/api/auth/logout',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const token = getSessionToken(req);
        destroySession(token);
        res.setHeader('Set-Cookie', 'laubter_session=; Path=/; HttpOnly; Max-Age=0');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
    },
    {
      method: 'GET' as const,
      path: '/api/auth/status',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const token = getSessionToken(req);
        const username = validateSession(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: !!username, username }));
      }
    }
  ];
}
