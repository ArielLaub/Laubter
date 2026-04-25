<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Router, Wifi, Cable, ChevronRight, X, Activity, Settings, Power, Link } from 'lucide-svelte';

  // --- Raw ASUS types ---
  interface RawNode {
    alias: string; model_name: string; ui_model_name: string; ip: string; mac: string;
    online: string; re_path: string; level: string; band_num: string; fwver: string; product_id: string;
    ap2g: string; ap5g: string; ap5g1: string; ap6g: string; apdwb: string;
    pap2g: string; pap5g: string; pap6g: string;
    rssi2g: string; rssi5g: string; rssi6g: string;
    pap5g_ssid: string; ap2g_ssid: string; ap5g_ssid: string; ap5g1_ssid: string;
    config: { backhalctrl?: { amas_ethernet?: string }; ctrl_led?: { led_val?: string }; prefer_ap?: Record<string, string> };
    wired_port: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface TopoEntry { ip: string; rssi: string; }
  type TopoData = Record<string, Record<string, Record<string, TopoEntry>>>;

  // --- Processed types ---
  interface MeshNode {
    mac: string; alias: string; model: string; ip: string; online: boolean; isMain: boolean;
    firmware: string; productId: string; bandCount: number;
    radios: { band: string; clientCount: number; ssid: string }[];
    backhaulType: 'wired' | 'wireless' | 'unknown';
    backhaulBand?: string; backhaulRssi?: number; backhaulSsid?: string;
    linkRate?: string; connectionQuality?: string;
    parentMac?: string; parentName?: string; children: string[];
    config?: { ledEnabled?: boolean; backhaulPriority?: string };
    level: number;
  }

  interface MeshClient {
    mac: string; name: string; ip: string; band?: string; signal?: number;
    connectedTo: string; connectedToName: string; isWireless: boolean;
  }

  let nodes = $state<MeshNode[]>([]);
  let clients = $state<MeshClient[]>([]);
  let ssid = $state('');
  let dhcpNames = $state(new Map<string, string>());
  let selectedNode = $state<MeshNode | null>(null);
  let panelTab = $state<'clients' | 'network' | 'management'>('clients');
  let bindLoading = $state(false);
  let bindProgress = $state(0);
  let bindMessage = $state('');

  // Connection settings
  let showConfig = $state(false);
  let configForm = $state({ host: '', port: '8443', proto: 'https', username: 'admin', password: '' });
  let configTesting = $state(false);
  let configTestResult = $state<{ ok: boolean; error?: string } | null>(null);
  let configSaving = $state(false);

  const meshStream = subscribe<{ nodes: { get_cfg_clientlist: RawNode[] }; topology: { get_allclientlist: TopoData } }>('mesh:topology');

  let lastMeshTs = 0;
  $effect(() => {
    const stream = $meshStream;
    if (stream?.nodes?.get_cfg_clientlist) {
      const ts = Date.now();
      if (ts - lastMeshTs < 1000) return; // debounce
      lastMeshTs = ts;
      const result = processTopology(stream.nodes.get_cfg_clientlist, stream.topology?.get_allclientlist ?? {});
      // Apply DHCP hostnames before setting state
      for (const c of result.clients) {
        const name = dhcpNames.get(c.mac) || dhcpNames.get(c.ip);
        if (name) c.name = name;
      }
      nodes = result.nodes;
      clients = result.clients;
    }
  });

  // --- Data transformation (ported from v1 asus.ts) ---
  function processTopology(raw: RawNode[], topo: TopoData): { nodes: MeshNode[]; clients: MeshClient[] } {
    // Build radio→node lookup
    const radioToNode = new Map<string, string>();
    const nodeAlias = new Map<string, string>();
    for (const n of raw) {
      const mac = n.mac.toLowerCase();
      nodeAlias.set(mac, n.alias || n.ui_model_name);
      for (const r of [n.ap2g, n.ap5g, n.ap5g1, n.ap6g, n.apdwb, n.mac]) {
        if (r) radioToNode.set(r.toLowerCase(), mac);
      }
    }

    // Process nodes
    const processed: MeshNode[] = raw.map(n => {
      const mac = n.mac.toLowerCase();
      const rp = parseInt(n.re_path) || 0;
      const isMain = rp === 0 && !n.pap2g && !n.pap5g && !n.pap6g;
      const bhType = rp === 0 ? 'unknown' as const : rp === 1 ? 'wired' as const : 'wireless' as const;

      // Radios with client counts
      const nodeTopo = topo[n.mac] || {};
      const radios: MeshNode['radios'] = [];
      const addRadio = (band: string, rmac: string, ssidVal: string) => {
        if (!rmac) return;
        const bandClients = nodeTopo[band] || {};
        radios.push({ band, clientCount: Object.keys(bandClients).length, ssid: ssidVal || '' });
      };
      addRadio('2G', n.ap2g, n.ap2g_ssid);
      addRadio('5G', n.ap5g, n.ap5g_ssid);
      if (n.ap5g1) addRadio('5G1', n.ap5g1, n.ap5g1_ssid);
      if (n.ap6g) addRadio('6G', n.ap6g, '');

      // Parent resolution
      let parentMac: string | undefined;
      let backhaulRssi: number | undefined;
      let backhaulSsid: string | undefined;
      let backhaulBand: string | undefined;
      if (bhType === 'wireless') {
        if (n.pap5g) { parentMac = radioToNode.get(n.pap5g.toLowerCase()); backhaulRssi = parseInt(n.rssi5g) || undefined; backhaulSsid = n.pap5g_ssid; backhaulBand = rp === 8 ? '5G1' : '5G'; }
        else if (n.pap2g) { parentMac = radioToNode.get(n.pap2g.toLowerCase()); backhaulRssi = parseInt(n.rssi2g) || undefined; backhaulBand = '2G'; }
        else if (n.pap6g) { parentMac = radioToNode.get(n.pap6g.toLowerCase()); backhaulRssi = parseInt(n.rssi6g) || undefined; backhaulBand = '6G'; }
      }

      const linkRate = (() => {
        const wp = n.wired_port as Record<string, unknown>;
        const wan = wp?.wan_port as Record<string, { link_rate?: string }> | undefined;
        if (wan) { const r = Object.values(wan)[0]?.link_rate; if (r === 'Q') return '2.5G'; if (r === 'G') return '1G'; if (r === 'M') return '100M'; }
        return undefined;
      })();

      const quality = backhaulRssi ? (backhaulRssi >= -50 ? 'good' : backhaulRssi >= -65 ? 'ok' : backhaulRssi >= -75 ? 'weak' : 'poor') : undefined;

      return {
        mac, alias: n.alias || n.ui_model_name, model: n.ui_model_name, ip: n.ip,
        online: n.online === '1', isMain, firmware: n.fwver, productId: n.product_id,
        bandCount: parseInt(n.band_num) || 0, radios, backhaulType: bhType,
        backhaulBand, backhaulRssi, backhaulSsid, linkRate, connectionQuality: quality,
        parentMac, parentName: parentMac ? nodeAlias.get(parentMac) : undefined,
        children: [], level: 0,
        config: { ledEnabled: n.config?.ctrl_led?.led_val === '1', backhaulPriority: ({ '1': 'ethernet', '2': 'wireless', '3': 'auto' } as Record<string, string>)[n.config?.backhalctrl?.amas_ethernet ?? '3'] || 'auto' }
      };
    });

    // Build tree
    const nodeMap = new Map(processed.map(n => [n.mac, n]));
    const mainNode = processed.find(n => n.isMain);
    for (const n of processed) {
      if (n.isMain) continue;
      if (!n.parentMac && mainNode) { n.parentMac = mainNode.mac; n.parentName = mainNode.alias; }
      const parent = nodeMap.get(n.parentMac!);
      if (parent) parent.children.push(n.mac);
    }
    // BFS levels
    if (mainNode) {
      const queue = [mainNode.mac];
      const visited = new Set([mainNode.mac]);
      while (queue.length) {
        const cur = queue.shift()!;
        const node = nodeMap.get(cur)!;
        for (const childMac of node.children) {
          if (visited.has(childMac)) continue;
          visited.add(childMac);
          const child = nodeMap.get(childMac);
          if (child) { child.level = node.level + 1; queue.push(childMac); }
        }
      }
    }

    // Build client list from topology
    const meshClients: MeshClient[] = [];
    const nodeStaMacs = new Set(raw.flatMap(n => [n.mac, n.ap2g, n.ap5g, n.ap5g1, n.ap6g, n.apdwb].filter(Boolean).map(m => m.toLowerCase())));
    for (const [nodeMac, bands] of Object.entries(topo)) {
      for (const [band, cls] of Object.entries(bands)) {
        if (band === 'wired_mac') continue;
        for (const [clientMac, info] of Object.entries(cls)) {
          const cm = clientMac.toLowerCase();
          if (nodeStaMacs.has(cm)) continue;
          meshClients.push({
            mac: cm, name: clientMac, ip: info.ip || '', band, signal: parseInt(info.rssi) || undefined,
            connectedTo: nodeMac.toLowerCase(), connectedToName: nodeAlias.get(nodeMac.toLowerCase()) || nodeMac,
            isWireless: true
          });
        }
      }
    }

    return { nodes: processed, clients: meshClients };
  }

  // --- Helpers ---
  function getChildren(parentMac: string): MeshNode[] {
    return nodes.filter(n => n.parentMac === parentMac && !n.isMain).sort((a, b) => a.alias.localeCompare(b.alias));
  }

  function clientsForNode(mac: string): number {
    return clients.filter(c => c.connectedTo === mac).length;
  }

  function clientsOfNode(mac: string): MeshClient[] {
    return clients.filter(c => c.connectedTo === mac);
  }

  function qualityColor(q?: string): string {
    return q === 'good' ? '#22c55e' : q === 'ok' ? '#3b82f6' : q === 'weak' ? '#f59e0b' : q === 'poor' ? '#ef4444' : '#8b949e';
  }

  function qualityLabel(q?: string): string {
    return q === 'good' ? 'Good' : q === 'ok' ? 'OK' : q === 'weak' ? 'Weak' : q === 'poor' ? 'Poor' : '';
  }

  function linkColor(n: MeshNode): string {
    if (n.backhaulType === 'wireless') return qualityColor(n.connectionQuality);
    return '#22c55e';
  }

  // --- Config management ---
  let configured = $state(true); // assume configured until proven otherwise

  async function loadConfig() {
    try {
      const cfg = await api<{ host: string; inCooldown: boolean }>('/api/mesh/config');
      if (cfg.host) {
        // Parse URL to get parts
        try {
          const url = new URL(cfg.host);
          configForm.host = url.hostname;
          configForm.port = url.port || '8443';
          configForm.proto = url.protocol.replace(':', '') as 'https' | 'http';
        } catch {
          configForm.host = cfg.host;
        }
        configured = true;
      } else {
        configured = false;
        showConfig = true;
      }
    } catch {
      configured = false;
      showConfig = true;
    }
  }

  async function testConfig() {
    configTesting = true;
    configTestResult = null;
    try {
      configTestResult = await api<{ ok: boolean; error?: string }>('/api/mesh/test', { method: 'POST' });
    } catch (e) {
      configTestResult = { ok: false, error: String(e) };
    }
    configTesting = false;
  }

  async function saveConfig() {
    configSaving = true;
    try {
      // Save via UCI (the mesh plugin reads from laubter.mesh.*)
      await api('/api/mesh/configure', { method: 'POST', body: JSON.stringify({
        host: configForm.host, port: configForm.port, proto: configForm.proto,
        username: configForm.username, password: configForm.password
      })});
      showConfig = false;
      configured = true;
      // Reload topology
      location.reload();
    } catch (e) {
      alert(`Save failed: ${e}`);
    }
    configSaving = false;
  }

  function linkLabel(n: MeshNode): string {
    if (n.backhaulType === 'wireless') {
      const parts: string[] = [];
      if (n.backhaulBand) parts.push(n.backhaulBand);
      if (n.backhaulRssi) parts.push(`${n.backhaulRssi} dBm`);
      return parts.join(' ') || 'Wireless';
    }
    return n.linkRate || 'Wired';
  }

  function bandColor(band: string): string {
    if (band === '5G' || band === '5G1') return '#22c55e';
    if (band === '6G') return '#a354e3';
    return '#006fff';
  }

  async function bindClient(clientMac: string, targetMac: string) {
    bindLoading = true; bindProgress = 0; bindMessage = 'Applying binding...';
    try {
      await api('/api/mesh/bind', { method: 'POST', body: JSON.stringify({ client_mac: clientMac, target_mac: targetMac }) });
      for (let i = 1; i <= 12; i++) {
        await new Promise(r => setTimeout(r, 1000));
        bindProgress = Math.round((i / 12) * 100);
        if (i === 3) bindMessage = 'Waiting for mesh sync...';
        if (i === 8) bindMessage = 'Refreshing topology...';
      }
      bindMessage = 'Done!';
      await new Promise(r => setTimeout(r, 500));
    } catch (e) { bindMessage = `Error: ${e}`; await new Promise(r => setTimeout(r, 2000)); }
    bindLoading = false;
  }

  const mainNode = $derived(nodes.find(n => n.isMain));
  const onlineCount = $derived(nodes.filter(n => n.online).length);
  const totalClients = $derived(clients.length);

  function resolveClientNames() {
    // Apply DHCP hostnames to mesh clients
    for (const c of clients) {
      const name = dhcpNames.get(c.mac) || dhcpNames.get(c.ip);
      if (name) c.name = name;
    }
    clients = [...clients]; // trigger reactivity
  }

  onMount(async () => {
    await loadConfig();
    const [data, leases, staticHosts] = await Promise.all([
      api<{ nodes: { get_cfg_clientlist: RawNode[] }; clients: any; topology: { get_allclientlist: TopoData }; info: Record<string, string> }>('/api/mesh/topology').catch(() => null),
      api<{ mac: string; ip: string; hostname: string }[]>('/api/dhcp/leases').catch(() => []),
      api<Record<string, string | string[]>[]>('/api/dhcp/hosts').catch(() => [])
    ]);

    // Build DHCP name lookup from both active leases and static hosts
    const nameMap = new Map<string, string>();
    for (const h of staticHosts) {
      const name = h.name as string;
      if (!name) continue;
      const mac = Array.isArray(h.mac) ? h.mac[0] : h.mac as string;
      if (mac) nameMap.set(mac.toLowerCase(), name);
      if (h.ip) nameMap.set(h.ip as string, name);
    }
    for (const l of leases) {
      if (l.hostname) {
        nameMap.set(l.mac?.toLowerCase(), l.hostname);
        nameMap.set(l.ip, l.hostname);
      }
    }
    dhcpNames = nameMap;

    if (data?.nodes?.get_cfg_clientlist) {
      const result = processTopology(data.nodes.get_cfg_clientlist, data.topology?.get_allclientlist ?? {});
      nodes = result.nodes; clients = result.clients;
      ssid = data.info?.wl0_ssid ?? '';
      resolveClientNames();
      // Select main node by default
      if (!selectedNode && nodes.length > 0) {
        selectedNode = nodes.find(n => n.isMainNode) ?? nodes[0];
      }
    }
  });
</script>

<div class="space-y-6">
  <!-- Hero -->
  <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
    <div class="flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-[var(--color-accent-muted)] text-[var(--color-accent-light)] flex items-center justify-center flex-shrink-0">
        <Wifi size={24} strokeWidth={1.75} />
      </div>
      <div>
        <h1 class="text-xl sm:text-2xl font-extrabold text-white tracking-tight">{ssid || 'Mesh Network'}</h1>
        <span class="text-sm text-[#8b949e]">ASUS AiMesh</span>
      </div>
    </div>
    <div class="flex items-center gap-6">
      {#each [
        { v: nodes.length, l: 'Nodes' },
        { v: onlineCount, l: 'Online', accent: true },
        { v: totalClients, l: 'WiFi Clients' }
      ] as stat}
        <div class="text-center">
          <div class="text-2xl font-extrabold font-mono {stat.accent ? 'text-[var(--color-success)]' : 'text-white'}">{stat.v}</div>
          <div class="text-[11px] text-[#8b949e] uppercase tracking-wider">{stat.l}</div>
        </div>
      {/each}
      <button class="p-2 rounded-lg text-[#8b949e] hover:text-white hover:bg-[var(--color-surface-700)] transition-colors" title="Connection Settings"
        onclick={() => { showConfig = !showConfig; loadConfig(); }}>
        <Settings size={18} />
      </button>
    </div>
  </div>

  <!-- Connection config panel -->
  {#if showConfig}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-4">ASUS AiMesh Connection</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label class="block text-[12px] text-[#8b949e] mb-1.5">Host IP</label>
          <input class="w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)] font-mono" bind:value={configForm.host} placeholder="192.168.50.2" />
        </div>
        <div>
          <label class="block text-[12px] text-[#8b949e] mb-1.5">Port</label>
          <input class="w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)] font-mono" bind:value={configForm.port} placeholder="8443" />
        </div>
        <div>
          <label class="block text-[12px] text-[#8b949e] mb-1.5">Protocol</label>
          <select class="w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none" bind:value={configForm.proto}>
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </select>
        </div>
        <div>
          <label class="block text-[12px] text-[#8b949e] mb-1.5">Username</label>
          <input class="w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]" bind:value={configForm.username} placeholder="admin" />
        </div>
        <div>
          <label class="block text-[12px] text-[#8b949e] mb-1.5">Password</label>
          <input type="password" class="w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]" bind:value={configForm.password} placeholder="Enter password" />
        </div>
      </div>

      {#if configTestResult}
        <div class="mt-3 text-xs px-3 py-2 rounded-lg {configTestResult.ok ? 'bg-[rgba(34,197,94,0.1)] text-[#22c55e]' : 'bg-[rgba(239,68,68,0.1)] text-[#ef4444]'}">
          {configTestResult.ok ? 'Connection successful!' : `Failed: ${configTestResult.error}`}
        </div>
      {/if}

      <div class="flex gap-2 mt-4">
        <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)] transition-colors"
          onclick={testConfig} disabled={configTesting}>{configTesting ? 'Testing...' : 'Test Connection'}</button>
        <button class="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)] transition-colors"
          onclick={saveConfig} disabled={configSaving}>{configSaving ? 'Saving...' : 'Save'}</button>
        <button class="px-3 py-1.5 rounded-lg text-sm font-medium text-[#8b949e] hover:text-white transition-colors"
          onclick={() => showConfig = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Topology + Detail split -->
  {#if !configured && nodes.length === 0}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-8 text-center">
      <Settings size={48} strokeWidth={1} class="mx-auto mb-4 text-[var(--color-accent)] opacity-60" />
      <h2 class="text-lg font-semibold text-white mb-2">Configure ASUS AiMesh</h2>
      <p class="text-sm text-[#8b949e] mb-4">Connect to your ASUS router to view mesh topology, manage clients, and bind devices.</p>
      <button class="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)] transition-colors"
        onclick={() => { showConfig = true; loadConfig(); }}>
        Set Up Connection
      </button>
    </div>
  {:else if nodes.length === 0}
    <div class="text-center py-16 text-[#8b949e]">
      <Wifi size={48} strokeWidth={1} class="mx-auto mb-4 opacity-30" />
      <p>No mesh nodes detected. Check connection settings.</p>
    </div>
  {:else if mainNode}
    <div class="flex flex-col lg:flex-row gap-6">
      <!-- Left: Topology tree -->
      <div class="flex-1 min-w-0">

        {#snippet nodeCard(node: MeshNode, isMain: boolean)}
          {@const count = clientsForNode(node.mac)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-xl border transition-all cursor-pointer
            {isMain ? 'bg-gradient-to-r from-[var(--color-surface-800)] to-[rgba(0,111,255,0.06)] border-[var(--color-accent)]' : 'bg-[var(--color-surface-800)] border-[var(--color-surface-500)] hover:border-[var(--color-accent)]'}"
            onclick={() => { selectedNode = node; panelTab = 'clients'; }}>
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                {node.online ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}">
                <Router size={isMain ? 22 : 18} strokeWidth={1.5} />
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-white flex items-center gap-2 flex-wrap">
                  {node.alias}
                  {#if isMain}<span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">Primary</span>{/if}
                  {#if node.connectionQuality && node.backhaulType === 'wireless'}
                    <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style="background: color-mix(in srgb, {qualityColor(node.connectionQuality)} 15%, transparent); color: {qualityColor(node.connectionQuality)}">{qualityLabel(node.connectionQuality)}</span>
                  {/if}
                </div>
                <div class="text-[11px] text-[#8b949e] truncate">{node.model} &middot; <span class="font-mono">{node.ip}</span></div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap sm:ml-auto sm:justify-end pl-13 sm:pl-0">
              {#each node.radios as radio}
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background: color-mix(in srgb, {bandColor(radio.band)} 15%, transparent); color: {bandColor(radio.band)}">{radio.band} {radio.clientCount}</span>
              {/each}
              <span class="text-[11px] text-[#8b949e]"><Wifi size={11} class="inline" /> {count}</span>
              {#if !isMain}
                <span class="text-[10px] font-bold font-mono flex items-center gap-1" style="color: {linkColor(node)}">
                  {#if node.backhaulType === 'wireless'}<Wifi size={10} />{:else}<Cable size={10} />{/if}
                  {linkLabel(node)}
                </span>
              {/if}
              <ChevronRight size={14} class="text-[#8b949e] hidden sm:block" />
            </div>
          </div>
        {/snippet}

        {#snippet nodeTree(parentMac: string)}
          {#each getChildren(parentMac) as node, i (node.mac)}
            {@const isLast = i === getChildren(parentMac).length - 1}
            <div class="relative pl-9 pt-2">
              <!-- Vertical trunk -->
              <div class="absolute left-0 top-0 w-[3px] rounded-sm" style="background: {linkColor(node)}; box-shadow: 0 0 6px {linkColor(node)}40; {isLast ? `height: calc(50% + 6px)` : 'bottom: 0'}"
                class:bottom-0={!isLast}></div>
              <!-- Horizontal connector on node -->
              <div class="node-connector" style="--lc: {linkColor(node)}">
                {@render nodeCard(node, false)}
              </div>
              {#if node.children.length > 0}
                <div class="ml-8">
                  {@render nodeTree(node.mac)}
                </div>
              {/if}
            </div>
          {/each}
        {/snippet}

        {@render nodeCard(mainNode, true)}
        <div class="ml-8">
          {@render nodeTree(mainNode.mac)}
        </div>
      </div>

      <!-- Right: Detail panel (static, not modal) -->
      <div class="w-full lg:w-[380px] flex-shrink-0">
        {#if selectedNode}
          <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl flex flex-col sticky top-4">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-surface-500)]">
      <div>
        <h2 class="text-lg font-semibold text-white">{selectedNode.alias}</h2>
        <div class="text-xs text-[#8b949e]">{selectedNode.model} &middot; {selectedNode.mac.toLowerCase()}</div>
      </div>
      <button class="p-1 text-[#8b949e] hover:text-white rounded-lg hover:bg-[var(--color-surface-700)]" onclick={() => selectedNode = null}><X size={18} /></button>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-[var(--color-surface-500)]">
      {#each [
        { id: 'clients', label: 'Clients', icon: Wifi },
        { id: 'network', label: 'Network', icon: Activity },
        ...(!selectedNode.isMain ? [{ id: 'management', label: 'Manage', icon: Settings }] : [])
      ] as tab}
        <button class="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors
          {panelTab === tab.id ? 'text-[var(--color-accent-light)] border-[var(--color-accent)]' : 'text-[#8b949e] border-transparent hover:text-white'}"
          onclick={() => panelTab = tab.id as typeof panelTab}>
          <tab.icon size={13} /> {tab.label}
        </button>
      {/each}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      {#if panelTab === 'clients'}
        {@const nc = clientsOfNode(selectedNode.mac)}
        <div class="flex items-center justify-between text-xs text-[#8b949e] uppercase tracking-wider">
          <span>Client List</span>
          <span>{nc.length} connected</span>
        </div>
        {#if nc.length === 0}
          <div class="py-8 text-center text-[#8b949e] text-sm">No clients connected</div>
        {:else}
          <div class="space-y-1">
            {#each nc as client (client.mac)}
              <div class="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-surface-800)] border border-[var(--color-surface-600)]">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-white truncate">{client.name}</div>
                  <div class="text-[10px] text-[#8b949e] font-mono">{client.mac.toLowerCase()} &middot; {client.ip || 'no IP'}</div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  {#if client.band}
                    <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style="background: color-mix(in srgb, {bandColor(client.band)} 15%, transparent); color: {bandColor(client.band)}">{client.band}</span>
                  {/if}
                  {#if client.signal}
                    <span class="text-[10px] font-mono text-[#8b949e]">{client.signal} dBm</span>
                  {/if}
                  <button class="p-1 text-[#8b949e] hover:text-[var(--color-accent-light)] transition-colors" title="Bind to {selectedNode?.alias}"
                    onclick={() => selectedNode && bindClient(client.mac, selectedNode.mac)}>
                    <Link size={12} />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

      {:else if panelTab === 'network'}
        <div class="space-y-0">
          {#if !selectedNode.isMain}
            <div class="text-xs text-[#8b949e] uppercase tracking-wider mb-2">Uplink</div>
            <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
              <span class="text-[13px] text-[#8b949e]">Type</span>
              <span class="text-[13px] font-semibold" style="color: {selectedNode.backhaulType === 'wireless' ? qualityColor(selectedNode.connectionQuality) : '#3b82f6'}">
                {selectedNode.backhaulType === 'wireless' ? `Wireless ${selectedNode.backhaulBand || ''}` : `Ethernet ${selectedNode.linkRate || ''}`}
              </span>
            </div>
            {#if selectedNode.parentName}
              <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
                <span class="text-[13px] text-[#8b949e]">Connected Through</span>
                <span class="text-[13px] text-white">{selectedNode.parentName}</span>
              </div>
            {/if}
            {#if selectedNode.backhaulRssi}
              <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
                <span class="text-[13px] text-[#8b949e]">Backhaul RSSI</span>
                <span class="text-[13px] font-mono" style="color: {qualityColor(selectedNode.connectionQuality)}">{selectedNode.backhaulRssi} dBm ({qualityLabel(selectedNode.connectionQuality)})</span>
              </div>
            {/if}
          {/if}

          <div class="text-xs text-[#8b949e] uppercase tracking-wider mt-4 mb-2">Radios</div>
          {#each selectedNode.radios as radio}
            <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
              <span class="text-[13px] text-[#8b949e] flex items-center gap-2">
                <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background: color-mix(in srgb, {bandColor(radio.band)} 15%, transparent); color: {bandColor(radio.band)}">{radio.band}</span>
                {radio.ssid}
              </span>
              <span class="text-[13px] text-white">{radio.clientCount} clients</span>
            </div>
          {/each}

          <div class="text-xs text-[#8b949e] uppercase tracking-wider mt-4 mb-2">Device</div>
          {#each [
            { l: 'Model', v: selectedNode.model },
            { l: 'Product', v: selectedNode.productId },
            { l: 'Firmware', v: selectedNode.firmware },
            { l: 'Bands', v: String(selectedNode.bandCount) },
            { l: 'IP', v: selectedNode.ip },
          ] as row}
            <div class="flex justify-between py-2.5 border-b border-[var(--color-surface-600)]">
              <span class="text-[13px] text-[#8b949e]">{row.l}</span>
              <span class="text-[13px] text-white font-mono">{row.v}</span>
            </div>
          {/each}
        </div>

      {:else if panelTab === 'management'}
        <div class="space-y-4">
          <div class="flex items-center justify-between py-3 border-b border-[var(--color-surface-600)]">
            <span class="text-sm text-white">LED</span>
            <div class="w-10 h-5 rounded-full transition-colors relative {selectedNode.config?.ledEnabled ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}">
              <span class="absolute top-0.5 w-4 h-4 rounded-full transition-all {selectedNode.config?.ledEnabled ? 'left-5 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
            </div>
          </div>
          <div class="flex items-center justify-between py-3 border-b border-[var(--color-surface-600)]">
            <span class="text-sm text-white">Backhaul Priority</span>
            <span class="text-sm text-[#8b949e] capitalize">{selectedNode.config?.backhaulPriority || 'auto'}</span>
          </div>
        </div>
      {/if}
    </div>
          </div>
        {:else}
          <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-8 text-center text-[#8b949e] text-sm hidden lg:block">
            <Router size={32} strokeWidth={1} class="mx-auto mb-3 opacity-30" />
            <p>Select a node to view details</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Bind progress modal -->
{#if bindLoading}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center">
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-8 w-80 text-center">
      <div class="w-14 h-14 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent-light)] flex items-center justify-center mx-auto mb-4" style="animation: pulse 1.5s ease-in-out infinite">
        <Wifi size={28} strokeWidth={1.5} />
      </div>
      <div class="text-sm text-white font-medium mb-3">{bindMessage}</div>
      <div class="w-full h-1.5 bg-[var(--color-surface-600)] rounded-full overflow-hidden">
        <div class="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500" style="width: {bindProgress}%"></div>
      </div>
      <div class="text-[11px] text-[#8b949e] mt-2 font-mono">{bindProgress}%</div>
    </div>
  </div>
{/if}

<style>
  @keyframes pulse { 0%, 100% { opacity: 0.7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
  .node-connector {
    position: relative;
  }
  .node-connector::before {
    content: '';
    position: absolute;
    left: -36px;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 3px;
    border-radius: 1.5px;
    background: var(--lc, #22c55e);
    box-shadow: 0 0 6px color-mix(in srgb, var(--lc, #22c55e) 40%, transparent);
  }
</style>
