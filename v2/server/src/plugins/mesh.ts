/**
 * Mesh plugin — ASUS AiMesh proxy for topology, clients, binding, management.
 * Ported from v1 laubter-mesh rpcd plugin.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const exec = promisify(execFile);

const DATA_DIR = '/tmp/laubter/mesh';
const PASS_FILE = '/etc/laubter_mesh_secret';
const CACHE_TTL = 5000; // ms

interface MeshConfig {
  host: string;
  port: string;
  proto: string;
  username: string;
  password: string;
}

// --- Token management ---
let token = '';
let tokenTime = 0;
let cooldownUntil = 0;

async function getConfig(ctx: PluginContext): Promise<MeshConfig> {
  const host = await ctx.uci.getValue('laubter', 'mesh', 'host') ?? '192.168.50.2';
  const port = await ctx.uci.getValue('laubter', 'mesh', 'port') ?? '8443';
  const proto = await ctx.uci.getValue('laubter', 'mesh', 'proto') ?? 'https';
  const username = await ctx.uci.getValue('laubter', 'mesh', 'username') ?? 'admin';
  let password = '';
  try { password = await readFile(PASS_FILE, 'utf-8'); } catch {}
  return { host: String(host), port: String(port), proto: String(proto), username: String(username), password };
}

function baseUrl(cfg: MeshConfig): string {
  return `${cfg.proto}://${cfg.host}:${cfg.port}`;
}

async function login(cfg: MeshConfig): Promise<boolean> {
  const now = Date.now();
  if (now < cooldownUntil) return false;

  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  try {
    const { stdout } = await exec('curl', [
      '-sk', '-X', 'POST', `${baseUrl(cfg)}/login.cgi`,
      '-H', 'user-agent: asusrouter-Android-DUTUtil-1.0.0.245',
      '-d', `login_authorization=${auth}`
    ], { timeout: 10000 });

    const match = stdout.match(/"asus_token":"([^"]+)"/);
    if (match) {
      token = match[1];
      tokenTime = now;
      return true;
    }
  } catch {}
  return false;
}

async function ensureAuth(cfg: MeshConfig): Promise<boolean> {
  if (Date.now() < cooldownUntil) return false;
  if (token && (Date.now() - tokenTime) < 1200000) return true;
  return login(cfg);
}

// --- Cached fetch ---
const cache = new Map<string, { data: string; ts: number }>();

async function asusFetch(cfg: MeshConfig, hook: string): Promise<unknown> {
  const now = Date.now();
  const cached = cache.get(hook);
  if (cached && (now - cached.ts) < CACHE_TTL) {
    return JSON.parse(cached.data);
  }

  if (!await ensureAuth(cfg)) return {};

  try {
    const { stdout } = await exec('curl', [
      '-sk',
      '-H', `Cookie: asus_s_token=${token}`,
      '-H', 'user-agent: asusrouter-Android-DUTUtil-1.0.0.245',
      `${baseUrl(cfg)}/appGet.cgi?hook=${hook}`
    ], { timeout: 10000 });

    if (stdout.includes('Main_Login')) {
      if (await login(cfg)) {
        return asusFetch(cfg, hook); // retry once
      }
      return {};
    }

    cache.set(hook, { data: stdout, ts: now });
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

function setCooldown(): void {
  cooldownUntil = Date.now() + 15000;
  token = '';
  cache.clear();
}

const plugin: Plugin = {
  manifest: { name: 'mesh', version: '1.0.0', description: 'ASUS AiMesh topology, clients, binding', dependencies: ['dhcp'] },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    await mkdir(DATA_DIR, { recursive: true }).catch(() => {});

    return {
      routes: [
        {
          method: 'GET', path: '/api/mesh/nodes',
          handler: async (_req, res) => {
            const cfg = await getConfig(ctx);
            const data = await asusFetch(cfg, 'get_cfg_clientlist()') as Record<string, unknown>;
            sendJson(res, 200, data.get_cfg_clientlist ?? []);
          }
        },
        {
          method: 'GET', path: '/api/mesh/clients',
          handler: async (_req, res) => {
            const cfg = await getConfig(ctx);
            const data = await asusFetch(cfg, 'get_clientlist()') as Record<string, unknown>;
            sendJson(res, 200, data.get_clientlist ?? {});
          }
        },
        {
          method: 'GET', path: '/api/mesh/topology',
          handler: async (_req, res) => {
            const cfg = await getConfig(ctx);
            const [nodes, clients, topo, info] = await Promise.all([
              asusFetch(cfg, 'get_cfg_clientlist()'),
              asusFetch(cfg, 'get_clientlist()'),
              asusFetch(cfg, 'get_allclientlist()'),
              asusFetch(cfg, 'nvram_get(wl0_ssid)%3Bnvram_get(productid)%3Bnvram_get(lan_ipaddr)')
            ]);
            sendJson(res, 200, { nodes, clients, topology: topo, info });
          }
        },
        {
          method: 'POST', path: '/api/mesh/bind',
          handler: async (req, res) => {
            const body = await readJson<{ client_mac: string; target_mac: string; band?: string }>(req);
            const cfg = await getConfig(ctx);
            if (!await ensureAuth(cfg)) {
              sendJson(res, 503, { error: 'Not authenticated to mesh controller' });
              return;
            }

            // Get current binding list
            const current = await asusFetch(cfg, 'nvram_get(sta_binding_list)') as Record<string, string>;
            let bindList = (current.sta_binding_list ?? '')
              .replace(/&#60/g, '<').replace(/&#62/g, '>').replace(/&#124/g, '|').replace(/&#44/g, ',');

            // Remove client from existing bindings
            const clientMac = body.client_mac.toUpperCase();
            const entries = bindList.split('<').filter(Boolean);
            const cleaned = entries.filter(entry => {
              const clients = entry.split('>')[2] ?? '';
              const filtered = clients.split('|').filter(c => !c.toUpperCase().startsWith(clientMac));
              return filtered.length > 0;
            }).map(entry => {
              const parts = entry.split('>');
              const clients = (parts[2] ?? '').split('|').filter(c => !c.toUpperCase().startsWith(clientMac)).join('|');
              return `${parts[0]}>${parts[1]}>${clients}`;
            });

            // Add new binding
            let newList = '<' + cleaned.join('<');
            if (cleaned.length === 0) newList = '';

            if (body.target_mac) {
              const targetMac = body.target_mac.toUpperCase();
              newList += `<${targetMac}>1>${clientMac},${body.band ?? '0'}`;
            }

            // Apply
            try {
              await exec('curl', [
                '-sk', '-X', 'POST',
                '-H', `Cookie: asus_s_token=${token}`,
                '-H', 'user-agent: asusrouter-Android-DUTUtil-1.0.0.245',
                '-H', `Referer: ${baseUrl(cfg)}/AiMesh.asp`,
                `${baseUrl(cfg)}/start_apply.htm`,
                '--data-urlencode', 'action_mode=apply',
                '--data-urlencode', 'rc_service=update_sta_binding',
                '--data-urlencode', `sta_binding_list=${newList}`
              ], { timeout: 10000 });
              setCooldown();
              sendJson(res, 200, { status: 'ok' });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        },
        {
          method: 'GET', path: '/api/mesh/config',
          handler: async (_req, res) => {
            const cfg = await getConfig(ctx);
            sendJson(res, 200, { host: cfg.host, port: cfg.port, proto: cfg.proto, username: cfg.username, hasPassword: !!cfg.password });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'mesh:topology',
          interval: 10000,
          collect: async () => {
            const cfg = await getConfig(ctx);
            const [nodes, topo] = await Promise.all([
              asusFetch(cfg, 'get_cfg_clientlist()'),
              asusFetch(cfg, 'get_allclientlist()')
            ]);
            return { nodes, topology: topo };
          }
        }
      ]
    };
  }
};

export default plugin;
