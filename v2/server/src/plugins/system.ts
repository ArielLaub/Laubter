/**
 * System plugin — board info, CPU, memory, load, uptime.
 * Keeps in-memory history ring buffer for instant chart seeding.
 */

import { readFile } from 'node:fs/promises';
import { sendJson } from '../core/router.js';
import type { Plugin, PluginContext, PluginRegistration } from '../types/plugin.js';

interface CpuSample {
  user: number; nice: number; system: number; idle: number;
  iowait: number; irq: number; softirq: number;
}

interface MetricPoint {
  ts: number;
  cpu: number;
  memPercent: number;
  rxRate: number;
  txRate: number;
  temp: number;
  conns: number;
  uptime: number;
}

// Network byte counters for rate calculation
let prevRxBytes = 0;
let prevTxBytes = 0;
let prevNetTs = 0;

async function getTemperature(): Promise<number> {
  try {
    // Try thermal zones
    const temp = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
    return parseInt(temp.trim()) / 1000; // millidegrees to degrees
  } catch {
    return 0;
  }
}

async function getConntrack(): Promise<number> {
  try {
    const count = await readFile('/proc/sys/net/netfilter/nf_conntrack_count', 'utf-8');
    return parseInt(count.trim());
  } catch {
    return 0;
  }
}

async function getNetBytes(): Promise<{ rx: number; tx: number }> {
  try {
    // Read WAN interface (eth1) or fallback to br-lan
    const rx = parseInt(await readFile('/sys/class/net/eth1/statistics/rx_bytes', 'utf-8').catch(() => readFile('/sys/class/net/br-lan/statistics/rx_bytes', 'utf-8')));
    const tx = parseInt(await readFile('/sys/class/net/eth1/statistics/tx_bytes', 'utf-8').catch(() => readFile('/sys/class/net/br-lan/statistics/tx_bytes', 'utf-8')));
    return { rx: rx || 0, tx: tx || 0 };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

let prevCpu: CpuSample | null = null;

// Ring buffer: keeps last 43200 samples (24h at 2s intervals)
const HISTORY_MAX = 43200;
const history: MetricPoint[] = [];

async function readCpuSample(): Promise<CpuSample> {
  const stat = await readFile('/proc/stat', 'utf-8');
  const line = stat.split('\n')[0];
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

async function getMemory() {
  const meminfo = await readFile('/proc/meminfo', 'utf-8');
  const get = (key: string): number => {
    const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
    return match ? parseInt(match[1]) * 1024 : 0;
  };
  const total = get('MemTotal');
  const available = get('MemAvailable') || get('MemFree');
  const used = total - available;
  return { total, used, free: total - used, available, percent: Math.round((used / total) * 100) };
}

async function getUptime() {
  const raw = await readFile('/proc/uptime', 'utf-8');
  const [up, idle] = raw.trim().split(' ').map(Number);
  return { uptime: Math.floor(up), idle: Math.floor(idle) };
}

async function getLoadAvg(): Promise<number[]> {
  const raw = await readFile('/proc/loadavg', 'utf-8');
  return raw.trim().split(' ').slice(0, 3).map(Number);
}

async function collectMetrics() {
  const [mem, uptime, load, net, temp, conns] = await Promise.all([getMemory(), getUptime(), getLoadAvg(), getNetBytes(), getTemperature(), getConntrack()]);
  const cpu = await readCpuSample();
  const usage = prevCpu ? cpuUsage(prevCpu, cpu) : 0;
  prevCpu = cpu;

  const now = Date.now() / 1000;
  let rxRate = 0, txRate = 0;
  if (prevNetTs > 0 && prevRxBytes > 0) {
    const dt = now - prevNetTs;
    if (dt > 0 && dt < 30) {
      rxRate = Math.max(0, (net.rx - prevRxBytes) / dt);
      txRate = Math.max(0, (net.tx - prevTxBytes) / dt);
    }
  }
  prevRxBytes = net.rx;
  prevTxBytes = net.tx;
  prevNetTs = now;

  const point: MetricPoint = {
    ts: now,
    cpu: usage,
    memPercent: mem.percent,
    rxRate,
    txRate,
    temp,
    conns,
    uptime: uptime.uptime
  };

  history.push(point);
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);

  return { cpu: usage, memory: mem, uptime: uptime.uptime, load, rxRate, txRate, temp, conns };
}

const plugin: Plugin = {
  manifest: { name: 'system', version: '2.0.0', description: 'Board info, CPU, memory, load, uptime with history' },

  async setup(ctx: PluginContext): Promise<PluginRegistration> {
    return {
      routes: [
        {
          method: 'GET', path: '/api/system/board',
          handler: async (_req, res) => {
            const board = await ctx.ubus.call<Record<string, unknown>>('system', 'board', {});
            sendJson(res, 200, board);
          }
        },
        {
          method: 'GET', path: '/api/system/info',
          handler: async (_req, res) => sendJson(res, 200, await collectMetrics())
        },
        {
          method: 'GET', path: '/api/system/history',
          handler: async (req, res) => {
            const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
            const range = parseInt(url.searchParams.get('range') ?? '600'); // seconds, default 10min
            const maxPoints = parseInt(url.searchParams.get('points') ?? '300');

            const cutoff = Date.now() / 1000 - range;
            let data = history.filter(p => p.ts >= cutoff);

            // Downsample if too many points
            if (data.length > maxPoints) {
              const step = Math.ceil(data.length / maxPoints);
              data = data.filter((_, i) => i % step === 0);
            }

            sendJson(res, 200, data);
          }
        },
        {
          method: 'GET', path: '/api/system/log',
          handler: async (_req, res) => {
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const exec = promisify(execFile);
            try {
              const { stdout } = await exec('logread', [], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
              const lines = stdout.trim().split('\n').filter(Boolean);
              // Return last 500 lines
              sendJson(res, 200, lines.slice(-500));
            } catch {
              sendJson(res, 200, []);
            }
          }
        }
      ],

      subscriptions: [
        { topic: 'system:metrics', interval: 2000, collect: collectMetrics }
      ]
    };
  }
};

export default plugin;
