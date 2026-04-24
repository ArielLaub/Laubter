/**
 * VPN plugin — WireGuard tunnels and peers.
 */

import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const plugin: Plugin = {
  manifest: { name: 'vpn', version: '1.0.0', description: 'WireGuard VPN management' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/vpn/interfaces',
          handler: async (_req, res) => {
            const ifaces = await ctx.uci.sections('network', 'interface');
            const wg = ifaces.filter(i => i.proto === 'wireguard');
            sendJson(res, 200, wg);
          }
        },
        {
          method: 'GET', path: '/api/vpn/peers',
          handler: async (_req, res) => {
            const sections = await ctx.uci.sections('network');
            const peers = sections.filter(s => s['.type'].startsWith('wireguard_'));
            sendJson(res, 200, peers);
          }
        },
        {
          method: 'GET', path: '/api/vpn/status',
          handler: async (_req, res) => {
            try {
              const status = await ctx.ubus.call<Record<string, unknown>>('network.interface.wg0', 'status', {});
              sendJson(res, 200, status);
            } catch {
              sendJson(res, 200, { up: false });
            }
          }
        }
      ]
    };
  }
};

export default plugin;
