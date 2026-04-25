<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Cpu, HardDrive, Clock, Activity, Wifi, Shield, Globe, Server } from 'lucide-svelte';

  // Live metrics from WebSocket
  const metrics = subscribe<{
    cpu: number;
    memory: { total: number; used: number; percent: number };
    uptime: number;
    load: number[];
  }>('system:metrics');

  const conntrack = subscribe<{ count: number; max: number }>('firewall:conntrack');

  // One-time board info
  let board = $state<Record<string, unknown> | null>(null);
  let interfaces = $state<Record<string, unknown>[]>([]);
  let leaseCount = $state(0);
  let meshNodes = $state(0);
  let dnsStats = $state<{ num_dns_queries?: number; num_blocked_filtering?: number } | null>(null);

  // CPU history for sparkline — use a buffer to avoid $effect loop
  let cpuBuffer: number[] = [];
  let cpuHistory = $state<number[]>([]);
  let lastCpu = $state<number | null>(null);

  $effect(() => {
    const cpu = $metrics?.cpu;
    if (cpu != null && cpu !== lastCpu) {
      lastCpu = cpu;
      cpuBuffer = [...cpuBuffer.slice(-59), cpu];
      cpuHistory = cpuBuffer;
    }
  });

  onMount(async () => {
    const [b, leases, nodes, dns, ifaces] = await Promise.all([
      api('/api/system/board').catch(() => null),
      api<unknown[]>('/api/dhcp/leases').catch(() => []),
      api<unknown[]>('/api/mesh/nodes').catch(() => []),
      api('/api/dns/stats').catch(() => null),
      api<Record<string, unknown>[]>('/api/network/interfaces').catch(() => [])
    ]);
    board = b as typeof board;
    leaseCount = (leases as unknown[]).length;
    meshNodes = (nodes as unknown[]).length;
    dnsStats = dns as typeof dnsStats;
    interfaces = ifaces;
  });

  function formatUptime(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatBytes(b: number): string {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  }
</script>

<div class="page-enter space-y-8">
  <!-- Header — clean, minimal -->
  <div>
    <h1 class="text-3xl font-extrabold text-white tracking-tight">{board?.hostname ?? 'Router'}</h1>
    <p class="text-sm text-[#6b7280] mt-1">{board?.model ?? ''}</p>
  </div>

  <!-- Top metrics — no boxes, just clean numbers -->
  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">CPU</div>
      <div class="text-3xl font-extrabold font-mono text-white num-animate">{$metrics?.cpu ?? 0}<span class="text-lg text-[#6b7280]">%</span></div>
    </div>
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">Memory</div>
      <div class="text-3xl font-extrabold font-mono text-white num-animate">{$metrics?.memory?.percent ?? 0}<span class="text-lg text-[#6b7280]">%</span></div>
    </div>
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">Uptime</div>
      <div class="text-3xl font-extrabold text-white">{formatUptime($metrics?.uptime ?? 0)}</div>
    </div>
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">Clients</div>
      <div class="text-3xl font-extrabold font-mono text-white num-animate">{leaseCount}</div>
    </div>
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">Mesh Nodes</div>
      <div class="text-3xl font-extrabold font-mono text-[var(--color-success)] num-animate">{meshNodes}</div>
    </div>
    <div>
      <div class="text-[11px] text-[#6b7280] uppercase tracking-widest mb-1">Connections</div>
      <div class="text-3xl font-extrabold font-mono text-white num-animate">{($conntrack?.count ?? 0).toLocaleString()}</div>
    </div>
  </div>

  <!-- CPU Sparkline + Memory bar — grouped, no heavy borders -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div class="glass rounded-2xl p-5 card-hover">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-[#6b7280] uppercase tracking-widest">CPU History</span>
        <span class="text-xs font-mono text-[#6b7280]">Load {$metrics?.load?.map(l => l.toFixed(2)).join(' ') ?? ''}</span>
      </div>
      <div class="flex items-end gap-[2px] h-16">
        {#each cpuHistory as val}
          <div class="flex-1 rounded-t transition-all duration-300"
            style="height: {Math.max(3, val)}%; background: {val > 80 ? 'var(--color-danger)' : val > 50 ? 'var(--color-warning)' : 'var(--color-accent)'}; opacity: 0.8">
          </div>
        {/each}
      </div>
    </div>

    <div class="glass rounded-2xl p-5 card-hover">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-[#6b7280] uppercase tracking-widest">Memory</span>
        <span class="text-xs font-mono text-[#6b7280]">{formatBytes($metrics?.memory?.used ?? 0)} / {formatBytes($metrics?.memory?.total ?? 0)}</span>
      </div>
      <div class="w-full h-4 bg-[var(--color-surface-700)] rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-700 ease-out"
          style="width: {$metrics?.memory?.percent ?? 0}%; background: linear-gradient(90deg, var(--color-accent), {($metrics?.memory?.percent ?? 0) > 80 ? 'var(--color-danger)' : 'var(--color-accent-light)'})"
        ></div>
      </div>
    </div>
  </div>

  <!-- DNS stats — clean inline -->
  <div class="glass rounded-2xl p-5 card-hover">
    <div class="flex items-center justify-between mb-4">
      <span class="text-xs text-[#6b7280] uppercase tracking-widest">DNS Protection</span>
      <span class="text-xs text-[var(--color-success)]">AdGuard Active</span>
    </div>
    <div class="flex flex-wrap gap-8">
      <div>
        <div class="text-2xl font-extrabold font-mono text-white">{dnsStats?.num_dns_queries?.toLocaleString() ?? '—'}</div>
        <div class="text-[11px] text-[#6b7280]">Queries (24h)</div>
      </div>
      <div>
        <div class="text-2xl font-extrabold font-mono text-[var(--color-danger)]">{dnsStats?.num_blocked_filtering?.toLocaleString() ?? '—'}</div>
        <div class="text-[11px] text-[#6b7280]">Blocked</div>
      </div>
    </div>
  </div>

  <!-- System + Interfaces — combined, lighter -->
  {#if board}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 class="text-xs text-[#6b7280] uppercase tracking-widest mb-3">System</h3>
        <div class="space-y-0">
          {#each [
            { l: 'Model', v: board.model },
            { l: 'Architecture', v: board.system },
            { l: 'Kernel', v: board.kernel },
            { l: 'Board', v: board.board_name },
          ] as row}
            <div class="flex justify-between py-2.5 border-b border-[rgba(255,255,255,0.04)]">
              <span class="text-[13px] text-[#6b7280]">{row.l}</span>
              <span class="text-[13px] text-white font-mono">{row.v}</span>
            </div>
          {/each}
        </div>
      </div>

      <div>
        <h3 class="text-xs text-[#6b7280] uppercase tracking-widest mb-3">Interfaces</h3>
        <div class="space-y-2">
          {#each interfaces as iface}
            <div class="flex items-center justify-between py-2.5 border-b border-[rgba(255,255,255,0.04)]">
              <div class="flex items-center gap-3">
                <span class="w-2 h-2 rounded-full {iface.up ? 'bg-[var(--color-success)] status-pulse' : 'bg-[var(--color-danger)]'}"></span>
                <span class="text-sm font-medium text-white">{iface.interface}</span>
              </div>
              <span class="text-xs font-mono text-[#6b7280]">{iface.proto}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
