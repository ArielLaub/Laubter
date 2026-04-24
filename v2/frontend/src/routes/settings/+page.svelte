<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Server, Wifi, Shield, Globe } from 'lucide-svelte';

  interface Plugin { name: string; version: string; description: string; }

  let plugins = $state<Plugin[]>([]);
  let board = $state<Record<string, unknown> | null>(null);
  let interfaces = $state<Record<string, unknown>[]>([]);

  onMount(async () => {
    const [p, b, i] = await Promise.all([
      api<{ plugins: Plugin[] }>('/api/plugins').catch(() => ({ plugins: [] })),
      api('/api/system/board').catch(() => null),
      api<Record<string, unknown>[]>('/api/network/interfaces').catch(() => [])
    ]);
    plugins = p.plugins;
    board = b as typeof board;
    interfaces = i;
  });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-white">Settings</h1>
    <p class="text-sm text-[#8b949e]">System configuration and information</p>
  </div>

  <!-- System info -->
  {#if board}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <h2 class="text-base font-semibold text-white mb-4 flex items-center gap-2"><Server size={18} /> System</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
        {#each [
          { l: 'Hostname', v: board.hostname },
          { l: 'Model', v: board.model },
          { l: 'Architecture', v: board.system },
          { l: 'Kernel', v: board.kernel },
          { l: 'Board', v: board.board_name },
          { l: 'Rootfs', v: board.rootfs_type },
        ] as row}
          <div class="flex justify-between py-2 border-b border-[var(--color-surface-600)]">
            <span class="text-[13px] text-[#8b949e]">{row.l}</span>
            <span class="text-[13px] text-white font-mono">{row.v}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Interfaces -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <h2 class="text-base font-semibold text-white mb-4 flex items-center gap-2"><Globe size={18} /> Interfaces</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {#each interfaces as iface}
        <div class="bg-[var(--color-surface-700)] rounded-lg p-3">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-white text-sm">{iface.interface}</span>
            <span class="w-2 h-2 rounded-full {iface.up ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}"></span>
          </div>
          <div class="text-[11px] text-[#8b949e] font-mono mt-1">{iface.proto}</div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Active plugins -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <h2 class="text-base font-semibold text-white mb-4">Active Plugins</h2>
    <div class="space-y-2">
      {#each plugins as plugin}
        <div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-600)]">
          <div>
            <span class="text-sm font-medium text-white">{plugin.name}</span>
            <span class="text-[11px] text-[#8b949e] ml-2">{plugin.description}</span>
          </div>
          <span class="text-[11px] font-mono text-[#8b949e]">v{plugin.version}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
