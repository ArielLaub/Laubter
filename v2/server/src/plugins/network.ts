/**
 * Network plugin — interfaces, devices, routes, connectivity.
 */

import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const plugin: Plugin = {
  manifest: { name: 'network', version: '1.0.0', description: 'Network interfaces, devices, routes' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/network/interfaces',
          handler: async (_req, res) => {
            const dump = await ctx.ubus.call<{ interface: unknown[] }>('network.interface', 'dump', {});
            sendJson(res, 200, dump.interface ?? []);
          }
        },
        {
          method: 'GET', path: '/api/network/devices',
          handler: async (_req, res) => {
            const status = await ctx.ubus.call<Record<string, unknown>>('network.device', 'status', {});
            sendJson(res, 200, status);
          }
        },
        {
          method: 'GET', path: '/api/network/wireless',
          handler: async (_req, res) => {
            const status = await ctx.ubus.call<Record<string, unknown>>('network.wireless', 'status', {});
            sendJson(res, 200, status);
          }
        },
        {
          method: 'POST', path: '/api/network/restart',
          handler: async (_req, res) => {
            await ctx.ubus.call('network', 'restart', {});
            sendJson(res, 200, { status: 'ok' });
          }
        },
        {
          method: 'POST', path: '/api/network/interface/:name/up',
          handler: async (_req, res, params) => {
            await ctx.ubus.call(`network.interface.${params.name}`, 'up', {});
            sendJson(res, 200, { status: 'ok' });
          }
        },
        {
          method: 'POST', path: '/api/network/interface/:name/down',
          handler: async (_req, res, params) => {
            await ctx.ubus.call(`network.interface.${params.name}`, 'down', {});
            sendJson(res, 200, { status: 'ok' });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'network:status',
          interval: 5000,
          collect: async () => {
            const dump = await ctx.ubus.call<{ interface: unknown[] }>('network.interface', 'dump', {});
            return dump.interface ?? [];
          }
        }
      ]
    };
  }
};

export default plugin;
