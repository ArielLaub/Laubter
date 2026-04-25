<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { subscribe } from '$lib/stores/websocket';
  import { ShieldCheck, ShieldOff, Search, Ban, Clock, Activity, Plus, Trash2, RefreshCw } from 'lucide-svelte';

  type Tab = 'dashboard' | 'filters' | 'querylog';
  let activeTab = $state<Tab>('dashboard');
  let loading = $state(true);
  let logSearch = $state('');

  let status = $state<Record<string, unknown>>({});
  let filtering = $state<{ enabled?: boolean; filters?: { name: string; url: string; enabled: boolean; rules_count: number; last_updated: string }[] }>({});
  let querylog = $state<{ data?: Record<string, unknown>[] }>({ data: [] });

  const liveStats = subscribe<Record<string, unknown>>('dns:stats');
  let restStats = $state<Record<string, unknown>>({});
  const stats = $derived($liveStats ?? restStats);

  // Add filter form
  let showAddFilter = $state(false);
  let filterName = $state('');
  let filterUrl = $state('');

  async function loadAll() {
    loading = true;
    const [s, st, f, ql] = await Promise.all([
      api('/api/dns/status').catch(() => ({})),
      api('/api/dns/stats').catch(() => ({})),
      api('/api/dns/filtering').catch(() => ({})),
      api('/api/dns/querylog').catch(() => ({ data: [] }))
    ]);
    status = s as Record<string, unknown>;
    restStats = st as Record<string, unknown>;
    filtering = f as typeof filtering;
    querylog = ql as typeof querylog;
    loading = false;
  }

  async function toggleProtection() {
    const enabled = !(status.protection_enabled ?? true);
    await api('/api/dns/protection', { method: 'POST', body: JSON.stringify({ enabled }) });
    status.protection_enabled = enabled;
  }

  async function toggleFiltering() {
    const enabled = !filtering.enabled;
    await api('/api/dns/filtering/toggle', { method: 'POST', body: JSON.stringify({ enabled }) });
    filtering.enabled = enabled;
  }

  async function addFilter() {
    if (!filterName || !filterUrl) return;
    await api('/api/dns/filters', { method: 'POST', body: JSON.stringify({ name: filterName, url: filterUrl }) });
    filterName = ''; filterUrl = ''; showAddFilter = false;
    await loadAll();
  }

  async function removeFilter(url: string) {
    await api('/api/dns/filters', { method: 'DELETE', body: JSON.stringify({ url }) });
    await loadAll();
  }

  async function toggleFilter(url: string, enabled: boolean) {
    await api('/api/dns/filters/toggle', { method: 'POST', body: JSON.stringify({ url, enabled: !enabled }) });
    await loadAll();
  }

  function getTopDomains(s: Record<string, unknown>, key: string): { domain: string; count: number }[] {
    const arr = s[key] as Record<string, number>[] | undefined;
    if (!arr) return [];
    return arr.flatMap(obj => Object.entries(obj).map(([domain, count]) => ({ domain, count }))).slice(0, 15);
  }

  function formatNum(n: unknown): string {
    const v = Number(n) || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  }

  function formatTime(ts: string): string {
    try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
  }

  const filteredLog = $derived.by(() => {
    const data = querylog.data ?? [];
    if (!logSearch.trim()) return data;
    const q = logSearch.toLowerCase();
    return data.filter((e: any) => e.question?.name?.toLowerCase().includes(q) || e.client?.toLowerCase().includes(q));
  });

  const btn = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
  const btnPrimary = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)]`;
  const btnSecondary = `${btn} bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)]`;
  const input = 'w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]';
  const label = 'block text-[12px] text-[#8b949e] mb-1.5 font-medium';

  onMount(loadAll);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">AdGuard DNS</h1>
    <button class={btnSecondary} onclick={loadAll}><RefreshCw size={14} class="inline -mt-0.5 {loading ? 'animate-spin' : ''}" /> Refresh</button>
  </div>

  <!-- Tabs -->
  <div class="flex gap-0 border-b-2 border-[var(--color-surface-500)] overflow-x-auto">
    {#each [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'filters', label: 'Filters', count: filtering.filters?.length },
      { id: 'querylog', label: 'Query Log', count: (querylog.data ?? []).length },
    ] as tab}
      <button class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors whitespace-nowrap
        {activeTab === tab.id ? 'text-[var(--color-accent-light)] border-[var(--color-accent)]' : 'text-[#8b949e] border-transparent hover:text-white'}"
        onclick={() => activeTab = tab.id as Tab}>
        {tab.label}
        {#if tab.count}<span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full {activeTab === tab.id ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}">{tab.count}</span>{/if}
      </button>
    {/each}
  </div>

  <!-- =================== DASHBOARD =================== -->
  {#if activeTab === 'dashboard'}
    <!-- Protection toggle + stat cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Protection status -->
      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            {#if status.protection_enabled}<ShieldCheck size={18} class="text-[#22c55e]" />{:else}<ShieldOff size={18} class="text-[#ef4444]" />{/if}
            <span class="text-sm font-semibold text-white">Protection</span>
          </div>
          <button class="w-10 h-5 rounded-full transition-colors relative {status.protection_enabled ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}"
            onclick={toggleProtection}>
            <span class="absolute top-0.5 w-4 h-4 rounded-full transition-all {status.protection_enabled ? 'left-5 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
          </button>
        </div>
        <div class="text-2xl font-extrabold {status.protection_enabled ? 'text-[#22c55e]' : 'text-[#ef4444]'}">{status.protection_enabled ? 'Active' : 'Off'}</div>
      </div>

      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
        <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-2"><Search size={15} /> Total Queries</div>
        <div class="text-2xl font-extrabold text-white font-mono">{formatNum(stats.num_dns_queries)}</div>
        <div class="text-[11px] text-[#8b949e]">Last 24 hours</div>
      </div>

      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
        <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-2"><Ban size={15} /> Blocked</div>
        <div class="text-2xl font-extrabold text-[#ef4444] font-mono">{formatNum(stats.num_blocked_filtering)}</div>
        <div class="text-[11px] text-[#8b949e]">{stats.num_dns_queries ? ((Number(stats.num_blocked_filtering) / Number(stats.num_dns_queries)) * 100).toFixed(1) : '0'}% of queries</div>
      </div>

      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
        <div class="flex items-center gap-2 text-sm text-[#8b949e] mb-2"><Clock size={15} /> Avg Response</div>
        <div class="text-2xl font-extrabold text-white font-mono">{Number(stats.avg_processing_time ?? 0).toFixed(1) || '0'} ms</div>
        <div class="text-[11px] text-[#8b949e]">Processing time</div>
      </div>
    </div>

    <!-- Top domains -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Top queried -->
      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
        <div class="px-5 py-3 border-b border-[var(--color-surface-500)]">
          <h2 class="text-sm font-semibold text-white">Top Queried Domains</h2>
        </div>
        {#each getTopDomains(stats, 'top_queried_domains') as item, i}
          <div class="flex items-center justify-between px-5 py-2 border-b border-[var(--color-surface-600)]/30 hover:bg-white/[0.02]">
            <span class="text-xs text-[#c9d1d9] font-mono truncate">{item.domain}</span>
            <span class="text-xs text-[#8b949e] font-mono ml-2 flex-shrink-0">{formatNum(item.count)}</span>
          </div>
        {:else}
          <div class="py-8 text-center text-[#8b949e] text-sm">No data</div>
        {/each}
      </div>

      <!-- Top blocked -->
      <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
        <div class="px-5 py-3 border-b border-[var(--color-surface-500)]">
          <h2 class="text-sm font-semibold text-white">Top Blocked Domains</h2>
        </div>
        {#each getTopDomains(stats, 'top_blocked_domains') as item, i}
          <div class="flex items-center justify-between px-5 py-2 border-b border-[var(--color-surface-600)]/30 hover:bg-white/[0.02]">
            <span class="text-xs text-[#ef4444] font-mono truncate">{item.domain}</span>
            <span class="text-xs text-[#8b949e] font-mono ml-2 flex-shrink-0">{formatNum(item.count)}</span>
          </div>
        {:else}
          <div class="py-8 text-center text-[#8b949e] text-sm">No data</div>
        {/each}
      </div>
    </div>

  <!-- =================== FILTERS =================== -->
  {:else if activeTab === 'filters'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-white">Filter Lists</h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-[#8b949e]">Filtering</span>
            <button class="w-8 h-4 rounded-full transition-colors relative {filtering.enabled ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}"
              onclick={toggleFiltering}>
              <span class="absolute top-0.5 w-3 h-3 rounded-full transition-all {filtering.enabled ? 'left-4 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
            </button>
          </div>
        </div>
        <button class={btnPrimary} onclick={() => showAddFilter = true}><Plus size={14} class="inline -mt-0.5" /> Add Filter</button>
      </div>

      {#if showAddFilter}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class={label}>Name</label><input class={input} bind:value={filterName} placeholder="e.g. EasyList" /></div>
            <div><label class={label}>URL</label><input class="{input} font-mono text-xs" bind:value={filterUrl} placeholder="https://..." /></div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button class={btnSecondary} onclick={() => showAddFilter = false}>Cancel</button>
            <button class={btnPrimary} onclick={addFilter}>Add</button>
          </div>
        </div>
      {/if}

      {#if (filtering.filters ?? []).length === 0}
        <div class="py-12 text-center text-[#8b949e] text-sm">No filters configured</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[500px]">
            <thead>
              <tr class="border-b border-[var(--color-surface-500)]">
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Rules</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Updated</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Status</th>
                <th class="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {#each filtering.filters ?? [] as filter}
                <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]" class:opacity-40={!filter.enabled}>
                  <td class="px-4 py-2.5">
                    <div class="font-medium text-white">{filter.name}</div>
                    <div class="text-[10px] text-[#8b949e] font-mono truncate max-w-[300px]">{filter.url}</div>
                  </td>
                  <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{filter.rules_count?.toLocaleString()}</td>
                  <td class="px-4 py-2.5 text-xs text-[#8b949e]">{filter.last_updated ? formatTime(filter.last_updated) : '—'}</td>
                  <td class="px-4 py-2.5">
                    <button class="w-8 h-4 rounded-full transition-colors relative {filter.enabled ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}"
                      onclick={() => toggleFilter(filter.url, filter.enabled)}>
                      <span class="absolute top-0.5 w-3 h-3 rounded-full transition-all {filter.enabled ? 'left-4 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => removeFilter(filter.url)}><Trash2 size={13} /></button>
                  </td>
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
      <div class="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-surface-500)]">
        <Search size={15} class="text-[#8b949e]" />
        <input type="text" bind:value={logSearch} placeholder="Search domain or client..." class="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-[#8b949e]" />
        <span class="text-xs text-[#8b949e]">{filteredLog.length} entries</span>
      </div>

      <div class="overflow-x-auto" style="max-height: 600px; overflow-y: auto">
        <table class="w-full text-sm min-w-[600px]">
          <thead class="sticky top-0 bg-[var(--color-surface-800)]">
            <tr class="border-b border-[var(--color-surface-500)]">
              <th class="text-left px-4 py-2 text-[11px] font-semibold text-[#8b949e] uppercase">Time</th>
              <th class="text-left px-4 py-2 text-[11px] font-semibold text-[#8b949e] uppercase">Domain</th>
              <th class="text-left px-4 py-2 text-[11px] font-semibold text-[#8b949e] uppercase">Client</th>
              <th class="text-left px-4 py-2 text-[11px] font-semibold text-[#8b949e] uppercase">Type</th>
              <th class="text-left px-4 py-2 text-[11px] font-semibold text-[#8b949e] uppercase">Result</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredLog as entry (entry)}
              {@const q = entry.question as { name?: string; type?: string } | undefined}
              {@const reason = (entry.reason as string) ?? ''}
              {@const blocked = reason.includes('Filtered') || reason.includes('Blocked')}
              <tr class="border-b border-[var(--color-surface-600)]/30 hover:bg-white/[0.02] {blocked ? 'bg-[rgba(239,68,68,0.03)]' : ''}">
                <td class="px-4 py-1.5 text-[11px] text-[#8b949e] whitespace-nowrap">{formatTime(entry.time as string)}</td>
                <td class="px-4 py-1.5 font-mono text-xs {blocked ? 'text-[#ef4444]' : 'text-[#c9d1d9]'} truncate max-w-[250px]">{q?.name ?? '—'}</td>
                <td class="px-4 py-1.5 font-mono text-xs text-[#8b949e]">{entry.client ?? '—'}</td>
                <td class="px-4 py-1.5 text-[11px] text-[#8b949e]">{q?.type ?? '—'}</td>
                <td class="px-4 py-1.5">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                    {blocked ? 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]' :
                     reason.includes('Rewrite') ? 'bg-[rgba(245,158,11,0.15)] text-[#f59e0b]' :
                     'bg-[rgba(34,197,94,0.15)] text-[#22c55e]'}">{blocked ? 'Blocked' : reason.includes('Rewrite') ? 'Rewritten' : 'Allowed'}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
