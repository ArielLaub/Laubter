/**
 * asus-aimesh — ASUS AiMesh Router Client
 *
 * A standalone TypeScript library for communicating with ASUS routers
 * running AiMesh firmware. Uses the undocumented ASUS app API.
 *
 * Features:
 * - Authentication with automatic token refresh and rate limiting
 * - Mesh topology: nodes, clients, per-band client mapping
 * - Client binding (sta_binding_list)
 * - Node configuration (LED, backhaul priority, preferred uplink)
 * - Cooldown management to prevent ASUS lockouts
 *
 * @example
 * ```ts
 * const asus = new AsusAiMeshClient({
 *   host: '192.168.50.2',
 *   port: 8443,
 *   proto: 'https',
 *   username: 'admin',
 *   password: 'mypassword'
 * });
 *
 * const nodes = await asus.getNodes();
 * const topology = await asus.getTopology();
 * await asus.bindClient('AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66');
 * ```
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AsusConnectionConfig, AsusNodeRaw, AsusClientRaw,
  AsusTopologyData, AsusTopoClientEntry
} from './types.js';

const exec = promisify(execFile);

const USER_AGENT = 'asusrouter-Android-DUTUtil-1.0.0.245';
const TOKEN_LIFETIME = 20 * 60 * 1000; // 20 minutes
const COOLDOWN_DURATION = 15_000; // 15 seconds after apply
const LOGIN_RATE_LIMIT = 30_000; // min 30s between login attempts
const CACHE_TTL = 5_000; // 5 seconds

export interface AsusClientOptions extends AsusConnectionConfig {
  /** Custom fetch timeout in ms (default: 10000) */
  timeout?: number;
}

export class AsusAiMeshClient {
  private config: AsusConnectionConfig;
  private timeout: number;

  // Auth state
  private token = '';
  private tokenTime = 0;
  private lastLoginAttempt = 0;
  private cooldownUntil = 0;

  // Response cache
  private cache = new Map<string, { data: string; ts: number }>();

  constructor(opts: AsusClientOptions) {
    this.config = {
      host: opts.host,
      port: opts.port,
      proto: opts.proto,
      username: opts.username,
      password: opts.password,
    };
    this.timeout = opts.timeout ?? 10_000;
  }

  get baseUrl(): string {
    return `${this.config.proto}://${this.config.host}:${this.config.port}`;
  }

  // ============================================================
  // Authentication
  // ============================================================

  /** Force a fresh login. Returns true on success. */
  async login(): Promise<boolean> {
    const now = Date.now();
    if (now < this.cooldownUntil) return false;
    if (now - this.lastLoginAttempt < LOGIN_RATE_LIMIT) return false;

    this.lastLoginAttempt = now;
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

    try {
      const { stdout } = await exec('curl', [
        '-sk', '-X', 'POST', `${this.baseUrl}/login.cgi`,
        '-H', `user-agent: ${USER_AGENT}`,
        '-d', `login_authorization=${auth}`
      ], { timeout: this.timeout });

      const match = stdout.match(/"asus_token":"([^"]+)"/);
      if (match) {
        this.token = match[1];
        this.tokenTime = now;
        return true;
      }
    } catch { /* login failed */ }

    return false;
  }

  /** Ensure we have a valid token. Returns true if authenticated. */
  async ensureAuth(): Promise<boolean> {
    const now = Date.now();
    if (now < this.cooldownUntil) return false;
    if (this.token && (now - this.tokenTime) < TOKEN_LIFETIME) return true;
    return this.login();
  }

  /** Test connection and credentials. */
  async testConnection(): Promise<{ ok: boolean; error?: string; data?: Record<string, string> }> {
    this.token = '';
    this.tokenTime = 0;

    if (await this.login()) {
      try {
        const data = await this.fetch<Record<string, string>>('nvram_get(productid)');
        if (data.productid) return { ok: true, data };
        return { ok: false, error: 'Logged in but could not read data. The router may have rate-limited login attempts.' };
      } catch {
        return { ok: false, error: 'Login succeeded but data fetch failed.' };
      }
    }

    return { ok: false, error: 'Authentication failed. Check credentials or wait 1-2 minutes (ASUS rate limits).' };
  }

  // ============================================================
  // Data fetching (with cache)
  // ============================================================

  /** Fetch data from the ASUS app API via appGet.cgi hook. */
  async fetch<T = unknown>(hook: string): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(hook);
    if (cached && (now - cached.ts) < CACHE_TTL) {
      return JSON.parse(cached.data) as T;
    }

    if (!await this.ensureAuth()) {
      throw new AsusError('Not authenticated', 'AUTH_FAILED');
    }

    const { stdout } = await exec('curl', [
      '-sk',
      '-H', `Cookie: asus_s_token=${this.token}`,
      '-H', `user-agent: ${USER_AGENT}`,
      `${this.baseUrl}/appGet.cgi?hook=${hook}`
    ], { timeout: this.timeout });

    if (stdout.includes('Main_Login')) {
      // Token expired, try re-login
      if (await this.login()) {
        return this.fetch<T>(hook); // retry once
      }
      throw new AsusError('Session expired', 'SESSION_EXPIRED');
    }

    this.cache.set(hook, { data: stdout, ts: now });
    return JSON.parse(stdout) as T;
  }

  // ============================================================
  // High-level API
  // ============================================================

  /** Get all mesh nodes. */
  async getNodes(): Promise<AsusNodeRaw[]> {
    const data = await this.fetch<{ get_cfg_clientlist: AsusNodeRaw[] }>('get_cfg_clientlist()');
    return data.get_cfg_clientlist ?? [];
  }

  /** Get all clients. */
  async getClients(): Promise<Record<string, AsusClientRaw>> {
    const data = await this.fetch<{ get_clientlist: Record<string, AsusClientRaw> }>('get_clientlist()');
    return data.get_clientlist ?? {};
  }

  /** Get per-node-per-band topology. */
  async getTopologyData(): Promise<AsusTopologyData> {
    const data = await this.fetch<{ get_allclientlist: AsusTopologyData }>('get_allclientlist()');
    return data.get_allclientlist ?? {};
  }

  /** Get router info (SSID, product ID, firmware, LAN IP). */
  async getInfo(): Promise<Record<string, string>> {
    return this.fetch<Record<string, string>>(
      'nvram_get(wl0_ssid)%3Bnvram_get(wl1_ssid)%3Bnvram_get(wl2_ssid)%3Bnvram_get(productid)%3Bnvram_get(firmver)%3Bnvram_get(buildno)%3Bnvram_get(lan_ipaddr)'
    );
  }

  /** Get all data needed for full topology rendering. */
  async getFullTopology(): Promise<{
    nodes: AsusNodeRaw[];
    clients: Record<string, AsusClientRaw>;
    topology: AsusTopologyData;
    info: Record<string, string>;
  }> {
    const [nodesResp, clientsResp, topoResp, info] = await Promise.all([
      this.fetch<{ get_cfg_clientlist: AsusNodeRaw[] }>('get_cfg_clientlist()'),
      this.fetch<{ get_clientlist: Record<string, AsusClientRaw> }>('get_clientlist()'),
      this.fetch<{ get_allclientlist: AsusTopologyData }>('get_allclientlist()'),
      this.getInfo()
    ]);

    return {
      nodes: nodesResp.get_cfg_clientlist ?? [],
      clients: clientsResp.get_clientlist ?? {},
      topology: topoResp.get_allclientlist ?? {},
      info
    };
  }

  // ============================================================
  // Client binding
  // ============================================================

  /** Get the current sta_binding_list from NVRAM. */
  async getBindingList(): Promise<string> {
    const data = await this.fetch<{ sta_binding_list: string }>('nvram_get(sta_binding_list)');
    return (data.sta_binding_list ?? '')
      .replace(/&#60/g, '<').replace(/&#62/g, '>').replace(/&#124/g, '|').replace(/&#44/g, ',');
  }

  /**
   * Bind a client to a specific mesh node.
   * @param clientMac - Client MAC address
   * @param targetMac - Target node MAC (empty string to unbind)
   * @param band - Band index (default '0' = auto)
   */
  async bindClient(clientMac: string, targetMac: string, band = '0'): Promise<void> {
    const current = await this.getBindingList();
    const clientUp = clientMac.toUpperCase();
    const targetUp = targetMac.toUpperCase();

    // Parse and remove client from existing bindings
    const entries = current.split('<').filter(Boolean);
    const cleaned = entries.map(entry => {
      const parts = entry.split('>');
      const nodeClients = (parts[2] ?? '').split('|')
        .filter(c => c && !c.toUpperCase().startsWith(clientUp));
      return nodeClients.length > 0 ? `${parts[0]}>${parts[1]}>${nodeClients.join('|')}` : '';
    }).filter(Boolean);

    // Build new list
    let newList = cleaned.length > 0 ? '<' + cleaned.join('<') : '';
    if (targetUp) {
      newList += `<${targetUp}>1>${clientUp},${band}`;
    }

    await this.apply({
      action_mode: 'apply',
      rc_service: 'update_sta_binding',
      sta_binding_list: newList
    });
  }

  /** Unbind a client (auto-roaming). */
  async unbindClient(clientMac: string): Promise<void> {
    return this.bindClient(clientMac, '');
  }

  // ============================================================
  // Node management
  // ============================================================

  /** Set node configuration via cfgsync. */
  async setNodeConfig(nodeMac: string, config: Record<string, Record<string, string>>): Promise<void> {
    await this.apply({
      action_mode: 'apply',
      rc_service: 'restart_cfgsync',
      amesh_le_client_list: `${nodeMac.toUpperCase()}>${JSON.stringify(config)}`
    });
  }

  /** Toggle LED on a mesh node. */
  async setLed(nodeMac: string, enabled: boolean): Promise<void> {
    await this.setNodeConfig(nodeMac, { ctrl_led: { led_val: enabled ? '1' : '0' } });
  }

  /** Set backhaul priority for a node. */
  async setBackhaulPriority(nodeMac: string, mode: 'auto' | 'ethernet' | 'wireless'): Promise<void> {
    const val = mode === 'ethernet' ? '1' : mode === 'wireless' ? '2' : '3';
    await this.setNodeConfig(nodeMac, { backhalctrl: { amas_ethernet: val } });
  }

  /** Reboot a mesh node. */
  async rebootNode(nodeMac: string): Promise<void> {
    await this.apply({
      action_mode: 'reboot',
      re_mac: nodeMac.toUpperCase()
    });
  }

  // ============================================================
  // Low-level apply
  // ============================================================

  /** POST to start_apply.htm. Sets cooldown on success. */
  private async apply(params: Record<string, string>): Promise<string> {
    if (!await this.ensureAuth()) {
      throw new AsusError('Not authenticated', 'AUTH_FAILED');
    }

    const args = [
      '-sk', '-X', 'POST',
      '-H', `Cookie: asus_s_token=${this.token}`,
      '-H', `user-agent: ${USER_AGENT}`,
      '-H', `Referer: ${this.baseUrl}/AiMesh.asp`,
      `${this.baseUrl}/start_apply.htm`
    ];

    for (const [key, val] of Object.entries(params)) {
      args.push('--data-urlencode', `${key}=${val}`);
    }

    const { stdout } = await exec('curl', args, { timeout: this.timeout });

    // Set cooldown — ASUS restarts httpd after apply
    this.cooldownUntil = Date.now() + COOLDOWN_DURATION;
    this.token = '';
    this.cache.clear();

    // Check for auth failure (short redirect response)
    if (stdout.length < 200 && stdout.includes('Main_Login')) {
      throw new AsusError('Session expired during apply', 'SESSION_EXPIRED');
    }

    return stdout;
  }

  /** Clear all cached responses. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Check if currently in cooldown. */
  get inCooldown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  /** Update connection config. Clears auth state. */
  updateConfig(config: Partial<AsusConnectionConfig>): void {
    Object.assign(this.config, config);
    this.token = '';
    this.tokenTime = 0;
    this.cache.clear();
  }
}

export class AsusError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AsusError';
  }
}
