<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import uPlot from 'uplot';
  import { Cpu, HardDrive, Activity } from 'lucide-svelte';

  function formatRate(bytesPerSec: number): string {
    if (bytesPerSec >= 1e6) return (bytesPerSec / 1e6).toFixed(1) + ' MB/s';
    if (bytesPerSec >= 1e3) return (bytesPerSec / 1e3).toFixed(0) + ' KB/s';
    return bytesPerSec.toFixed(0) + ' B/s';
  }

  function fmtRateVal(b: number): string {
    if (b >= 1e6) return (b / 1e6).toFixed(1);
    if (b >= 1e3) return (b / 1e3).toFixed(0);
    return b.toFixed(0);
  }

  function fmtRateUnit(b: number): string {
    if (b >= 1e6) return 'MB/s';
    if (b >= 1e3) return 'KB/s';
    return 'B/s';
  }

  // Live metrics
  const metrics = subscribe<{
    cpu: number;
    memory: { total: number; used: number; percent: number };
    uptime: number;
    load: number[];
    rxRate: number;
    txRate: number;
    temp: number;
    conns: number;
  }>('system:metrics');

  // Time range
  let timeRange = $state(600); // seconds: 600=10min, 3600=1h, 21600=6h, 86400=24h
  const ranges = [
    { value: 600, label: '10m' },
    { value: 3600, label: '1H' },
    { value: 21600, label: '6H' },
    { value: 86400, label: '24H' },
  ];

  // History buffers
  const MAX = 600;
  let cpuBuf: number[] = [];
  let memBuf: number[] = [];
  let rxBuf: number[] = [];
  let txBuf: number[] = [];
  let tempBuf: number[] = [];
  let connsBuf: number[] = [];
  let timeBuf: number[] = [];

  let cpuHistory = $state<number[]>([]);
  let memHistory = $state<number[]>([]);

  // Charts
  let cpuChartEl = $state<HTMLDivElement | null>(null);
  let memChartEl = $state<HTMLDivElement | null>(null);
  let tempChartEl = $state<HTMLDivElement | null>(null);
  let connsChartEl = $state<HTMLDivElement | null>(null);
  let netChartEl = $state<HTMLDivElement | null>(null);
  let cpuChart: uPlot | null = null;
  let memChart: uPlot | null = null;
  let tempChart: uPlot | null = null;
  let connsChart: uPlot | null = null;
  let netChart: uPlot | null = null;

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
    rxBuf.push(m.rxRate ?? 0);
    txBuf.push(m.txRate ?? 0);
    tempBuf.push(m.temp ?? 0);
    connsBuf.push(m.conns ?? 0);

    if (timeBuf.length > MAX) {
      timeBuf = timeBuf.slice(-MAX);
      cpuBuf = cpuBuf.slice(-MAX);
      memBuf = memBuf.slice(-MAX);
      rxBuf = rxBuf.slice(-MAX);
      txBuf = txBuf.slice(-MAX);
      tempBuf = tempBuf.slice(-MAX);
      connsBuf = connsBuf.slice(-MAX);
    }

    cpuHistory = [...cpuBuf];
    memHistory = [...memBuf];

    if (cpuChart) cpuChart.setData([new Float64Array(timeBuf), new Float64Array(cpuBuf)]);
    if (memChart) memChart.setData([new Float64Array(timeBuf), new Float64Array(memBuf)]);
    if (tempChart) tempChart.setData([new Float64Array(timeBuf), new Float64Array(tempBuf)]);
    if (connsChart) connsChart.setData([new Float64Array(timeBuf), new Float64Array(connsBuf)]);
    if (netChart) netChart.setData([new Float64Array(timeBuf), new Float64Array(rxBuf), new Float64Array(txBuf)]);
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

  async function loadHistory() {
    try {
      const hist = await api<{ ts: number; cpu: number; memPercent: number; rxRate: number; txRate: number; temp: number; conns: number }[]>(`/api/system/history?range=${timeRange}&points=400`);
      if (hist.length > 0) {
        timeBuf = hist.map(h => h.ts);
        cpuBuf = hist.map(h => h.cpu);
        memBuf = hist.map(h => h.memPercent);
        rxBuf = hist.map(h => h.rxRate ?? 0);
        txBuf = hist.map(h => h.txRate ?? 0);
        tempBuf = hist.map(h => h.temp ?? 0);
        connsBuf = hist.map(h => h.conns ?? 0);
        cpuHistory = [...cpuBuf];
        memHistory = [...memBuf];
        // Update existing charts
        if (cpuChart) cpuChart.setData([new Float64Array(timeBuf), new Float64Array(cpuBuf)]);
        if (memChart) memChart.setData([new Float64Array(timeBuf), new Float64Array(memBuf)]);
        if (tempChart) tempChart.setData([new Float64Array(timeBuf), new Float64Array(tempBuf)]);
        if (connsChart) connsChart.setData([new Float64Array(timeBuf), new Float64Array(connsBuf)]);
        if (netChart) netChart.setData([new Float64Array(timeBuf), new Float64Array(rxBuf), new Float64Array(txBuf)]);
      }
    } catch {}
  }

  async function changeRange(r: number) {
    timeRange = r;
    await loadHistory();
  }

  onMount(async () => {
    // Load history from server (pre-collected while page was closed)
    try {
      const hist = await api<{ ts: number; cpu: number; memPercent: number; rxRate: number; txRate: number; temp: number; conns: number }[]>(`/api/system/history?range=${timeRange}&points=400`);
      if (hist.length > 0) {
        timeBuf = hist.map(h => h.ts);
        cpuBuf = hist.map(h => h.cpu);
        memBuf = hist.map(h => h.memPercent);
        rxBuf = hist.map(h => h.rxRate ?? 0);
        txBuf = hist.map(h => h.txRate ?? 0);
        tempBuf = hist.map(h => h.temp ?? 0);
        connsBuf = hist.map(h => h.conns ?? 0);
        cpuHistory = [...cpuBuf];
        memHistory = [...memBuf];
      }
    } catch { /* no history available */ }

    // Wait for DOM layout to settle
    await tick();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    if (cpuChartEl) cpuChart = new uPlot(makeOpts(cpuChartEl, 'CPU', '#006fff', '%', 100), [new Float64Array(timeBuf), new Float64Array(cpuBuf)], cpuChartEl);
    if (memChartEl) memChart = new uPlot(makeOpts(memChartEl, 'Memory', '#a78bfa', '%', 100), [new Float64Array(timeBuf), new Float64Array(memBuf)], memChartEl);
    if (tempChartEl) tempChart = new uPlot(makeOpts(tempChartEl, 'Temp', '#f59e0b', '°C', undefined), [new Float64Array(timeBuf), new Float64Array(tempBuf)], tempChartEl);
    if (connsChartEl) connsChart = new uPlot(makeOpts(connsChartEl, 'Conns', '#06b6d4', '', undefined), [new Float64Array(timeBuf), new Float64Array(connsBuf)], connsChartEl);
    if (netChartEl) {
      const netOpts: uPlot.Options = {
        width: netChartEl.clientWidth, height: 160,
        cursor: { show: true }, legend: { show: false },
        axes: [
          { show: false },
          {
            stroke: '#8b949e', size: 55,
            grid: { stroke: 'rgba(255,255,255,0.04)', width: 1 },
            ticks: { show: false },
            values: (_u: uPlot, vals: number[]) => vals.map(v => {
              if (v >= 1e6) return (v / 1e6).toFixed(1) + ' MB/s';
              if (v >= 1e3) return (v / 1e3).toFixed(0) + ' KB/s';
              return v.toFixed(0) + ' B/s';
            }),
            font: '10px monospace',
          }
        ],
        scales: { x: { time: false }, y: { min: 0 } },
        series: [
          {},
          { label: 'Download', stroke: '#58a6ff', fill: 'rgba(88,166,255,0.1)', width: 2 },
          { label: 'Upload', stroke: '#22c55e', fill: 'rgba(34,197,94,0.1)', width: 2 }
        ]
      };
      netChart = new uPlot(netOpts, [new Float64Array(timeBuf), new Float64Array(rxBuf), new Float64Array(txBuf)], netChartEl);
    }

    // Resize charts when container changes (responsive)
    const ro = new ResizeObserver(() => {
      const pairs: [HTMLDivElement | null, uPlot | null][] = [
        [cpuChartEl, cpuChart], [memChartEl, memChart],
        [tempChartEl, tempChart], [connsChartEl, connsChart], [netChartEl, netChart]
      ];
      for (const [el, chart] of pairs) {
        if (el && chart) {
          const w = el.clientWidth;
          if (w > 0 && Math.abs(w - chart.width) > 10) {
            chart.setSize({ width: w, height: 160 });
          }
        }
      }
    });

    const els = [cpuChartEl, memChartEl, tempChartEl, connsChartEl, netChartEl];
    for (const el of els) {
      if (el?.parentElement) ro.observe(el.parentElement);
    }

    return () => ro.disconnect();
  });
</script>

<svelte:head>
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.31/dist/uPlot.min.css" />
</svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-white">Statistics</h1>
      <p class="text-sm text-[#8b949e]">Real-time system metrics</p>
    </div>
    <div class="flex gap-0 rounded-lg overflow-hidden border border-[var(--color-surface-500)]">
      {#each ranges as r}
        <button class="px-3 py-1.5 text-xs font-semibold transition-colors
          {timeRange === r.value ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-700)] text-[#8b949e] hover:text-white'}"
          onclick={() => changeRange(r.value)}>{r.label}</button>
      {/each}
    </div>
  </div>

  <!-- Live values row -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#006fff]">{$metrics?.cpu ?? 0}%</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><Cpu size={12} /> CPU</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#a78bfa]">{$metrics?.memory?.percent ?? 0}%</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><HardDrive size={12} /> Memory</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#58a6ff]">{fmtRateVal($metrics?.rxRate ?? 0)}</div>
      <div class="text-[10px] text-[#58a6ff]/60 font-mono">{fmtRateUnit($metrics?.rxRate ?? 0)}</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><Activity size={12} /> Download</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-[#22c55e]">{fmtRateVal($metrics?.txRate ?? 0)}</div>
      <div class="text-[10px] text-[#22c55e]/60 font-mono">{fmtRateUnit($metrics?.txRate ?? 0)}</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1 flex items-center justify-center gap-1"><Activity size={12} /> Upload</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono {($metrics?.temp ?? 0) > 70 ? 'text-[#ef4444]' : ($metrics?.temp ?? 0) > 55 ? 'text-[#f59e0b]' : 'text-[#22c55e]'}">{$metrics?.temp?.toFixed(1) ?? '0'}&deg;</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1">Temperature</div>
    </div>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 text-center">
      <div class="text-3xl font-extrabold font-mono text-white">{($metrics?.conns ?? 0).toLocaleString()}</div>
      <div class="text-[11px] text-[#8b949e] uppercase mt-1">Connections</div>
    </div>
  </div>

  <!-- Charts: 2 per row on desktop -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><Cpu size={15} /> CPU Usage</div>
      <div bind:this={cpuChartEl}></div>
    </div>

    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><HardDrive size={15} /> Memory Usage</div>
      <div bind:this={memChartEl}></div>
    </div>
  </div>

  <!-- Temperature + Connections + Network -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>
        Temperature
      </div>
      <div bind:this={tempChartEl}></div>
    </div>

    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3"><Activity size={15} /> Connections</div>
      <div bind:this={connsChartEl}></div>
    </div>

    <!-- Network throughput chart -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-sm text-[#8b949e]"><Activity size={15} /> Network Throughput</div>
        <div class="flex items-center gap-4 text-[10px]">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#58a6ff]"></span> Download</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#22c55e]"></span> Upload</span>
        </div>
      </div>
      <div bind:this={netChartEl}></div>
    </div>
  </div>
</div>
