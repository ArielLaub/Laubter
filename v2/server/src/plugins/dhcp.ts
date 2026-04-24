/**
 * DHCP plugin — full CRUD for leases, static hosts, DNS records, pool config, dnsmasq settings.
 */

import { readFile } from 'node:fs/promises';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

interface Lease {
  ts: number;
  mac: string;
  ip: string;
  hostname: string;
  clientId: string;
}

async function parseDhcpLeases(): Promise<Lease[]> {
  try {
    const raw = await readFile('/tmp/dhcp.leases', 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [ts, mac, ip, hostname, clientId] = line.split(' ');
      return { ts: parseInt(ts), mac, ip, hostname: hostname === '*' ? '' : hostname, clientId: clientId === '*' ? '' : clientId };
    });
  } catch {
    return [];
  }
}

/** Generic CRUD for a dhcp UCI section type */
function crudRoutes(sectionType: string, path: string, ctx: PluginContext) {
  return [
    {
      method: 'GET' as const, path,
      handler: async (_req: any, res: any) => {
        ctx.uci.invalidate('dhcp');
        const sections = await ctx.uci.sections('dhcp', sectionType);
        sendJson(res, 200, sections);
      }
    },
    {
      method: 'POST' as const, path,
      handler: async (req: any, res: any) => {
        const body = await readJson<Record<string, string | string[]>>(req);
        const sid = await ctx.uci.addSection('dhcp', sectionType);
        for (const [key, val] of Object.entries(body)) {
          if (val !== undefined && val !== '') await ctx.uci.set('dhcp', sid, key, val);
        }
        sendJson(res, 201, { section: sid });
      }
    },
    {
      method: 'PUT' as const, path: `${path}/:section`,
      handler: async (req: any, res: any, params: any) => {
        const body = await readJson<Record<string, string | string[]>>(req);
        for (const [key, val] of Object.entries(body)) {
          if (key.startsWith('.')) continue;
          await ctx.uci.set('dhcp', params.section, key, val !== undefined ? val : '');
        }
        sendJson(res, 200, { status: 'ok' });
      }
    },
    {
      method: 'DELETE' as const, path: `${path}/:section`,
      handler: async (_req: any, res: any, params: any) => {
        await ctx.uci.deleteSection('dhcp', params.section);
        sendJson(res, 200, { status: 'ok' });
      }
    }
  ];
}

const plugin: Plugin = {
  manifest: { name: 'dhcp', version: '2.0.0', description: 'DHCP leases, static hosts, DNS records, pool config' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        // Active leases
        {
          method: 'GET', path: '/api/dhcp/leases',
          handler: async (_req, res) => sendJson(res, 200, await parseDhcpLeases())
        },

        // CRUD for hosts, domains
        ...crudRoutes('host', '/api/dhcp/hosts', ctx),
        ...crudRoutes('domain', '/api/dhcp/domains', ctx),

        // DHCP pools (per-interface)
        {
          method: 'GET', path: '/api/dhcp/pools',
          handler: async (_req, res) => {
            ctx.uci.invalidate('dhcp');
            const pools = await ctx.uci.sections('dhcp', 'dhcp');
            sendJson(res, 200, pools);
          }
        },
        {
          method: 'PUT', path: '/api/dhcp/pools/:section',
          handler: async (req, res, params) => {
            const body = await readJson<Record<string, string | string[]>>(req);
            for (const [key, val] of Object.entries(body)) {
              if (!key.startsWith('.') && val !== undefined) await ctx.uci.set('dhcp', params.section, key, val);
            }
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // dnsmasq global config
        {
          method: 'GET', path: '/api/dhcp/dnsmasq',
          handler: async (_req, res) => {
            ctx.uci.invalidate('dhcp');
            const sections = await ctx.uci.sections('dhcp', 'dnsmasq');
            sendJson(res, 200, sections[0] ?? {});
          }
        },
        {
          method: 'PUT', path: '/api/dhcp/dnsmasq',
          handler: async (req, res) => {
            const body = await readJson<Record<string, string>>(req);
            const sections = await ctx.uci.sections('dhcp', 'dnsmasq');
            if (sections[0]) {
              const sid = sections[0]['.name'] as string;
              for (const [key, val] of Object.entries(body)) {
                if (!key.startsWith('.')) await ctx.uci.set('dhcp', sid, key, val);
              }
            }
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // odhcpd config
        {
          method: 'GET', path: '/api/dhcp/odhcpd',
          handler: async (_req, res) => {
            ctx.uci.invalidate('dhcp');
            const sections = await ctx.uci.sections('dhcp', 'odhcpd');
            sendJson(res, 200, sections[0] ?? {});
          }
        },

        // Apply: restart dnsmasq + odhcpd
        {
          method: 'POST', path: '/api/dhcp/apply',
          handler: async (_req, res) => {
            try {
              await ctx.ubus.call('rc', 'init', { name: 'dnsmasq', action: 'restart' });
              await ctx.ubus.call('rc', 'init', { name: 'odhcpd', action: 'restart' });
              sendJson(res, 200, { status: 'ok' });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        },

        // Revert
        {
          method: 'POST', path: '/api/dhcp/revert',
          handler: async (_req, res) => {
            ctx.uci.invalidate('dhcp');
            sendJson(res, 200, { status: 'ok' });
          }
        }
      ],

      subscriptions: [
        { topic: 'dhcp:leases', interval: 10000, collect: parseDhcpLeases }
      ]
    };
  }
};

export default plugin;
