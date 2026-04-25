/**
 * AiMesh plugin — ASUS AiMesh topology, clients, binding, node management.
 * Uses the asus-aimesh library for all router communication.
 */

import { readFile } from 'node:fs/promises';
import { AsusAiMeshClient } from '../lib/asus-aimesh/index.js';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const PASS_FILE = '/etc/laubter_mesh_secret';

let asusClient: AsusAiMeshClient | null = null;

async function getClient(ctx: PluginContext): Promise<AsusAiMeshClient> {
  if (asusClient) return asusClient;

  const host = String(await ctx.uci.getValue('laubter', 'mesh', 'host') ?? '192.168.50.2');
  const port = parseInt(String(await ctx.uci.getValue('laubter', 'mesh', 'port') ?? '8443'));
  const proto = (await ctx.uci.getValue('laubter', 'mesh', 'proto') ?? 'https') as 'https' | 'http';
  const username = String(await ctx.uci.getValue('laubter', 'mesh', 'username') ?? 'admin');
  let password = '';
  try { password = await readFile(PASS_FILE, 'utf-8'); } catch {}

  asusClient = new AsusAiMeshClient({ host, port, proto, username, password });
  return asusClient;
}

const plugin: Plugin = {
  manifest: { name: 'aimesh', version: '2.0.0', description: 'ASUS AiMesh topology, clients, binding, management', dependencies: ['dhcp'] },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/mesh/nodes',
          handler: async (_req, res) => {
            const client = await getClient(ctx);
            try { sendJson(res, 200, await client.getNodes()); }
            catch (e) { sendJson(res, 503, { error: String(e) }); }
          }
        },
        {
          method: 'GET', path: '/api/mesh/clients',
          handler: async (_req, res) => {
            const client = await getClient(ctx);
            try { sendJson(res, 200, await client.getClients()); }
            catch (e) { sendJson(res, 503, { error: String(e) }); }
          }
        },
        {
          method: 'GET', path: '/api/mesh/topology',
          handler: async (_req, res) => {
            const client = await getClient(ctx);
            try {
              const data = await client.getFullTopology();
              sendJson(res, 200, {
                nodes: { get_cfg_clientlist: data.nodes },
                clients: { get_clientlist: data.clients },
                topology: { get_allclientlist: data.topology },
                info: data.info
              });
            } catch (e) { sendJson(res, 503, { error: String(e) }); }
          }
        },
        {
          method: 'POST', path: '/api/mesh/bind',
          handler: async (req, res) => {
            const body = await readJson<{ client_mac: string; target_mac: string; band?: string }>(req);
            const client = await getClient(ctx);
            try {
              if (body.target_mac) {
                await client.bindClient(body.client_mac, body.target_mac, body.band);
              } else {
                await client.unbindClient(body.client_mac);
              }
              sendJson(res, 200, { status: 'ok' });
            } catch (e) { sendJson(res, 500, { error: String(e) }); }
          }
        },
        {
          method: 'POST', path: '/api/mesh/node/led',
          handler: async (req, res) => {
            const body = await readJson<{ mac: string; enabled: boolean }>(req);
            const client = await getClient(ctx);
            try { await client.setLed(body.mac, body.enabled); sendJson(res, 200, { status: 'ok' }); }
            catch (e) { sendJson(res, 500, { error: String(e) }); }
          }
        },
        {
          method: 'POST', path: '/api/mesh/node/backhaul',
          handler: async (req, res) => {
            const body = await readJson<{ mac: string; mode: 'auto' | 'ethernet' | 'wireless' }>(req);
            const client = await getClient(ctx);
            try { await client.setBackhaulPriority(body.mac, body.mode); sendJson(res, 200, { status: 'ok' }); }
            catch (e) { sendJson(res, 500, { error: String(e) }); }
          }
        },
        {
          method: 'POST', path: '/api/mesh/node/reboot',
          handler: async (req, res) => {
            const body = await readJson<{ mac: string }>(req);
            const client = await getClient(ctx);
            try { await client.rebootNode(body.mac); sendJson(res, 200, { status: 'ok' }); }
            catch (e) { sendJson(res, 500, { error: String(e) }); }
          }
        },
        {
          method: 'GET', path: '/api/mesh/config',
          handler: async (_req, res) => {
            const client = await getClient(ctx);
            sendJson(res, 200, { host: client.baseUrl, inCooldown: client.inCooldown });
          }
        },
        {
          method: 'POST', path: '/api/mesh/configure',
          handler: async (req, res) => {
            const body = await readJson<{ host: string; port: string; proto: string; username: string; password: string }>(req);
            try {
              // Ensure laubter.mesh section exists
              try { await ctx.uci.get('laubter', 'mesh'); } catch { await ctx.uci.addSection('laubter', 'mesh', 'mesh'); }
              if (body.host) await ctx.uci.set('laubter', 'mesh', 'host', body.host);
              if (body.port) await ctx.uci.set('laubter', 'mesh', 'port', body.port);
              if (body.proto) await ctx.uci.set('laubter', 'mesh', 'proto', body.proto);
              if (body.username) await ctx.uci.set('laubter', 'mesh', 'username', body.username);
              if (body.password) {
                const { writeFile } = await import('node:fs/promises');
                await writeFile('/etc/laubter_mesh_secret', body.password, { mode: 0o600 });
              }
              // Reset client to pick up new config
              asusClient = null;
              sendJson(res, 200, { status: 'ok' });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        },
        {
          method: 'POST', path: '/api/mesh/test',
          handler: async (_req, res) => {
            const client = await getClient(ctx);
            const result = await client.testConnection();
            sendJson(res, result.ok ? 200 : 503, result);
          }
        }
      ],

      subscriptions: [
        {
          topic: 'mesh:topology',
          interval: 10000,
          collect: async () => {
            const client = await getClient(ctx);
            if (client.inCooldown) return null;
            try {
              const [nodesResp, topoResp] = await Promise.all([
                client.fetch<{ get_cfg_clientlist: unknown[] }>('get_cfg_clientlist()'),
                client.fetch<{ get_allclientlist: unknown }>('get_allclientlist()')
              ]);
              return { nodes: nodesResp, topology: topoResp };
            } catch { return null; }
          }
        }
      ]
    };
  }
};

export default plugin;
