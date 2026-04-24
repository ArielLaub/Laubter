/**
 * UbusClient — talks to rpcd's JSON-RPC endpoint over HTTP.
 *
 * Uses the same protocol the v1 frontend uses, but server-to-server on localhost.
 * No native dependencies, pure TypeScript.
 */

interface UbusResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: [number, T] | [number];
  error?: { code: number; message: string };
}

export interface UbusClientOptions {
  url: string; // e.g. 'http://127.0.0.1/ubus' (LuCI rpcd) or 'http://127.0.0.1:3000/ubus'
  username?: string;
  password?: string;
  timeout?: number; // ms
}

export class UbusClient {
  private url: string;
  private username: string;
  private password: string;
  private timeout: number;
  private sessionId: string = '00000000000000000000000000000000';
  private reqId = 0;

  constructor(opts: UbusClientOptions) {
    this.url = opts.url;
    this.username = opts.username ?? 'root';
    this.password = opts.password ?? '';
    this.timeout = opts.timeout ?? 10_000;
  }

  /** Authenticate and get a session token */
  async login(): Promise<void> {
    const result = await this.rawCall<{ ubus_rpc_session: string }>(
      'session', 'login',
      { username: this.username, password: this.password }
    );
    if (result?.ubus_rpc_session) {
      this.sessionId = result.ubus_rpc_session;
    } else {
      throw new Error('ubus login failed');
    }
  }

  /** Call a ubus method. Auto-re-logins on session expiry. */
  async call<T = unknown>(object: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await this.rawCall<T>(object, method, params);
    } catch (e) {
      if (e instanceof UbusError && e.code === 6) {
        // Permission denied — try re-login
        await this.login();
        return await this.rawCall<T>(object, method, params);
      }
      throw e;
    }
  }

  /** Low-level JSON-RPC call */
  private async rawCall<T>(object: string, method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.reqId;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
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

      if (!resp.ok) {
        throw new Error(`ubus HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json() as UbusResponse<T>;

      if (json.error) {
        throw new UbusError(json.error.code, json.error.message);
      }

      if (!json.result) {
        throw new Error('ubus: empty result');
      }

      const [code, data] = json.result;
      if (code !== 0) {
        throw new UbusError(code, `ubus error: ${code}`);
      }

      return (data ?? {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  get session(): string {
    return this.sessionId;
  }
}

export class UbusError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'UbusError';
  }
}

/** Error codes */
export const UBUS_STATUS = {
  OK: 0,
  INVALID_COMMAND: 1,
  INVALID_ARGUMENT: 2,
  METHOD_NOT_FOUND: 3,
  NOT_FOUND: 4,
  NO_DATA: 5,
  PERMISSION_DENIED: 6,
  TIMEOUT: 7,
} as const;
