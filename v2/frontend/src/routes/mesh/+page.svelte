<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Router, Wifi, Cable, ChevronRight } from 'lucide-svelte';

  interface MeshNode {
    alias: string; model_name: string; ui_model_name: string; ip: string; mac: string;
    online: string; re_path: string; level: string; band_num: string;
    ap2g: string; ap5g: string; ap5g1: string; ap6g: string;
    pap5g: string; rssi5g: string; pap2g: string; rssi2g: string;
    fwver: string; product_id: string;
    config: { backhalctrl?: { amas_ethernet?: string }; ctrl_led?: { led_val?: string } };
    wired_port: Record<string, unknown>;
  }

  let nodes = $state<MeshNode[]>([]);
  let selectedNode = $state<MeshNode | null>(null);

  const meshStream = subscribe<{ nodes: { get_cfg_clientlist: MeshNode[] } }>('mesh:topology');

  $effect(() => {
    if ($meshStream?.nodes?.get_cfg_clientlist) {
      nodes = $meshStream.nodes.get_cfg_clientlist;
    }
  });

  function isMain(n: MeshNode): boolean {
    return n.re_path === '0' && !n.pap2g && !n.pap5g;
  }

  function backhaulType(n: MeshNode): 'main' | 'wired' | 'wireless' {
    const rp = parseInt(n.re_path);
    if (rp === 0 && !n.pap2g && !n.pap5g) return 'main';
    if (rp === 1) return 'wired';
    if (rp > 1) return 'wireless';
    return 'wired';
  }

  function linkRate(n: MeshNode): string {
    const wp = n.wired_port as Record<string, unknown>;
    const wan = wp?.wan_port as Record<string, { link_rate?: string }> | undefined;
    if (wan) {
      const rate = Object.values(wan)[0]?.link_rate;
      if (rate === 'Q') return '2.5G';
      if (rate === 'G') return '1G';
      if (rate === 'M') return '100M';
    }
    return '';
  }

  function qualityColor(rssi: number): string {
    if (rssi >= -50) return 'var(--color-success)';
    if (rssi >= -65) return '#3b82f6';
    if (rssi >= -75) return 'var(--color-warning)';
    return 'var(--color-danger)';
  }

  onMount(async () => {
    const data = await api<MeshNode[]>('/api/mesh/nodes').catch(() => []);
    if (data.length) nodes = data;
  });

  const mainNode = $derived(nodes.find(n => isMain(n)));
  const childNodes = $derived(nodes.filter(n => !isMain(n)).sort((a, b) => a.alias.localeCompare(b.alias)));
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-white">WiFi Mesh</h1>
    <p class="text-sm text-[#8b949e]">{nodes.length} nodes &middot; {nodes.filter(n => n.online === '1').length} online</p>
  </div>

  {#if nodes.length === 0}
    <div class="text-center py-16 text-[#8b949e]">
      <Wifi size={48} strokeWidth={1} class="mx-auto mb-4 opacity-30" />
      <p>No mesh nodes detected</p>
    </div>
  {:else}
    <div class="flex justify-center">
      <div class="w-full max-w-2xl space-y-0">
        <!-- Main node -->
        {#if mainNode}
          <button class="w-full bg-[var(--color-surface-800)] border border-[var(--color-accent)] rounded-xl p-4 flex items-center gap-4 text-left hover:border-[var(--color-accent-light)] transition-colors"
            onclick={() => selectedNode = mainNode}>
            <div class="w-10 h-10 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent-light)] flex items-center justify-center flex-shrink-0">
              <Router size={20} strokeWidth={1.5} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-white flex items-center gap-2">
                {mainNode.alias}
                <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">Primary</span>
              </div>
              <div class="text-[11px] text-[#8b949e]">{mainNode.ui_model_name} &middot; <span class="font-mono">{mainNode.ip}</span></div>
            </div>
            <ChevronRight size={16} class="text-[#8b949e]" />
          </button>
        {/if}

        <!-- Child nodes -->
        <div class="ml-8 border-l-[3px] border-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.3)]">
          {#each childNodes as node, i (node.mac)}
            {@const bh = backhaulType(node)}
            {@const rssi = parseInt(node.rssi5g || node.rssi2g || '0')}
            {@const isLast = i === childNodes.length - 1}
            <div class="relative pl-8 py-1.5">
              <!-- Horizontal connector -->
              <div class="absolute left-0 top-1/2 w-8 h-[3px] rounded-full"
                style="background: {bh === 'wireless' && rssi ? qualityColor(rssi) : 'var(--color-success)'}; box-shadow: 0 0 6px {bh === 'wireless' && rssi ? qualityColor(rssi) : 'rgba(34,197,94,0.3)'}">
              </div>

              <button class="w-full bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 flex items-center gap-4 text-left hover:border-[var(--color-accent)] transition-colors"
                onclick={() => selectedNode = node}>
                <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  class:bg-[var(--color-accent-muted)]={node.online === '1'}
                  class:text-[var(--color-accent-light)]={node.online === '1'}
                  class:bg-[var(--color-surface-600)]={node.online !== '1'}
                  class:text-[#8b949e]={node.online !== '1'}>
                  <Router size={18} strokeWidth={1.5} />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-white flex items-center gap-2">
                    {node.alias}
                    {#if bh === 'wireless' && rssi}
                      <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {qualityColor(rssi)} 15%, transparent); color: {qualityColor(rssi)}">
                        {rssi >= -50 ? 'Good' : rssi >= -65 ? 'OK' : rssi >= -75 ? 'Weak' : 'Poor'}
                      </span>
                    {/if}
                  </div>
                  <div class="text-[11px] text-[#8b949e]">{node.ui_model_name} &middot; <span class="font-mono">{node.ip}</span></div>
                </div>
                <div class="flex items-center gap-2 text-xs flex-shrink-0">
                  {#if bh === 'wireless'}
                    <span class="flex items-center gap-1 font-mono" style="color: {qualityColor(rssi)}">
                      <Wifi size={12} /> {rssi} dBm
                    </span>
                  {:else}
                    <span class="flex items-center gap-1 font-mono text-[var(--color-success)]">
                      <Cable size={12} /> {linkRate(node) || 'Wired'}
                    </span>
                  {/if}
                  <ChevronRight size={16} class="text-[#8b949e]" />
                </div>
              </button>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Node detail panel -->
{#if selectedNode}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onclick={() => selectedNode = null}></div>
  <div class="fixed top-0 right-0 bottom-0 w-[400px] max-w-[90vw] bg-[var(--color-surface-900)] border-l border-[var(--color-surface-500)] z-50 flex flex-col animate-slide-in">
    <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-surface-500)]">
      <h2 class="text-lg font-semibold text-white">{selectedNode.alias}</h2>
      <button class="text-[#8b949e] hover:text-white" onclick={() => selectedNode = null}>✕</button>
    </div>
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      <div class="space-y-0">
        {#each [
          { l: 'Model', v: selectedNode.ui_model_name },
          { l: 'MAC', v: selectedNode.mac?.toUpperCase() },
          { l: 'IP', v: selectedNode.ip },
          { l: 'Firmware', v: selectedNode.fwver },
          { l: 'Product', v: selectedNode.product_id },
          { l: 'Bands', v: selectedNode.band_num },
          { l: 'Backhaul', v: backhaulType(selectedNode) === 'wireless' ? `Wireless (${selectedNode.rssi5g || selectedNode.rssi2g || '?'} dBm)` : backhaulType(selectedNode) === 'wired' ? `Ethernet ${linkRate(selectedNode)}` : 'Primary' },
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

<style>
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-slide-in { animation: slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1); }
</style>
