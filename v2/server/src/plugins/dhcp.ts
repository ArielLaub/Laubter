/**
 * DHCP plugin — leases, static hosts, DNS config.
 */

import { readFile } from 'node:fs/promises';
import { sendJson } from '../core/router.js';
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

const plugin: Plugin = {
  manifest: { name: 'dhcp', version: '1.0.0', description: 'DHCP leases, static hosts' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/dhcp/leases',
          handler: async (_req, res) => {
            const leases = await parseDhcpLeases();
            sendJson(res, 200, leases);
          }
        },
        {
          method: 'GET', path: '/api/dhcp/hosts',
          handler: async (_req, res) => {
            const sections = await ctx.uci.sections('dhcp', 'host');
            const hosts = sections.map(s => ({
              name: s.name ?? '',
              mac: Array.isArray(s.mac) ? s.mac[0] : s.mac ?? '',
              ip: s.ip ?? '',
              section: s['.name']
            }));
            sendJson(res, 200, hosts);
          }
        },
        {
          method: 'GET', path: '/api/dhcp/config',
          handler: async (_req, res) => {
            const dnsmasq = await ctx.uci.sections('dhcp', 'dnsmasq');
            const dhcpSections = await ctx.uci.sections('dhcp', 'dhcp');
            sendJson(res, 200, { dnsmasq: dnsmasq[0] ?? {}, pools: dhcpSections });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'dhcp:leases',
          interval: 10000,
          collect: parseDhcpLeases
        }
      ]
    };
  }
};

export default plugin;
