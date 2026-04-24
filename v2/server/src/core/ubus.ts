/**
 * UbusClient — calls ubus methods.
 *
 * Two modes:
 * - CLI mode (default on router): shells out to `ubus call` — no auth needed, runs as root
 * - HTTP mode (for remote dev): JSON-RPC to rpcd endpoint — needs session auth
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

interface UbusResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: [number, T] | [number];
  error?: { code: number; message: string };
}

export interface UbusClientOptions {
  /** 'cli' = use `ubus call` (local, no auth). 'http' = JSON-RPC to rpcd. */
  mode?: 'cli' | 'http';
  /** For HTTP mode: rpcd endpoint URL */
  url?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

export class UbusClient {
  private mode: 'cli' | 'http';
  private url: string;
  private username: string;
  private password: string;
  private timeout: number;
  private sessionId = '00000000000000000000000000000000';
  private reqId = 0;

  constructor(opts?: UbusClientOptions) {
    this.mode = opts?.mode ?? 'cli';
    this.url = opts?.url ?? 'http://127.0.0.1/ubus';
    this.username = opts?.username ?? 'root';
    this.password = opts?.password ?? '';
    this.timeout = opts?.timeout ?? 10_000;
  }

  /** Authenticate (HTTP mode only) */
  async login(): Promise<void> {
    if (this.mode === 'cli') return; // not needed
    const result = await this.httpCall<{ ubus_rpc_session: string }>(
      'session', 'login',
      { username: this.username, password: this.password }
    );
    if (result?.ubus_rpc_session) {
      this.sessionId = result.ubus_rpc_session;
    } else {
      throw new Error('ubus login failed');
    }
  }

  /** Call a ubus method */
  async call<T = unknown>(object: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.mode === 'cli') {
      return this.cliCall<T>(object, method, params);
    }
    try {
      return await this.httpCall<T>(object, method, params);
    } catch (e) {
      if (e instanceof UbusError && e.code === 6) {
        await this.login();
        return await this.httpCall<T>(object, method, params);
      }
      throw e;
    }
  }

  /** List available ubus objects */
  async list(): Promise<string[]> {
    if (this.mode === 'cli') {
      const { stdout } = await exec('ubus', ['list'], { timeout: this.timeout });
      return stdout.trim().split('\n').filter(Boolean);
    }
    // HTTP mode: no direct list support
    return [];
  }

  // --- CLI mode ---
  private async cliCall<T>(object: string, method: string, params: Record<string, unknown>): Promise<T> {
    const args = ['call', object, method];
    if (Object.keys(params).length > 0) {
      args.push(JSON.stringify(params));
    }
    try {
      const { stdout } = await exec('ubus', args, { timeout: this.timeout });
      return stdout.trim() ? JSON.parse(stdout) as T : {} as T;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // ubus returns exit code 4 for NOT_FOUND, 6 for PERMISSION_DENIED, etc.
      if (message.includes('Command failed')) {
        throw new UbusError(4, `ubus call ${object} ${method} failed: ${message}`);
      }
      throw err;
    }
  }

  // --- HTTP mode ---
  private async httpCall<T>(object: string, method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.reqId;
    const body = JSON.stringify({
      jsonrpc: '2.0', id,
      method: 'call',
      params: [this.sessionId, object, method, params]
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });

      if (!resp.ok) throw new Error(`ubus HTTP ${resp.status}`);
      const json = await resp.json() as UbusResponse<T>;
      if (json.error) throw new UbusError(json.error.code, json.error.message);
      if (!json.result) throw new Error('ubus: empty result');

      const [code, data] = json.result;
      if (code !== 0) throw new UbusError(code, `ubus error: ${code}`);
      return (data ?? {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class UbusError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'UbusError';
  }
}
