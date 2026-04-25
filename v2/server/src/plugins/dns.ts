/**
 * DNS plugin — AdGuard Home proxy for stats, filtering, query log, filter management.
 * Full feature parity with v1 laubter-adguard.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sendJson, readJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

const exec = promisify(execFile);
const AG_BASE = 'http://127.0.0.1:3080';

async function adguardGet(path: string): Promise<unknown> {
  try {
    const { stdout } = await exec('curl', ['-sf', `${AG_BASE}${path}`], { timeout: 5000 });
    return JSON.parse(stdout);
  } catch { return null; }
}

async function adguardPost(path: string, body: unknown): Promise<unknown> {
  try {
    const { stdout } = await exec('curl', [
      '-sf', '-X', 'POST', '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body), `${AG_BASE}${path}`
    ], { timeout: 5000 });
    return stdout ? JSON.parse(stdout) : { ok: true };
  } catch { return null; }
}

const plugin: Plugin = {
  manifest: { name: 'dns', version: '2.0.0', description: 'AdGuard Home DNS — stats, filters, query log, protection control' },

  async setup(_ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        { method: 'GET', path: '/api/dns/status', handler: async (_req, res) => sendJson(res, 200, await adguardGet('/control/status') ?? {}) },
        { method: 'GET', path: '/api/dns/stats', handler: async (_req, res) => sendJson(res, 200, await adguardGet('/control/stats') ?? {}) },
        { method: 'GET', path: '/api/dns/querylog', handler: async (_req, res) => sendJson(res, 200, await adguardGet('/control/querylog?limit=100') ?? { data: [] }) },
        { method: 'GET', path: '/api/dns/filtering', handler: async (_req, res) => sendJson(res, 200, await adguardGet('/control/filtering/status') ?? {}) },

        // Toggle protection
        {
          method: 'POST', path: '/api/dns/protection',
          handler: async (req, res) => {
            const body = await readJson<{ enabled: boolean }>(req);
            await adguardPost('/control/dns_config', { protection_enabled: body.enabled });
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // Toggle filtering
        {
          method: 'POST', path: '/api/dns/filtering/toggle',
          handler: async (req, res) => {
            const body = await readJson<{ enabled: boolean }>(req);
            await adguardPost('/control/filtering/config', { enabled: body.enabled, interval: 24 });
            sendJson(res, 200, { status: 'ok' });
          }
        },

        // Add filter
        {
          method: 'POST', path: '/api/dns/filters',
          handler: async (req, res) => {
            const body = await readJson<{ name: string; url: string }>(req);
            const result = await adguardPost('/control/filtering/add_url', { name: body.name, url: body.url, whitelist: false });
            sendJson(res, result ? 200 : 500, result ?? { error: 'Failed' });
          }
        },

        // Remove filter
        {
          method: 'DELETE', path: '/api/dns/filters',
          handler: async (req, res) => {
            const body = await readJson<{ url: string }>(req);
            const result = await adguardPost('/control/filtering/remove_url', { url: body.url, whitelist: false });
            sendJson(res, result ? 200 : 500, result ?? { error: 'Failed' });
          }
        },

        // Toggle individual filter
        {
          method: 'POST', path: '/api/dns/filters/toggle',
          handler: async (req, res) => {
            const body = await readJson<{ url: string; enabled: boolean }>(req);
            const data = { url: body.url, data: { enabled: body.enabled }, whitelist: false };
            const result = await adguardPost('/control/filtering/set_url', data);
            sendJson(res, result ? 200 : 500, result ?? { error: 'Failed' });
          }
        },

        // Query log config
        {
          method: 'GET', path: '/api/dns/querylog/config',
          handler: async (_req, res) => sendJson(res, 200, await adguardGet('/control/querylog/config') ?? {})
        },
        {
          method: 'PUT', path: '/api/dns/querylog/config',
          handler: async (req, res) => {
            const body = await readJson<Record<string, unknown>>(req);
            await adguardPost('/control/querylog/config/update', body);
            sendJson(res, 200, { status: 'ok' });
          }
        }
      ],

      subscriptions: [
        { topic: 'dns:stats', interval: 10000, collect: async () => await adguardGet('/control/stats') ?? {} }
      ]
    };
  }
};

export default plugin;
