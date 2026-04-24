/**
 * Firewall plugin — full CRUD for zones, rules, redirects, ipsets, NAT, defaults.
 * Includes apply/revert workflow via ubus.
 */

import { readFile } from 'node:fs/promises';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

async function getConntrack(): Promise<{ count: number; max: number }> {
  try {
    const [countRaw, maxRaw] = await Promise.all([
      readFile('/proc/sys/net/netfilter/nf_conntrack_count', 'utf-8'),
      readFile('/proc/sys/net/netfilter/nf_conntrack_max', 'utf-8')
    ]);
    return { count: parseInt(countRaw.trim()), max: parseInt(maxRaw.trim()) };
  } catch {
    return { count: 0, max: 0 };
  }
}

/** Generic CRUD route factory for a UCI section type */
function crudRoutes(sectionType: string, path: string, ctx: PluginContext) {
  return [
    {
      method: 'GET' as const, path,
      handler: async (_req: any, res: any) => {
        ctx.uci.invalidate('firewall');
        const sections = await ctx.uci.sections('firewall', sectionType);
        sendJson(res, 200, sections);
      }
    },
    {
      method: 'POST' as const, path,
      handler: async (req: any, res: any) => {
        const body = await readJson<Record<string, string | string[]>>(req);
        const sid = await ctx.uci.addSection('firewall', sectionType);
        for (const [key, val] of Object.entries(body)) {
          if (val !== undefined && val !== '') await ctx.uci.set('firewall', sid, key, val);
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
          await ctx.uci.set('firewall', params.section, key, val !== undefined ? val : '');
        }
        sendJson(res, 200, { status: 'ok' });
      }
    },
    {
      method: 'DELETE' as const, path: `${path}/:section`,
      handler: async (_req: any, res: any, params: any) => {
        await ctx.uci.deleteSection('firewall', params.section);
        sendJson(res, 200, { status: 'ok' });
      }
    }
  ];
}

const plugin: Plugin = {
  manifest: { name: 'firewall', version: '2.0.0', description: 'Firewall zones, rules, port forwards, IP sets, conntrack' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        // Conntrack
        { method: 'GET', path: '/api/firewall/conntrack', handler: async (_req, res) => sendJson(res, 200, await getConntrack()) },

        // Defaults (single section)
        {
          method: 'GET', path: '/api/firewall/defaults',
          handler: async (_req, res) => {
            ctx.uci.invalidate('firewall');
            const defs = await ctx.uci.sections('firewall', 'defaults');
            sendJson(res, 200, defs[0] ?? {});
          }
        },
        {
          method: 'PUT', path: '/api/firewall/defaults',
          handler: async (req, res) => {
            const body = await readJson<Record<string, string>>(req);
            const defs = await ctx.uci.sections('firewall', 'defaults');
            if (defs[0]) {
              for (const [key, val] of Object.entries(body)) {
                if (!key.startsWith('.')) await ctx.uci.set('firewall', defs[0]['.name'] as string, key, val);
              }
            }
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // Zone forwardings
        ...crudRoutes('forwarding', '/api/firewall/forwards', ctx),

        // CRUD for zones, rules, redirects, ipsets, nat
        ...crudRoutes('zone', '/api/firewall/zones', ctx),
        ...crudRoutes('rule', '/api/firewall/rules', ctx),
        ...crudRoutes('redirect', '/api/firewall/redirects', ctx),
        ...crudRoutes('ipset', '/api/firewall/ipsets', ctx),
        ...crudRoutes('nat', '/api/firewall/nat', ctx),

        // Apply: restart firewall service
        {
          method: 'POST', path: '/api/firewall/apply',
          handler: async (_req, res) => {
            try {
              await ctx.ubus.call('network', 'restart', {});
              sendJson(res, 200, { status: 'ok' });
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        },

        // Revert: reload config from disk
        {
          method: 'POST', path: '/api/firewall/revert',
          handler: async (_req, res) => {
            ctx.uci.invalidate('firewall');
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // DHCP hosts (for device picker in firewall forms)
        {
          method: 'GET', path: '/api/firewall/dhcp-hosts',
          handler: async (_req, res) => {
            ctx.uci.invalidate('dhcp');
            const hosts = await ctx.uci.sections('dhcp', 'host');
            sendJson(res, 200, hosts.map(h => ({
              name: h.name ?? '',
              ip: h.ip ?? '',
              mac: Array.isArray(h.mac) ? h.mac[0] : h.mac ?? ''
            })));
          }
        }
      ],

      subscriptions: [
        { topic: 'firewall:conntrack', interval: 5000, collect: getConntrack }
      ]
    };
  }
};

export default plugin;
