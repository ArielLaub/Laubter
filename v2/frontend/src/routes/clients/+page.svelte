<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Search, Wifi, Cable, ArrowDown, ArrowUp, Signal } from 'lucide-svelte';

  interface Lease { ts: number; mac: string; ip: string; hostname: string; }
  interface Traffic { mac: string; ip: string; rxBytes: number; txBytes: number; conns: number; }

  let leases = $state<Lease[]>([]);
  let search = $state('');
  let sortCol = $state<'hostname' | 'ip' | 'rx' | 'tx'>('hostname');
  let sortAsc = $state(true);

  const trafficStream = subscribe<Traffic[]>('traffic:clients');
  const dhcpStream = subscribe<Lease[]>('dhcp:leases');

  // Build traffic lookup
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

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-white">Clients</h1>
      <p class="text-sm text-[#8b949e]">{filtered.length} devices on network</p>
    </div>
  </div>

  <!-- Search -->
  <div class="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-lg text-sm">
    <Search size={15} class="text-[#8b949e]" />
    <input type="text" bind:value={search} placeholder="Search by name, IP, or MAC..." class="flex-1 bg-transparent border-none outline-none text-white placeholder:text-[#8b949e]" />
  </div>

  <!-- Table -->
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
          <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02] transition-colors">
            <td class="px-4 py-3">
              <div class="font-medium text-white">{client.hostname || '(unknown)'}</div>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-[#c9d1d9]">{client.ip}</td>
            <td class="px-4 py-3 font-mono text-xs text-[#8b949e]">{client.mac?.toUpperCase()}</td>
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
