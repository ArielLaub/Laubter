<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Shield, ArrowUpDown, Clock, Wifi, WifiOff } from 'lucide-svelte';

  type Section = Record<string, string | string[] | boolean | number>;

  let loading = $state(true);
  let interfaces = $state<Section[]>([]);
  let peers = $state<Section[]>([]);
  let status = $state<Record<string, unknown>>({});

  async function loadAll() {
    const [ifaces, p, s] = await Promise.all([
      api<Section[]>('/api/vpn/interfaces').catch(() => []),
      api<Section[]>('/api/vpn/peers').catch(() => []),
      api<Record<string, unknown>>('/api/vpn/status').catch(() => ({ up: false })),
    ]);
    interfaces = ifaces;
    peers = p;
    status = s;
    loading = false;
  }

  function truncateKey(key: string | undefined): string {
    if (!key) return '-';
    if (key.length <= 16) return key;
    return key.slice(0, 8) + '...' + key.slice(-8);
  }

  function formatHandshake(ts: unknown): string {
    if (!ts || ts === '0' || ts === 0) return 'Never';
    const d = new Date(typeof ts === 'string' ? parseInt(ts) * 1000 : (ts as number) * 1000);
    if (isNaN(d.getTime())) return 'Never';
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function formatBytes(bytes: unknown): string {
    if (!bytes) return '0 B';
    const b = typeof bytes === 'string' ? parseInt(bytes) : (bytes as number);
    if (isNaN(b) || b === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function getAllowedIps(peer: Section): string {
    const ips = peer.allowed_ips ?? peer.AllowedIPs ?? peer.allowedips ?? [];
    if (Array.isArray(ips)) return ips.join(', ');
    return String(ips || '-');
  }

  onMount(loadAll);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">VPN</h1>
    <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)] transition-colors"
      onclick={loadAll}>Refresh</button>
  </div>

  {#if loading}
    <div class="py-12 text-center text-[#8b949e] text-sm">Loading VPN data...</div>
  {:else}

    <!-- Interface Status Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each interfaces as iface}
        {@const isUp = status.up === true || (status['ipv4-address'] !== undefined)}
        {@const name = (iface['.name'] as string) ?? (iface.name as string) ?? 'wg0'}
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              {#if isUp}
                <Wifi size={18} class="text-[#22c55e]" />
              {:else}
                <WifiOff size={18} class="text-[#ef4444]" />
              {/if}
              <span class="text-sm font-semibold text-white uppercase">{name}</span>
            </div>
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full
              {isUp ? 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'}">
              {isUp ? 'Up' : 'Down'}
            </span>
          </div>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-[#8b949e]">Protocol</span>
              <span class="text-white font-mono text-xs">WireGuard</span>
            </div>
            {#if iface.listen_port}
              <div class="flex justify-between">
                <span class="text-[#8b949e]">Listen Port</span>
                <span class="text-white font-mono text-xs">{iface.listen_port}</span>
              </div>
            {/if}
            {#if iface.addresses}
              <div class="flex justify-between">
                <span class="text-[#8b949e]">Addresses</span>
                <span class="text-white font-mono text-xs">{Array.isArray(iface.addresses) ? iface.addresses.join(', ') : iface.addresses}</span>
              </div>
            {/if}
            {#if iface.private_key}
              <div class="flex justify-between">
                <span class="text-[#8b949e]">Private Key</span>
                <span class="text-[#8b949e] font-mono text-xs">configured</span>
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if interfaces.length === 0}
        <div class="sm:col-span-2 lg:col-span-3 bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-8 text-center text-[#8b949e] text-sm">
          No WireGuard interfaces configured
        </div>
      {/if}
    </div>

    <!-- Peers Table -->
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">Peers</h2>
        <span class="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-600)] text-[#8b949e]">{peers.length}</span>
      </div>

      {#if peers.length === 0}
        <div class="py-12 text-center text-[#8b949e] text-sm">No WireGuard peers configured</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[var(--color-surface-500)]">
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Description</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Public Key</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Allowed IPs</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Endpoint</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Last Handshake</th>
                <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Transfer</th>
              </tr>
            </thead>
            <tbody>
              {#each peers as peer (peer['.name'] ?? peer.public_key)}
                {@const desc = (peer.description as string) ?? (peer['.name'] as string) ?? '-'}
                <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02] transition-colors">
                  <td class="px-4 py-2.5 font-medium text-white">{desc}</td>
                  <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]" title={peer.public_key as string}>{truncateKey(peer.public_key as string)}</td>
                  <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{getAllowedIps(peer)}</td>
                  <td class="px-4 py-2.5 font-mono text-xs text-[#58a6ff]">{peer.endpoint_host ? `${peer.endpoint_host}:${peer.endpoint_port ?? ''}` : (peer.endpoint as string) ?? '-'}</td>
                  <td class="px-4 py-2.5 text-xs text-[#8b949e]">
                    <div class="flex items-center gap-1.5">
                      <Clock size={12} />
                      {formatHandshake(peer.latest_handshake ?? peer.last_handshake)}
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-xs text-[#8b949e]">
                    <div class="flex items-center gap-1.5">
                      <ArrowUpDown size={12} />
                      <span class="text-[#22c55e]">{formatBytes(peer.transfer_rx ?? peer.rx_bytes)}</span>
                      <span>/</span>
                      <span class="text-[#58a6ff]">{formatBytes(peer.transfer_tx ?? peer.tx_bytes)}</span>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

  {/if}
</div>
