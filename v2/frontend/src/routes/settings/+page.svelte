<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';

  interface Plugin { name: string; version: string; description: string; }

  let plugins = $state<Plugin[]>([]);

  onMount(async () => {
    const p = await api<{ plugins: Plugin[] }>('/api/plugins').catch(() => ({ plugins: [] }));
    plugins = p.plugins;
  });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-white">Settings</h1>
    <p class="text-sm text-[#8b949e]">System configuration and information</p>
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
