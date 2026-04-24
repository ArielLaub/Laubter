/**
 * DNS plugin — AdGuard Home proxy for stats, filtering, query log.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const exec = promisify(execFile);

async function adguardGet(path: string): Promise<unknown> {
  try {
    const { stdout } = await exec('curl', [
      '-sf', `http://127.0.0.1:3080${path}`
    ], { timeout: 5000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const plugin: Plugin = {
  manifest: { name: 'dns', version: '1.0.0', description: 'AdGuard Home DNS stats and control' },

  async setup(_ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/dns/status',
          handler: async (_req, res) => {
            const status = await adguardGet('/control/status');
            sendJson(res, 200, status ?? { error: 'AdGuard not reachable' });
          }
        },
        {
          method: 'GET', path: '/api/dns/stats',
          handler: async (_req, res) => {
            const stats = await adguardGet('/control/stats');
            sendJson(res, 200, stats ?? {});
          }
        },
        {
          method: 'GET', path: '/api/dns/querylog',
          handler: async (_req, res) => {
            const log = await adguardGet('/control/querylog?limit=100');
            sendJson(res, 200, log ?? { data: [] });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'dns:stats',
          interval: 10000,
          collect: async () => await adguardGet('/control/stats') ?? {}
        }
      ]
    };
  }
};

export default plugin;
