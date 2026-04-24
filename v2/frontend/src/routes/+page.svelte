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

  // One-time board info
  let board = $state<{ hostname: string; model: string; system: string } | null>(null);
  let leaseCount = $state(0);
  let meshNodes = $state(0);
  let dnsStats = $state<{ num_dns_queries?: number; num_blocked_filtering?: number } | null>(null);

  // CPU history for sparkline
  let cpuHistory = $state<number[]>([]);
  $effect(() => {
    if ($metrics?.cpu != null) {
      cpuHistory = [...cpuHistory.slice(-59), $metrics.cpu];
    }
  });

  onMount(async () => {
    const [b, leases, nodes, dns] = await Promise.all([
      api('/api/system/board').catch(() => null),
      api<unknown[]>('/api/dhcp/leases').catch(() => []),
      api<unknown[]>('/api/mesh/nodes').catch(() => []),
      api('/api/dns/stats').catch(() => null)
    ]);
    board = b as typeof board;
    leaseCount = (leases as unknown[]).length;
    meshNodes = (nodes as unknown[]).length;
    dnsStats = dns as typeof dnsStats;
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

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-white">{board?.hostname ?? 'Router'}</h1>
    <p class="text-sm text-[#8b949e] mt-1">{board?.model ?? ''} &middot; {board?.system ?? ''}</p>
  </div>

  <!-- Metric cards -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <!-- CPU -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-sm text-[#8b949e]">
          <Cpu size={16} />CPU
        </div>
        <span class="text-2xl font-bold font-mono text-white">{$metrics?.cpu ?? 0}%</span>
      </div>
      <!-- Sparkline -->
      <div class="flex items-end gap-px h-10">
        {#each cpuHistory as val}
          <div class="flex-1 rounded-t-sm transition-all duration-300"
            style="height: {Math.max(2, val)}%; background: {val > 80 ? 'var(--color-danger)' : val > 50 ? 'var(--color-warning)' : 'var(--color-accent)'}">
          </div>
        {/each}
      </div>
      <div class="text-[11px] text-[#8b949e] mt-2 font-mono">
        Load: {$metrics?.load?.map(l => l.toFixed(2)).join(' ') ?? '...'}
      </div>
    </div>

    <!-- Memory -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-sm text-[#8b949e]">
          <HardDrive size={16} />Memory
        </div>
        <span class="text-2xl font-bold font-mono text-white">{$metrics?.memory?.percent ?? 0}%</span>
      </div>
      <!-- Progress bar -->
      <div class="w-full h-3 bg-[var(--color-surface-600)] rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all duration-500"
          style="width: {$metrics?.memory?.percent ?? 0}%; background: {($metrics?.memory?.percent ?? 0) > 80 ? 'var(--color-danger)' : 'var(--color-accent)'}"
        ></div>
      </div>
      <div class="text-[11px] text-[#8b949e] mt-2 font-mono">
        {formatBytes($metrics?.memory?.used ?? 0)} / {formatBytes($metrics?.memory?.total ?? 0)}
      </div>
    </div>

    <!-- Uptime -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-sm text-[#8b949e]">
          <Clock size={16} />Uptime
        </div>
      </div>
      <div class="text-2xl font-bold text-white">{formatUptime($metrics?.uptime ?? 0)}</div>
      <div class="text-[11px] text-[#8b949e] mt-2 font-mono">
        Since {$metrics?.uptime ? new Date(Date.now() - ($metrics.uptime * 1000)).toLocaleDateString() : '...'}
      </div>
    </div>

    <!-- Network overview -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-sm text-[#8b949e]">
          <Globe size={16} />Network
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <div class="text-xl font-bold text-white">{leaseCount}</div>
          <div class="text-[11px] text-[#8b949e]">Clients</div>
        </div>
        <div>
          <div class="text-xl font-bold text-white">{meshNodes}</div>
          <div class="text-[11px] text-[#8b949e]">Mesh Nodes</div>
        </div>
        <div>
          <div class="text-xl font-bold text-white">{dnsStats?.num_dns_queries?.toLocaleString() ?? '...'}</div>
          <div class="text-[11px] text-[#8b949e]">DNS Queries</div>
        </div>
        <div>
          <div class="text-xl font-bold text-[var(--color-danger)]">{dnsStats?.num_blocked_filtering?.toLocaleString() ?? '...'}</div>
          <div class="text-[11px] text-[#8b949e]">Blocked</div>
        </div>
      </div>
    </div>
  </div>
</div>
