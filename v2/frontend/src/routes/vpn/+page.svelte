<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { Wifi, WifiOff, Plus, Trash2, Download, QrCode, Copy, ChevronDown, X, RefreshCw } from 'lucide-svelte';

  interface Peer {
    section: string; description: string; publicKey: string; allowedIps: string;
    endpoint: string; latestHandshake: number; rxBytes: number; txBytes: number; online: boolean;
  }

  let loading = $state(true);
  let running = $state(false);
  let listenPort = $state('');
  let addresses = $state<string[]>([]);
  let serverPubKey = $state('');
  let peers = $state<Peer[]>([]);
  let copied = $state(false);

  // Add peer form
  let showAddPeer = $state(false);
  let peerName = $state('');
  let addingPeer = $state(false);
  let newPeer = $state<{ name: string; section: string; privateKey: string; qrSvg: string; config: string } | null>(null);

  // DDNS
  let showDdns = $state(false);
  let ddns = $state({ enabled: '0', provider: 'duckdns', domain: '', interval: '300', hasToken: '0', publicIp: '' });
  let ddnsToken = $state('');
  let ddnsTesting = $state(false);
  let ddnsTestResult = $state<{ status: string; ip?: string; domain?: string } | null>(null);
  let ddnsSaving = $state(false);

  // Delete confirmation
  let deletingPeer = $state<Peer | null>(null);

  async function loadStatus() {
    loading = true;
    try {
      const status = await api<{ running: boolean; listenPort: string; addresses: string[]; publicKey: string; peers: Peer[] }>('/api/vpn/status');
      running = status.running;
      listenPort = status.listenPort;
      addresses = status.addresses;
      serverPubKey = status.publicKey;
      peers = status.peers;
    } catch {}
    loading = false;
  }

  async function loadDdns() {
    try {
      ddns = await api<typeof ddns>('/api/vpn/ddns');
    } catch {}
  }

  async function addPeer() {
    if (!peerName.trim()) return;
    addingPeer = true;
    try {
      const result = await api<{ name: string; section: string; privateKey: string }>('/api/vpn/peers', { method: 'POST', body: JSON.stringify({ name: peerName }) });

      // Generate QR
      let qrSvg = '';
      try {
        const qr = await api<{ qr_svg_base64: string }>(`/api/vpn/peers/${result.section}/qr`);
        qrSvg = qr.qr_svg_base64;
      } catch {}

      // Get config
      let config = '';
      try {
        const cfg = await api<{ config: string }>(`/api/vpn/peers/${result.section}/config`);
        config = cfg.config;
      } catch {}

      newPeer = { name: result.name, section: result.section, privateKey: result.privateKey, qrSvg, config };
      showAddPeer = false;
      peerName = '';
      await loadStatus();
    } catch (e) {
      alert(`Failed to add peer: ${e}`);
    }
    addingPeer = false;
  }

  async function removePeer(peer: Peer) {
    try {
      await api(`/api/vpn/peers/${peer.section}`, { method: 'DELETE' });
      deletingPeer = null;
      await loadStatus();
    } catch (e) {
      alert(`Failed: ${e}`);
    }
  }

  async function downloadConfig(section: string, name: string) {
    try {
      const { config } = await api<{ config: string }>(`/api/vpn/peers/${section}/config`);
      const blob = new Blob([config], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.conf`;
      a.click();
    } catch (e) {
      alert(`Failed: ${e}`);
    }
  }

  async function showQr(section: string) {
    try {
      const { qr_svg_base64 } = await api<{ qr_svg_base64: string }>(`/api/vpn/peers/${section}/qr`);
      // Show in a simple modal
      const svg = atob(qr_svg_base64);
      const w = window.open('', '_blank', 'width=400,height=400');
      w?.document.write(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e">${svg}</body></html>`);
    } catch (e) {
      alert(`QR generation failed: ${e}`);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(serverPubKey);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  async function saveDdns() {
    ddnsSaving = true;
    const body: Record<string, string> = { enabled: ddns.enabled, provider: ddns.provider, domain: ddns.domain, interval: ddns.interval };
    if (ddnsToken) body.token = ddnsToken;
    await api('/api/vpn/ddns', { method: 'PUT', body: JSON.stringify(body) });
    ddnsSaving = false;
    await loadDdns();
  }

  async function testDdns() {
    ddnsTesting = true;
    ddnsTestResult = null;
    try {
      ddnsTestResult = await api<{ status: string; ip?: string; domain?: string }>('/api/vpn/ddns/test', { method: 'POST' });
    } catch (e) {
      ddnsTestResult = { status: 'error', ip: String(e) };
    }
    ddnsTesting = false;
  }

  function formatBytes(b: number): string {
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
    return b + ' B';
  }

  function formatHandshake(ts: number): string {
    if (!ts) return 'Never';
    const ago = Math.floor(Date.now() / 1000 - ts);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
    if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
    return `${Math.floor(ago / 86400)}d ago`;
  }

  const btn = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
  const btnPrimary = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)]`;
  const btnSecondary = `${btn} bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)]`;
  const btnDanger = `${btn} bg-[rgba(239,68,68,0.15)] text-[#ef4444] hover:bg-[rgba(239,68,68,0.25)]`;
  const input = 'w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]';
  const label = 'block text-[12px] text-[#8b949e] mb-1.5 font-medium';

  onMount(() => { loadStatus(); loadDdns(); });
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">VPN</h1>
    <button class={btnSecondary} onclick={loadStatus}><RefreshCw size={14} class="inline -mt-0.5 {loading ? 'animate-spin' : ''}" /> Refresh</button>
  </div>

  <!-- Server status -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center {running ? 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'}">
          {#if running}<Wifi size={20} />{:else}<WifiOff size={20} />{/if}
        </div>
        <div>
          <div class="font-semibold text-white">WireGuard</div>
          <div class="text-xs text-[#8b949e]">{running ? 'Running' : 'Stopped'} &middot; {peers.length} peer{peers.length !== 1 ? 's' : ''} &middot; {peers.filter(p => p.online).length} online</div>
        </div>
      </div>
      <span class="text-[11px] font-semibold px-2.5 py-1 rounded-full {running ? 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]'}">{running ? 'Up' : 'Down'}</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
      <div><span class="text-[#8b949e]">Port</span><div class="text-white font-mono mt-0.5">{listenPort || '—'}</div></div>
      <div><span class="text-[#8b949e]">Addresses</span><div class="text-white font-mono mt-0.5">{addresses.join(', ') || '—'}</div></div>
      <div>
        <span class="text-[#8b949e]">Public Key</span>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-white font-mono text-xs truncate">{serverPubKey || '—'}</span>
          {#if serverPubKey}
            <button class="text-[#8b949e] hover:text-white" onclick={copyKey} title="Copy"><Copy size={13} /></button>
            {#if copied}<span class="text-[10px] text-[#22c55e]">Copied!</span>{/if}
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Peers -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
    <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
      <h2 class="text-sm font-semibold text-white">Peers</h2>
      <button class={btnPrimary} onclick={() => { showAddPeer = true; newPeer = null; }}><Plus size={14} class="inline -mt-0.5" /> Add Peer</button>
    </div>

    {#if showAddPeer}
      <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
        <div class="flex gap-3">
          <div class="flex-1"><label class={label}>Device Name</label><input class={input} bind:value={peerName} placeholder="e.g. iPhone, Laptop" /></div>
          <div class="flex items-end gap-2">
            <button class={btnSecondary} onclick={() => showAddPeer = false}>Cancel</button>
            <button class={btnPrimary} onclick={addPeer} disabled={addingPeer || !peerName.trim()}>{addingPeer ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      </div>
    {/if}

    {#if newPeer}
      <div class="p-5 border-b border-[var(--color-surface-500)] bg-[rgba(34,197,94,0.05)]">
        <div class="flex items-start gap-4">
          {#if newPeer.qrSvg}
            <div class="w-40 h-40 bg-white rounded-lg p-2 flex-shrink-0">
              {@html atob(newPeer.qrSvg)}
            </div>
          {/if}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-[#22c55e] mb-2">Peer "{newPeer.name}" created!</div>
            <p class="text-xs text-[#8b949e] mb-3">Scan the QR code with WireGuard app, or download the config file.</p>
            <div class="flex gap-2">
              <button class={btnPrimary} onclick={() => downloadConfig(newPeer!.section, newPeer!.name)}><Download size={14} class="inline -mt-0.5" /> Download Config</button>
              <button class={btnSecondary} onclick={() => newPeer = null}>Dismiss</button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if peers.length === 0}
      <div class="py-12 text-center text-[#8b949e] text-sm">No peers configured. Add a peer to get started.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[600px]">
          <thead>
            <tr class="border-b border-[var(--color-surface-500)]">
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">IP</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Status</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Handshake</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Transfer</th>
              <th class="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {#each peers as peer (peer.section)}
              <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
                <td class="px-4 py-2.5 font-medium text-white">{peer.description || peer.section}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{peer.allowedIps}</td>
                <td class="px-4 py-2.5">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full {peer.online ? 'bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#8b949e]'}"></span>
                    <span class="text-xs {peer.online ? 'text-[#22c55e]' : 'text-[#8b949e]'}">{peer.online ? 'Online' : 'Offline'}</span>
                  </span>
                </td>
                <td class="px-4 py-2.5 text-xs text-[#8b949e]">{formatHandshake(peer.latestHandshake)}</td>
                <td class="px-4 py-2.5 font-mono text-xs">
                  <span class="text-[#58a6ff]">&darr;{formatBytes(peer.rxBytes)}</span>
                  <span class="text-[#8b949e] mx-1">/</span>
                  <span class="text-[#22c55e]">&uarr;{formatBytes(peer.txBytes)}</span>
                </td>
                <td class="px-4 py-2.5 text-right whitespace-nowrap">
                  <button class="p-1 text-[#8b949e] hover:text-white" title="QR Code" onclick={() => showQr(peer.section)}><QrCode size={14} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-white" title="Download Config" onclick={() => downloadConfig(peer.section, peer.description)}><Download size={14} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" title="Delete" onclick={() => deletingPeer = peer}><Trash2 size={14} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- DDNS -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
    <button class="w-full flex items-center justify-between px-5 py-3 text-left" onclick={() => showDdns = !showDdns}>
      <div>
        <h2 class="text-sm font-semibold text-white">Dynamic DNS</h2>
        <div class="text-xs text-[#8b949e]">{ddns.enabled === '1' ? `${ddns.domain}.duckdns.org` : 'Disabled'}</div>
      </div>
      <ChevronDown size={16} class="text-[#8b949e] transition-transform {showDdns ? 'rotate-180' : ''}" />
    </button>

    {#if showDdns}
      <div class="p-5 border-t border-[var(--color-surface-500)] space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-sm text-white">Enable DDNS</span>
          <button class="w-10 h-5 rounded-full transition-colors relative {ddns.enabled === '1' ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}"
            onclick={() => { ddns.enabled = ddns.enabled === '1' ? '0' : '1'; }}>
            <span class="absolute top-0.5 w-4 h-4 rounded-full transition-all {ddns.enabled === '1' ? 'left-5 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
          </button>
        </div>

        {#if ddns.enabled === '1'}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class={label}>Provider</label>
              <select class={input} bind:value={ddns.provider}><option value="duckdns">DuckDNS</option></select>
            </div>
            <div>
              <label class={label}>Domain</label>
              <div class="flex items-center gap-0">
                <input class="{input} rounded-r-none" bind:value={ddns.domain} placeholder="myrouter" />
                <span class="px-3 py-2 bg-[var(--color-surface-600)] border border-l-0 border-[var(--color-surface-500)] rounded-r-lg text-xs text-[#8b949e]">.duckdns.org</span>
              </div>
            </div>
            <div>
              <label class={label}>Token {ddns.hasToken === '1' ? '(configured)' : ''}</label>
              <input class="{input} font-mono text-xs" type="password" bind:value={ddnsToken} placeholder={ddns.hasToken === '1' ? '••••••••' : 'Enter DuckDNS token'} />
            </div>
            <div>
              <label class={label}>Update Interval</label>
              <select class={input} bind:value={ddns.interval}>
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
              </select>
            </div>
          </div>

          {#if ddns.publicIp}
            <div class="text-xs text-[#8b949e]">Public IP: <span class="font-mono text-white">{ddns.publicIp}</span></div>
          {/if}

          {#if ddnsTestResult}
            <div class="text-xs px-3 py-2 rounded-lg {ddnsTestResult.status === 'ok' ? 'bg-[rgba(34,197,94,0.1)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.1)] text-[#ef4444]'}">
              {ddnsTestResult.status === 'ok' ? `Success! ${ddnsTestResult.domain} → ${ddnsTestResult.ip}` : `Failed: ${ddnsTestResult.ip ?? 'unknown error'}`}
            </div>
          {/if}

          <div class="flex gap-2">
            <button class={btnSecondary} onclick={testDdns} disabled={ddnsTesting}>{ddnsTesting ? 'Testing...' : 'Test Connection'}</button>
            <button class={btnPrimary} onclick={saveDdns} disabled={ddnsSaving}>{ddnsSaving ? 'Saving...' : 'Save DDNS'}</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Delete confirmation -->
{#if deletingPeer}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onclick={() => deletingPeer = null}>
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-6 w-96 max-w-[90vw]" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-base font-semibold text-white mb-2">Delete Peer</h3>
      <p class="text-sm text-[#8b949e] mb-4">Remove <b class="text-white">{deletingPeer.description || deletingPeer.section}</b>? This cannot be undone.</p>
      <div class="flex justify-end gap-2">
        <button class={btnSecondary} onclick={() => deletingPeer = null}>Cancel</button>
        <button class={btnDanger} onclick={() => deletingPeer && removePeer(deletingPeer)}>Delete</button>
      </div>
    </div>
  </div>
{/if}
