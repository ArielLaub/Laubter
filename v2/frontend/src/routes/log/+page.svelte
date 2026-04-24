<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Search, RefreshCw, ArrowDown } from 'lucide-svelte';

  let lines = $state<string[]>([]);
  let search = $state('');
  let loading = $state(true);
  let autoScroll = $state(true);
  let logEl = $state<HTMLDivElement | null>(null);

  const filtered = $derived.by(() => {
    if (!search.trim()) return lines;
    const q = search.toLowerCase();
    return lines.filter(l => l.toLowerCase().includes(q));
  });

  // Color-code log levels
  function lineClass(line: string): string {
    if (line.includes('.err ') || line.includes('.crit ') || line.includes('error')) return 'text-[#ef4444]';
    if (line.includes('.warn ')) return 'text-[#f59e0b]';
    if (line.includes('.notice ') || line.includes('.info ')) return 'text-[#c9d1d9]';
    return 'text-[#8b949e]';
  }

  // Extract timestamp for display
  function parseTimestamp(line: string): { time: string; rest: string } {
    // OpenWrt log format: "Mon Apr 24 22:30:01 2026 daemon.info ..."
    const match = line.match(/^(\w+ \w+ \d+ \d+:\d+:\d+ \d+) (.+)$/);
    if (match) return { time: match[1], rest: match[2] };
    return { time: '', rest: line };
  }

  async function loadLog() {
    loading = true;
    lines = await api<string[]>('/api/system/log').catch(() => []);
    loading = false;
    if (autoScroll && logEl) {
      requestAnimationFrame(() => logEl?.scrollTo(0, logEl.scrollHeight));
    }
  }

  onMount(() => {
    loadLog();
    // Auto-refresh every 5 seconds
    const timer = setInterval(loadLog, 5000);
    return () => clearInterval(timer);
  });
</script>

<div class="space-y-4 flex flex-col" style="height: calc(100vh - 8rem)">
  <div class="flex items-center justify-between flex-shrink-0">
    <div>
      <h1 class="text-2xl font-bold text-white">System Log</h1>
      <p class="text-sm text-[#8b949e]">{filtered.length} lines {search ? `(filtered from ${lines.length})` : ''}</p>
    </div>
    <div class="flex items-center gap-2">
      <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)] transition-colors flex items-center gap-1.5"
        onclick={loadLog}>
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Refresh
      </button>
      <button class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
        {autoScroll ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}"
        onclick={() => { autoScroll = !autoScroll; if (autoScroll && logEl) logEl.scrollTo(0, logEl.scrollHeight); }}>
        <ArrowDown size={14} /> Auto-scroll
      </button>
    </div>
  </div>

  <!-- Search -->
  <div class="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg text-sm flex-shrink-0">
    <Search size={15} class="text-[#8b949e]" />
    <input type="text" bind:value={search} placeholder="Filter log (e.g. error, dnsmasq, dhcp...)" class="flex-1 bg-transparent border-none outline-none text-white placeholder:text-[#8b949e]" />
  </div>

  <!-- Log viewer -->
  <div bind:this={logEl}
    class="flex-1 bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-auto font-mono">
    {#if loading && lines.length === 0}
      <div class="p-8 text-center text-[#8b949e]">Loading log...</div>
    {:else if filtered.length === 0}
      <div class="p-8 text-center text-[#8b949e]">No log entries {search ? 'matching filter' : 'found'}</div>
    {:else}
      <table class="w-full">
        <tbody>
          {#each filtered as line, i}
            {@const parsed = parseTimestamp(line)}
            <tr class="border-b border-[var(--color-surface-600)]/30 hover:bg-white/[0.02]">
              {#if parsed.time}
                <td class="px-3 py-1.5 text-[12px] text-[#6e7681] whitespace-nowrap align-top w-0">{parsed.time.split(' ').slice(2, 4).join(' ')}</td>
              {/if}
              <td class="px-3 py-1.5 text-[13px] leading-relaxed {lineClass(line)} break-all">{parsed.rest || line}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
