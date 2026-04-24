<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Shield, Activity } from 'lucide-svelte';

  let zones = $state<Record<string, string>[]>([]);
  let rules = $state<Record<string, string>[]>([]);
  let ipsets = $state<Record<string, string | string[]>[]>([]);

  const conntrack = subscribe<{ count: number; max: number }>('firewall:conntrack');

  function actionClass(target: string): string {
    switch (target?.toUpperCase()) {
      case 'ACCEPT': return 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]';
      case 'DROP': return 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]';
      case 'REJECT': return 'bg-[rgba(245,158,11,0.15)] text-[#f59e0b]';
      default: return 'bg-[var(--color-surface-600)] text-[#8b949e]';
    }
  }

  onMount(async () => {
    const [z, r, i] = await Promise.all([
      api<Record<string, string>[]>('/api/firewall/zones').catch(() => []),
      api<Record<string, string>[]>('/api/firewall/rules').catch(() => []),
      api<Record<string, string | string[]>[]>('/api/firewall/ipsets').catch(() => []),
    ]);
    zones = z; rules = r; ipsets = i;
  });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-white">Firewall</h1>
    <p class="text-sm text-[#8b949e]">{rules.length} rules &middot; {zones.length} zones &middot; {ipsets.length} IP sets</p>
  </div>

  <!-- Conntrack -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm text-[#8b949e] flex items-center gap-2"><Activity size={16} /> Active Connections</span>
      <span class="font-mono text-white font-semibold">{($conntrack?.count ?? 0).toLocaleString()} <span class="text-[#8b949e] font-normal">/ {($conntrack?.max ?? 0).toLocaleString()}</span></span>
    </div>
    <div class="w-full h-2 bg-[var(--color-surface-600)] rounded-full overflow-hidden">
      <div class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
        style="width: {Math.min(100, (($conntrack?.count ?? 0) / ($conntrack?.max || 1)) * 100)}%"></div>
    </div>
  </div>

  <!-- Zones -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <h2 class="text-base font-semibold text-white mb-4">Zones</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      {#each zones as zone}
        <div class="border-l-[3px] pl-3 py-2" style="border-color: {zone.name === 'lan' ? '#22c55e' : zone.name === 'wan' ? '#ef4444' : '#006fff'}">
          <div class="font-bold text-white text-sm uppercase">{zone.name}</div>
          <div class="text-[11px] text-[#8b949e] font-mono mt-1">
            IN: {zone.input} &middot; OUT: {zone.output} &middot; FWD: {zone.forward}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Rules -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
    <div class="px-5 py-4 border-b border-[var(--color-surface-500)]">
      <h2 class="text-base font-semibold text-white">Traffic Rules</h2>
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-[var(--color-surface-500)]">
          <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
          <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Source</th>
          <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Dest</th>
          <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Proto</th>
          <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each rules as rule}
          <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]"
            class:opacity-40={rule.enabled === '0'}>
            <td class="px-4 py-2.5 font-medium text-white">{rule.name || '(unnamed)'}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{rule.src || '*'}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{rule.dest || '*'}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{rule.proto || 'any'}</td>
            <td class="px-4 py-2.5">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {actionClass(rule.target)}">{rule.target}</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
