<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import uPlot from 'uplot';
  import { Cpu, HardDrive, Activity, Wifi } from 'lucide-svelte';

  // Live metrics
  const metrics = subscribe<{
    cpu: number;
    memory: { total: number; used: number; percent: number };
    uptime: number;
    load: number[];
  }>('system:metrics');

  // History buffers
  const MAX = 120; // 4 minutes at 2s intervals
  let cpuBuf: number[] = [];
  let memBuf: number[] = [];
  let loadBuf: number[] = [];
  let timeBuf: number[] = [];

  let cpuHistory = $state<number[]>([]);
  let memHistory = $state<number[]>([]);

  // Charts
  let cpuChartEl = $state<HTMLDivElement | null>(null);
  let memChartEl = $state<HTMLDivElement | null>(null);
  let loadChartEl = $state<HTMLDivElement | null>(null);
  let cpuChart: uPlot | null = null;
  let memChart: uPlot | null = null;
  let loadChart: uPlot | null = null;

  let lastMetricTs = 0;

  $effect(() => {
    const m = $metrics;
    if (!m) return;
    const now = Date.now() / 1000;
    if (now - lastMetricTs < 1) return;
    lastMetricTs = now;

    timeBuf.push(now);
    cpuBuf.push(m.cpu);
    memBuf.push(m.memory.percent);
    loadBuf.push(m.load[0]);

    if (timeBuf.length > MAX) {
      timeBuf = timeBuf.slice(-MAX);
      cpuBuf = cpuBuf.slice(-MAX);
      memBuf = memBuf.slice(-MAX);
      loadBuf = loadBuf.slice(-MAX);
    }

    cpuHistory = [...cpuBuf];
    memHistory = [...memBuf];

    if (cpuChart) cpuChart.setData([new Float64Array(timeBuf), new Float64Array(cpuBuf)]);
    if (memChart) memChart.setData([new Float64Array(timeBuf), new Float64Array(memBuf)]);
    if (loadChart) loadChart.setData([new Float64Array(timeBuf), new Float64Array(loadBuf)]);
  });

  function makeOpts(el: HTMLDivElement, label: string, color: string, unit: string, max?: number): uPlot.Options {
    return {
      width: el.clientWidth,
      height: 160,
      cursor: { show: true },
      legend: { show: false },
      axes: [
        { show: false },
        {
          stroke: '#8b949e', size: 45,
          grid: { stroke: 'rgba(255,255,255,0.04)', width: 1 },
          ticks: { show: false },
          values: (_u: uPlot, vals: number[]) => vals.map(v => `${v.toFixed(0)}${unit}`),
          font: '10px monospace',
        }
      ],
      scales: { x: { time: false }, y: { min: 0, max } },
      series: [
        {},
        { label, stroke: color, fill: `${color}15`, width: 2 }
      ]
    };
  }

  onMount(async () => {
    await tick();
    if (cpuChartEl) cpuChart = new uPlot(makeOpts(cpuChartEl, 'CPU', '#006fff', '%', 100), [new Float64Array(0), new Float64Array(0)], cpuChartEl);
    if (memChartEl) memChart = new uPlot(makeOpts(memChartEl, 'Memory', '#a78bfa', '%', 100), [new Float64Array(0), new Float64Array(0)], memChartEl);
    if (loadChartEl) loadChart = new uPlot(makeOpts(loadChartEl, 'Load', '#22c55e', '', undefined), [new Float64Array(0), new Float64Array(0)], loadChartEl);
  });
</script>

<svelte:head>
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.31/dist/uPlot.min.css" />
</svelte:head>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-white">Statistics</h1>
    <p class="text-sm text-[#8b949e]">Real-time system metrics</p>
  </div>

  <!-- Live values row -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#006fff]">{$metrics?.cpu ?? 0}%</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><Cpu size={12} /> CPU</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#a78bfa]">{$metrics?.memory?.percent ?? 0}%</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><HardDrive size={12} /> Memory</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#22c55e]">{$metrics?.load?.[0]?.toFixed(2) ?? '0'}</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><Activity size={12} /> Load</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-white">{cpuHistory.length}</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1">Samples</div>
    </div>
  </div>

  <!-- CPU chart -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><Cpu size={15} /> CPU Usage</div>
    <div bind:this={cpuChartEl}></div>
  </div>

  <!-- Memory chart -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><HardDrive size={15} /> Memory Usage</div>
    <div bind:this={memChartEl}></div>
  </div>

  <!-- Load chart -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><Activity size={15} /> System Load</div>
    <div bind:this={loadChartEl}></div>
  </div>
</div>
