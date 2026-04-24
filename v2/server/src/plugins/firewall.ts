/**
 * Firewall plugin — zones, rules, ipsets, port forwards, conntrack.
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

const plugin: Plugin = {
  manifest: { name: 'firewall', version: '1.0.0', description: 'Firewall zones, rules, port forwards, conntrack' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/firewall/zones',
          handler: async (_req, res) => {
            const zones = await ctx.uci.sections('firewall', 'zone');
            sendJson(res, 200, zones);
          }
        },
        {
          method: 'GET', path: '/api/firewall/rules',
          handler: async (_req, res) => {
            const rules = await ctx.uci.sections('firewall', 'rule');
            sendJson(res, 200, rules);
          }
        },
        {
          method: 'GET', path: '/api/firewall/redirects',
          handler: async (_req, res) => {
            const redirects = await ctx.uci.sections('firewall', 'redirect');
            sendJson(res, 200, redirects);
          }
        },
        {
          method: 'GET', path: '/api/firewall/ipsets',
          handler: async (_req, res) => {
            const ipsets = await ctx.uci.sections('firewall', 'ipset');
            sendJson(res, 200, ipsets);
          }
        },
        {
          method: 'GET', path: '/api/firewall/forwards',
          handler: async (_req, res) => {
            const fwds = await ctx.uci.sections('firewall', 'forwarding');
            sendJson(res, 200, fwds);
          }
        },
        {
          method: 'GET', path: '/api/firewall/defaults',
          handler: async (_req, res) => {
            const defs = await ctx.uci.sections('firewall', 'defaults');
            sendJson(res, 200, defs[0] ?? {});
          }
        },
        {
          method: 'GET', path: '/api/firewall/conntrack',
          handler: async (_req, res) => {
            sendJson(res, 200, await getConntrack());
          }
        },
        {
          method: 'POST', path: '/api/firewall/rules',
          handler: async (req, res) => {
            const body = await readJson<Record<string, string | string[]>>(req);
            const sid = await ctx.uci.addSection('firewall', 'rule');
            for (const [key, val] of Object.entries(body)) {
              if (val) await ctx.uci.set('firewall', sid, key, val);
            }
            sendJson(res, 201, { section: sid });
          }
        },
        {
          method: 'DELETE', path: '/api/firewall/rules/:section',
          handler: async (_req, res, params) => {
            await ctx.uci.deleteSection('firewall', params.section);
            sendJson(res, 200, { status: 'ok' });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'firewall:conntrack',
          interval: 5000,
          collect: getConntrack
        }
      ]
    };
  }
};

export default plugin;
