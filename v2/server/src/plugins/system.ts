/**
 * System plugin — board info, CPU, memory, load, uptime.
 *
 * Provides REST endpoints and a live WebSocket metrics stream.
 */

import { readFile } from 'node:fs/promises';
import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

interface CpuSample {
  user: number; nice: number; system: number; idle: number;
  iowait: number; irq: number; softirq: number;
}

let prevCpu: CpuSample | null = null;

async function readCpuSample(): Promise<CpuSample> {
  const stat = await readFile('/proc/stat', 'utf-8');
  const line = stat.split('\n')[0]; // cpu  user nice system idle ...
  const parts = line.split(/\s+/).slice(1).map(Number);
  return {
    user: parts[0], nice: parts[1], system: parts[2], idle: parts[3],
    iowait: parts[4] ?? 0, irq: parts[5] ?? 0, softirq: parts[6] ?? 0
  };
}

function cpuUsage(prev: CpuSample, curr: CpuSample): number {
  const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
  const currTotal = Object.values(curr).reduce((a, b) => a + b, 0);
  const totalDiff = currTotal - prevTotal;
  const idleDiff = curr.idle - prev.idle;
  if (totalDiff === 0) return 0;
  return Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

async function getMemory(): Promise<{ total: number; used: number; free: number; available: number; percent: number }> {
  const meminfo = await readFile('/proc/meminfo', 'utf-8');
  const get = (key: string): number => {
    const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
    return match ? parseInt(match[1]) * 1024 : 0; // KB to bytes
  };
  const total = get('MemTotal');
  const free = get('MemFree');
  const available = get('MemAvailable') || free;
  const used = total - available;
  return { total, used, free, available, percent: Math.round((used / total) * 100) };
}

async function getUptime(): Promise<{ uptime: number; idle: number }> {
  const raw = await readFile('/proc/uptime', 'utf-8');
  const [up, idle] = raw.trim().split(' ').map(Number);
  return { uptime: Math.floor(up), idle: Math.floor(idle) };
}

async function getLoadAvg(): Promise<number[]> {
  const raw = await readFile('/proc/loadavg', 'utf-8');
  return raw.trim().split(' ').slice(0, 3).map(Number);
}

const plugin: Plugin = {
  manifest: {
    name: 'system',
    version: '1.0.0',
    description: 'Board info, CPU, memory, load, uptime'
  },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET',
          path: '/api/system/board',
          handler: async (_req, res) => {
            const board = await ctx.ubus.call<Record<string, unknown>>('system', 'board', {});
            sendJson(res, 200, board);
          }
        },
        {
          method: 'GET',
          path: '/api/system/info',
          handler: async (_req, res) => {
            const [mem, uptime, load] = await Promise.all([
              getMemory(), getUptime(), getLoadAvg()
            ]);
            const cpu = await readCpuSample();
            const usage = prevCpu ? cpuUsage(prevCpu, cpu) : 0;
            prevCpu = cpu;
            sendJson(res, 200, { cpu: usage, memory: mem, uptime: uptime.uptime, load });
          }
        }
      ],

      subscriptions: [
        {
          topic: 'system:metrics',
          interval: 2000,
          collect: async () => {
            const [mem, uptime, load] = await Promise.all([
              getMemory(), getUptime(), getLoadAvg()
            ]);
            const cpu = await readCpuSample();
            const usage = prevCpu ? cpuUsage(prevCpu, cpu) : 0;
            prevCpu = cpu;
            return { cpu: usage, memory: mem, uptime: uptime.uptime, load };
          }
        }
      ]
    };
  }
};

export default plugin;
