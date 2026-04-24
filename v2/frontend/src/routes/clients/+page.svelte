<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Search, ArrowDown, ArrowUp, X, Activity } from 'lucide-svelte';
  import uPlot from 'uplot';

  interface Lease { ts: number; mac: string; ip: string; hostname: string; }
  interface Traffic { mac: string; ip: string; rxBytes: number; txBytes: number; conns: number; }

  let leases = $state<Lease[]>([]);
  let search = $state('');
  let sortCol = $state<'hostname' | 'ip' | 'rx' | 'tx'>('hostname');
  let sortAsc = $state(true);
  let selectedClient = $state<(Lease & { rx: number; tx: number; conns: number }) | null>(null);

  const trafficStream = subscribe<Traffic[]>('traffic:clients');
  const dhcpStream = subscribe<Lease[]>('dhcp:leases');

  // Traffic lookup
  const trafficMap = $derived.by(() => {
    const map = new Map<string, Traffic>();
    if ($trafficStream) {
      for (const t of $trafficStream) {
        if (t.mac) map.set(t.mac.toLowerCase(), t);
        if (t.ip) map.set(t.ip, t);
      }
    }
    return map;
  });

  // Merge leases + traffic
  const clients = $derived.by(() => {
    const src = $dhcpStream ?? leases;
    return src.map(l => {
      const t = trafficMap.get(l.mac?.toLowerCase()) ?? trafficMap.get(l.ip);
      return { ...l, rx: t?.rxBytes ?? 0, tx: t?.txBytes ?? 0, conns: t?.conns ?? 0 };
    });
  });

  const filtered = $derived.by(() => {
    let list = clients;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.hostname?.toLowerCase().includes(q) ||
        c.ip?.toLowerCase().includes(q) ||
        c.mac?.toLowerCase().includes(q)
      );
    }
    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case 'hostname': return dir * (a.hostname || a.mac).localeCompare(b.hostname || b.mac);
        case 'ip': return dir * (a.ip).localeCompare(b.ip, undefined, { numeric: true });
        case 'rx': return dir * (a.rx - b.rx);
        case 'tx': return dir * (a.tx - b.tx);
        default: return 0;
      }
    });
  });

  // --- Live bandwidth chart for selected client ---
  let chartEl = $state<HTMLDivElement | null>(null);
  let chart: uPlot | null = null;
  let rxHistory: number[] = [];
  let txHistory: number[] = [];
  let timeHistory: number[] = [];
  let prevRx = 0;
  let prevTx = 0;
  let lastSampleTime = 0;

  // Track traffic changes for the selected client
  $effect(() => {
    if (!selectedClient || !$trafficStream) return;
    const t = trafficMap.get(selectedClient.mac?.toLowerCase()) ?? trafficMap.get(selectedClient.ip);
    if (!t) return;

    const now = Date.now() / 1000;
    if (lastSampleTime > 0 && prevRx > 0) {
      const dt = now - lastSampleTime;
      if (dt > 0 && dt < 30) {
        const rxRate = Math.max(0, (t.rxBytes - prevRx) / dt);
        const txRate = Math.max(0, (t.txBytes - prevTx) / dt);
        timeHistory.push(now);
        rxHistory.push(rxRate);
        txHistory.push(txRate);
        // Keep last 60 samples
        if (timeHistory.length > 60) {
          timeHistory = timeHistory.slice(-60);
          rxHistory = rxHistory.slice(-60);
          txHistory = txHistory.slice(-60);
        }
        if (chart) {
          chart.setData([new Float64Array(timeHistory), new Float64Array(rxHistory), new Float64Array(txHistory)]);
        }
      }
    }
    prevRx = t.rxBytes;
    prevTx = t.txBytes;
    lastSampleTime = now;

    // Update selected client data
    selectedClient.rx = t.rxBytes;
    selectedClient.tx = t.txBytes;
    selectedClient.conns = t.conns;
  });

  async function selectClient(client: typeof selectedClient) {
    selectedClient = client;
    rxHistory = [];
    txHistory = [];
    timeHistory = [];
    prevRx = 0;
    prevTx = 0;
    lastSampleTime = 0;

    if (chart) { chart.destroy(); chart = null; }
    await tick();

    if (chartEl) {
      const opts: uPlot.Options = {
        width: chartEl.clientWidth,
        height: 140,
        cursor: { show: false },
        legend: { show: false },
        axes: [
          { show: false },
          {
            stroke: '#8b949e',
            grid: { stroke: 'rgba(255,255,255,0.04)', width: 1 },
            ticks: { show: false },
            size: 50,
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
      chart = new uPlot(opts, [new Float64Array(0), new Float64Array(0), new Float64Array(0)], chartEl);
    }
  }

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = col === 'hostname'; }
  }

  function formatBytes(b: number): string {
    if (!b) return '\u2014';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
    return b + ' B';
  }

  function sortArrow(col: typeof sortCol): string {
    if (sortCol !== col) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  }

  onMount(async () => {
    leases = await api<Lease[]>('/api/dhcp/leases').catch(() => []);
  });
</script>

<svelte:head>
  <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.31/dist/uPlot.min.css" />
</svelte:head>

<div class="flex h-full">
  <!-- Main content -->
  <div class="flex-1 space-y-4 overflow-y-auto" class:pr-[420px]={!!selectedClient}>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Clients</h1>
        <p class="text-sm text-[#8b949e]">{filtered.length} devices on network</p>
      </div>
    </div>

    <div class="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg text-sm">
      <Search size={15} class="text-[#8b949e]" />
      <input type="text" bind:value={search} placeholder="Search by name, IP, or MAC..." class="flex-1 bg-transparent border-none outline-none text-white placeholder:text-[#8b949e]" />
    </div>

    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--color-surface-500)]">
            <th class="text-left px-4 py-3 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider cursor-pointer select-none" onclick={() => toggleSort('hostname')}>
              Device{sortArrow('hostname')}
            </th>
            <th class="text-left px-4 py-3 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider cursor-pointer select-none" onclick={() => toggleSort('ip')}>
              IP{sortArrow('ip')}
            </th>
            <th class="text-left px-4 py-3 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">MAC</th>
            <th class="text-right px-4 py-3 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider cursor-pointer select-none" onclick={() => toggleSort('rx')}>
              <span class="inline-flex items-center gap-1"><ArrowDown size={11} />DL{sortArrow('rx')}</span>
            </th>
            <th class="text-right px-4 py-3 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider cursor-pointer select-none" onclick={() => toggleSort('tx')}>
              <span class="inline-flex items-center gap-1"><ArrowUp size={11} />UL{sortArrow('tx')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as client (client.mac)}
            <tr class="border-b border-[var(--color-surface-600)]/50 cursor-pointer transition-colors hover:bg-white/[0.02] {selectedClient?.mac === client.mac ? 'bg-[rgba(0,111,255,0.12)]' : ''}"
              onclick={() => selectClient(client)}>
              <td class="px-4 py-3">
                <div class="font-medium text-white">{client.hostname || '(unknown)'}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-[#c9d1d9]">{client.ip}</td>
              <td class="px-4 py-3 font-mono text-xs text-[#8b949e]">{client.mac?.toLowerCase()}</td>
              <td class="px-4 py-3 text-right font-mono text-xs text-[#58a6ff]">{formatBytes(client.rx)}</td>
              <td class="px-4 py-3 text-right font-mono text-xs text-[var(--color-success)]">{formatBytes(client.tx)}</td>
            </tr>
          {:else}
            <tr><td colspan="5" class="px-4 py-12 text-center text-[#8b949e]">No clients found</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Detail sidebar -->
  {#if selectedClient}
    <div class="fixed top-0 right-0 bottom-0 w-[400px] bg-[var(--color-surface-900)] border-l border-[var(--color-surface-500)] z-40 flex flex-col animate-slide-in">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-surface-500)]">
        <div>
          <h2 class="text-lg font-semibold text-white">{selectedClient.hostname || '(unknown)'}</h2>
          <div class="text-xs text-[#8b949e] font-mono">{selectedClient.ip}</div>
        </div>
        <button class="p-1 text-[#8b949e] hover:text-white rounded-lg hover:bg-[var(--color-surface-700)] transition-colors" onclick={() => { selectedClient = null; if (chart) { chart.destroy(); chart = null; } }}>
          <X size={18} />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Live bandwidth chart -->
        <div>
          <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-3">
            <Activity size={14} /> Live Bandwidth
          </div>
          <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg p-3">
            <div bind:this={chartEl}></div>
            <div class="flex items-center justify-center gap-6 mt-2 text-[10px]">
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#58a6ff]"></span> Download</span>
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[var(--color-success)]"></span> Upload</span>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg p-3 text-center">
            <div class="text-lg font-bold font-mono text-[#58a6ff]">{formatBytes(selectedClient.rx)}</div>
            <div class="text-[10px] text-[#8b949e] uppercase">Total Download</div>
          </div>
          <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg p-3 text-center">
            <div class="text-lg font-bold font-mono text-[var(--color-success)]">{formatBytes(selectedClient.tx)}</div>
            <div class="text-[10px] text-[#8b949e] uppercase">Total Upload</div>
          </div>
        </div>

        <!-- Details -->
        <div class="space-y-0">
          {#each [
            { l: 'MAC Address', v: selectedClient.mac?.toLowerCase() },
            { l: 'IP Address', v: selectedClient.ip },
            { l: 'Hostname', v: selectedClient.hostname || '(unknown)' },
            { l: 'Connections', v: String(selectedClient.conns) },
          ] as row}
            <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
              <span class="text-[13px] text-[#8b949e]">{row.l}</span>
              <span class="text-[13px] text-white font-mono">{row.v}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-slide-in { animation: slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1); }
</style>
