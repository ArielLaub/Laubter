<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { subscribe } from '$lib/stores/websocket';
  import { ShieldCheck, ShieldOff, Search, Ban, Clock, Activity } from 'lucide-svelte';

  type Tab = 'overview' | 'querylog';

  let activeTab = $state<Tab>('overview');
  let loading = $state(true);

  // Data
  let status = $state<Record<string, unknown>>({});
  let querylog = $state<{ data?: Record<string, unknown>[] }>({ data: [] });

  // Live stats from WebSocket
  const liveStats = subscribe<Record<string, unknown>>('dns:stats');

  // Fallback stats from REST
  let restStats = $state<Record<string, unknown>>({});

  // Compute effective stats (prefer live, fallback to REST)
  let stats = $derived($liveStats ?? restStats);

  async function loadAll() {
    const [st, s, ql] = await Promise.all([
      api<Record<string, unknown>>('/api/dns/status').catch(() => ({})),
      api<Record<string, unknown>>('/api/dns/stats').catch(() => ({})),
      api<{ data?: Record<string, unknown>[] }>('/api/dns/querylog').catch(() => ({ data: [] })),
    ]);
    status = st;
    restStats = s;
    querylog = ql;
    loading = false;
  }

  function formatNumber(n: unknown): string {
    if (n == null) return '0';
    const num = typeof n === 'string' ? parseInt(n) : (n as number);
    if (isNaN(num)) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString();
  }

  function formatMs(n: unknown): string {
    if (n == null) return '-';
    const num = typeof n === 'string' ? parseFloat(n) : (n as number);
    if (isNaN(num)) return '-';
    return num.toFixed(1) + ' ms';
  }

  function formatTime(ts: unknown): string {
    if (!ts) return '-';
    const d = new Date(ts as string);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function getTopBlocked(s: Record<string, unknown>): [string, number][] {
    const tb = s.top_blocked_domains as Record<string, number>[] | undefined;
    if (!tb || !Array.isArray(tb)) return [];
    // AdGuard returns array of {domain: count} objects
    const result: [string, number][] = [];
    for (const obj of tb) {
      for (const [domain, count] of Object.entries(obj)) {
        result.push([domain, count as number]);
      }
    }
    return result.sort((a, b) => b[1] - a[1]).slice(0, 15);
  }

  function resultBadge(result: unknown): { text: string; cls: string } {
    const r = String(result ?? '').toLowerCase();
    if (r.includes('blocked') || r.includes('filteredblacklist') || r.includes('filteredsafebrowsing'))
      return { text: 'Blocked', cls: 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]' };
    if (r.includes('rewrite') || r.includes('filteredsafesearch'))
      return { text: 'Rewritten', cls: 'bg-[rgba(245,158,11,0.15)] text-[#f59e0b]' };
    if (r.includes('processed') || r.includes('noterror') || r === '')
      return { text: 'Allowed', cls: 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]' };
    return { text: String(result), cls: 'bg-[var(--color-surface-600)] text-[#8b949e]' };
  }

  onMount(loadAll);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">AdGuard DNS</h1>
    <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)] transition-colors"
      onclick={loadAll}>Refresh</button>
  </div>

  {#if loading}
    <div class="py-12 text-center text-[#8b949e] text-sm">Loading AdGuard data...</div>
  {:else}

    <!-- Tabs -->
    <div class="flex gap-0 border-b-2 border-[var(--color-surface-500)] overflow-x-auto">
      {#each [
        { id: 'overview', label: 'Overview' },
        { id: 'querylog', label: 'Query Log', count: querylog.data?.length ?? 0 },
      ] as tab}
        <button class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors
          {activeTab === tab.id ? 'text-[var(--color-accent-light)] border-[var(--color-accent)]' : 'text-[#8b949e] border-transparent hover:text-white'}"
          onclick={() => activeTab = tab.id as Tab}>
          {tab.label}
          {#if tab.count !== undefined}
            <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full {activeTab === tab.id ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}">{tab.count}</span>
          {/if}
        </button>
      {/each}
    </div>

    <!-- =================== OVERVIEW =================== -->
    {#if activeTab === 'overview'}

      <!-- Status + Stats Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Protection Status -->
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center gap-2 mb-3">
            {#if status.protection_enabled}
              <ShieldCheck size={18} class="text-[#22c55e]" />
            {:else}
              <ShieldOff size={18} class="text-[#ef4444]" />
            {/if}
            <span class="text-sm font-semibold text-white">Protection</span>
          </div>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[#8b949e]">Status</span>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full
                {status.protection_enabled ? 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'}">
                {status.protection_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-[#8b949e]">Filtering</span>
              <span class="text-white text-xs">{status.filtering_enabled ? 'Active' : 'Off'}</span>
            </div>
            {#if status.dns_port}
              <div class="flex justify-between">
                <span class="text-[#8b949e]">DNS Port</span>
                <span class="text-white font-mono text-xs">{status.dns_port}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Total Queries -->
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center gap-2 mb-3">
            <Search size={18} class="text-[#58a6ff]" />
            <span class="text-sm font-semibold text-white">Total Queries</span>
          </div>
          <div class="text-3xl font-bold text-white">{formatNumber(stats?.num_dns_queries)}</div>
          <div class="text-[11px] text-[#8b949e] mt-1">Last 24 hours</div>
        </div>

        <!-- Blocked -->
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center gap-2 mb-3">
            <Ban size={18} class="text-[#ef4444]" />
            <span class="text-sm font-semibold text-white">Blocked</span>
          </div>
          <div class="text-3xl font-bold text-white">{formatNumber(stats?.num_blocked_filtering)}</div>
          <div class="text-[11px] text-[#8b949e] mt-1">
            {#if stats?.num_dns_queries && (stats.num_dns_queries as number) > 0}
              {((stats.num_blocked_filtering as number ?? 0) / (stats.num_dns_queries as number) * 100).toFixed(1)}% of queries
            {:else}
              Last 24 hours
            {/if}
          </div>
        </div>

        <!-- Avg Processing Time -->
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center gap-2 mb-3">
            <Activity size={18} class="text-[#f59e0b]" />
            <span class="text-sm font-semibold text-white">Avg Response</span>
          </div>
          <div class="text-3xl font-bold text-white">{formatMs(stats?.avg_processing_time ? (stats.avg_processing_time as number) * 1000 : null)}</div>
          <div class="text-[11px] text-[#8b949e] mt-1">Processing time</div>
        </div>
      </div>

      <!-- Top Blocked Domains -->
      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
          <h2 class="text-sm font-semibold text-white">Top Blocked Domains</h2>
        </div>

        {#if getTopBlocked(stats ?? {}).length === 0}
          <div class="py-12 text-center text-[#8b949e] text-sm">No blocked domains data available</div>
        {:else}
          {@const topBlocked = getTopBlocked(stats ?? {})}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[var(--color-surface-500)]">
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Domain</th>
                  <th class="text-right px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {#each topBlocked as [domain, count]}
                  <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02] transition-colors">
                    <td class="px-4 py-2.5 font-mono text-xs text-[#ef4444]">{domain}</td>
                    <td class="px-4 py-2.5 text-right text-xs text-white font-medium">{formatNumber(count)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

    <!-- =================== QUERY LOG =================== -->
    {:else if activeTab === 'querylog'}
      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
          <h2 class="text-sm font-semibold text-white">Recent Queries</h2>
          <span class="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-600)] text-[#8b949e]">{querylog.data?.length ?? 0}</span>
        </div>

        {#if !querylog.data || querylog.data.length === 0}
          <div class="py-12 text-center text-[#8b949e] text-sm">No query log entries available</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[var(--color-surface-500)]">
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Time</th>
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Hostname</th>
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Client</th>
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Type</th>
                  <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Result</th>
                </tr>
              </thead>
              <tbody>
                {#each querylog.data as entry}
                  {@const question = entry.question as Record<string, unknown> | undefined}
                  {@const badge = resultBadge(entry.reason)}
                  <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02] transition-colors">
                    <td class="px-4 py-2.5 text-xs text-[#8b949e] whitespace-nowrap">
                      <div class="flex items-center gap-1.5">
                        <Clock size={12} />
                        {formatTime(entry.time)}
                      </div>
                    </td>
                    <td class="px-4 py-2.5 font-mono text-xs text-white max-w-[250px] truncate">{question?.name ?? entry.question ?? '-'}</td>
                    <td class="px-4 py-2.5 font-mono text-xs text-[#58a6ff]">{entry.client ?? entry.client_ip ?? '-'}</td>
                    <td class="px-4 py-2.5 text-xs text-[#8b949e]">{question?.type ?? entry.type ?? '-'}</td>
                    <td class="px-4 py-2.5">
                      <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {badge.cls}">{badge.text}</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}

  {/if}
</div>
