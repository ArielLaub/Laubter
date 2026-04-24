/**
 * Traffic plugin — per-client bandwidth monitoring via nlbwmon.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const exec = promisify(execFile);

interface TrafficEntry {
  mac: string;
  ip: string;
  conns: number;
  rxBytes: number;
  rxPackets: number;
  txBytes: number;
  txPackets: number;
}

async function getTraffic(): Promise<TrafficEntry[]> {
  try {
    const { stdout } = await exec('nlbw', ['-c', 'json', '-g', 'mac,ip'], { timeout: 5000 });
    const data = JSON.parse(stdout);
    return (data.data ?? []).map((row: number[]) => ({
      mac: data.columns ? String(row[0]) : '',
      ip: String(row[1]),
      conns: row[2] ?? 0,
      rxBytes: row[3] ?? 0,
      rxPackets: row[4] ?? 0,
      txBytes: row[5] ?? 0,
      txPackets: row[6] ?? 0,
    }));
  } catch {
    return [];
  }
}

const plugin: Plugin = {
  manifest: { name: 'traffic', version: '1.0.0', description: 'Per-client bandwidth monitoring' },

  async setup(_ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/traffic/clients',
          handler: async (_req, res) => {
            sendJson(res, 200, await getTraffic());
          }
        }
      ],

      subscriptions: [
        {
          topic: 'traffic:clients',
          interval: 3000,
          collect: getTraffic
        }
      ]
    };
  }
};

export default plugin;
