/**
 * Wireless plugin — WiFi radios, associated clients, signal info.
 */

import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const plugin: Plugin = {
  manifest: { name: 'wireless', version: '1.0.0', description: 'WiFi radios, clients, signal' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    // Discover available radios
    let radioDevices: string[] = [];
    try {
      const devices = await ctx.ubus.call<{ devices: string[] }>('iwinfo', 'devices', {});
      radioDevices = devices.devices ?? [];
    } catch { /* iwinfo not available */ }

    return {
      routes: [
        {
          method: 'GET', path: '/api/wireless/radios',
          handler: async (_req, res) => {
            const radios = await ctx.uci.sections('wireless', 'wifi-device');
            sendJson(res, 200, radios);
          }
        },
        {
          method: 'GET', path: '/api/wireless/interfaces',
          handler: async (_req, res) => {
            const ifaces = await ctx.uci.sections('wireless', 'wifi-iface');
            sendJson(res, 200, ifaces);
          }
        },
        {
          method: 'GET', path: '/api/wireless/status',
          handler: async (_req, res) => {
            const status = await ctx.ubus.call<Record<string, unknown>>('network.wireless', 'status', {});
            sendJson(res, 200, status);
          }
        },
        {
          method: 'GET', path: '/api/wireless/clients',
          handler: async (_req, res) => {
            // Collect clients from all hostapd instances
            const clients: Record<string, unknown> = {};
            const ubusList = await ctx.ubus.list();
            const hostapdObjects = ubusList.filter(n => n.startsWith('hostapd.'));
            for (const obj of hostapdObjects) {
              try {
                const data = await ctx.ubus.call<{ clients: Record<string, unknown> }>(obj, 'get_clients', {});
                const iface = obj.replace('hostapd.', '');
                clients[iface] = data.clients ?? {};
              } catch { /* skip */ }
            }
            sendJson(res, 200, clients);
          }
        },
        {
          method: 'GET', path: '/api/wireless/scan/:device',
          handler: async (_req, res, params) => {
            try {
              const result = await ctx.ubus.call<{ results: unknown[] }>('iwinfo', 'scan', { device: params.device });
              sendJson(res, 200, result.results ?? []);
            } catch (e) {
              sendJson(res, 500, { error: String(e) });
            }
          }
        }
      ],

      subscriptions: [
        {
          topic: 'wireless:clients',
          interval: 5000,
          collect: async () => {
            const clients: Record<string, unknown> = {};
            const ubusList = await ctx.ubus.list();
            for (const obj of ubusList.filter(n => n.startsWith('hostapd.'))) {
              try {
                const data = await ctx.ubus.call<{ clients: Record<string, unknown> }>(obj, 'get_clients', {});
                clients[obj.replace('hostapd.', '')] = data.clients ?? {};
              } catch { /* skip */ }
            }
            return clients;
          }
        }
      ]
    };
  }
};

export default plugin;
