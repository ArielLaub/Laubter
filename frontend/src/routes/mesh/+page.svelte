<script lang="ts">
	import { meshNodes, meshClients, meshSsid, meshTopology, fetchMeshTopology } from '$stores/mesh';
	import { call } from '$api/ubus';
	import { Router, Wifi, Cable, Search, Radio, Signal, Link, Unlink } from 'lucide-svelte';
	import SignalBars from '$components/shared/SignalBars.svelte';
	import DetailPanel from '$components/shared/DetailPanel.svelte';
	import type { MeshClient, MeshNode } from '$lib/mesh/types';

	let activeTab = $state<'topology' | 'clients'>('topology');
	let searchQuery = $state('');
	let sortColumn = $state<string>('signal');
	let sortAsc = $state(false);
	let selectedClient = $state<MeshClient | null>(null);
	let panelOpen = $state(false);
	let selectedNodeFilter = $state<string | null>(null);

	const provider = $derived($meshTopology?.provider ?? 'mesh');
	const providerLabel = $derived(
		provider === 'asus' ? 'ASUS AiMesh' : provider.charAt(0).toUpperCase() + provider.slice(1)
	);
	const onlineNodes = $derived($meshNodes.filter((n) => n.online).length);

	// Only wireless clients
	const wirelessClients = $derived($meshClients.filter((c) => c.isWireless && c.isOnline));
	const totalWireless = $derived(wirelessClients.length);

	// Sort nodes: main first, then by level
	const sortedNodes = $derived.by(() =>
		[...$meshNodes].sort((a, b) => {
			if (a.isMainNode) return -1;
			if (b.isMainNode) return 1;
			return a.level - b.level;
		})
	);

	// Get clients per node for the topology cards
	function clientsForNode(node: MeshNode): number {
		return wirelessClients.filter((c) => c.connectedTo === node.mac.toLowerCase()).length;
	}

	// Filtered + sorted wireless client list
	const filtered = $derived.by(() => {
		let list = wirelessClients;

		if (selectedNodeFilter) {
			list = list.filter((c) => c.connectedTo === selectedNodeFilter);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(
				(c) =>
					c.name.toLowerCase().includes(q) ||
					c.ip.toLowerCase().includes(q) ||
					c.mac.toLowerCase().includes(q) ||
					c.connectedToName.toLowerCase().includes(q)
			);
		}

		return list;
	});

	const sorted = $derived.by(() => {
		const list = [...filtered];
		const dir = sortAsc ? 1 : -1;
		list.sort((a, b) => {
			switch (sortColumn) {
				case 'name': return dir * a.name.localeCompare(b.name);
				case 'ip': return dir * a.ip.localeCompare(b.ip, undefined, { numeric: true });
				case 'band': return dir * ((a.band ?? '').localeCompare(b.band ?? ''));
				case 'signal': return dir * ((a.signal ?? -999) - (b.signal ?? -999));
				case 'speed': return dir * ((a.txRate ?? 0) - (b.txRate ?? 0));
				case 'node': return dir * a.connectedToName.localeCompare(b.connectedToName);
				default: return 0;
			}
		});
		return list;
	});

	function toggleSort(col: string) {
		if (sortColumn === col) { sortAsc = !sortAsc; }
		else { sortColumn = col; sortAsc = col === 'name'; }
	}

	function sortIcon(col: string): string {
		if (sortColumn !== col) return '';
		return sortAsc ? ' ▲' : ' ▼';
	}

	function formatRate(mbps: number | undefined): string {
		if (!mbps) return '—';
		if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
		return `${mbps} Mbps`;
	}

	function bandColor(band: string): string {
		if (band === '5G' || band === '5G1') return '#22c55e';
		if (band === '6G') return '#a354e3';
		return '#006fff';
	}

	function linkColor(rate?: string): string {
		// Green = 1G+, Orange = 100M, Red = disconnected
		if (!rate) return '#ef4444'; // red — unknown/disconnected
		if (rate === 'Q') return '#22c55e'; // green — 2.5G
		if (rate === 'G') return '#22c55e'; // green — 1G
		if (rate === 'M') return '#f59e0b'; // orange — 100M
		return '#ef4444'; // red — unknown
	}

	function linkLabel(rate?: string): string {
		if (!rate) return '';
		if (rate === 'Q') return '2.5G';
		if (rate === 'G') return '1G';
		if (rate === 'M') return '100M';
		return rate;
	}

	function selectNode(mac: string) {
		const current = selectedNodeFilter === mac;
		if (current) {
			selectedNodeFilter = null;
		} else {
			selectedNodeFilter = mac;
			activeTab = 'clients';
		}
	}

	let bindingClient = $state<MeshClient | null>(null);
	let bindTargetNode = $state('');
	let bindLoading = $state(false);

	function startBind(client: MeshClient) {
		bindingClient = client;
		bindTargetNode = client.boundToMac || '';
	}

	async function confirmBind() {
		if (!bindingClient) return;
		bindLoading = true;
		try {
			await call('laubter-mesh', 'bind_client', {
				client_mac: bindingClient.mac.toUpperCase(),
				target_mac: bindTargetNode || '',
				band: '0'
			});
			bindingClient = null;
			// Refresh data
			setTimeout(() => fetchMeshTopology(), 2000);
		} catch (e) {
			console.error('Bind failed:', e);
		} finally {
			bindLoading = false;
		}
	}

	function openClientDetail(client: MeshClient) {
		selectedClient = client;
		panelOpen = true;
	}
</script>

<div class="mesh-page">
	<!-- Hero overview -->
	<div class="hero">
		<div class="hero-left">
			<div class="hero-icon">
				<Wifi size={24} strokeWidth={1.75} />
			</div>
			<div>
				<h1 class="hero-ssid">{$meshSsid || 'Mesh Network'}</h1>
				<span class="hero-provider">{providerLabel}</span>
			</div>
		</div>
		<div class="hero-stats">
			<div class="hero-stat">
				<span class="hero-stat-value">{$meshNodes.length}</span>
				<span class="hero-stat-label">Nodes</span>
			</div>
			<div class="hero-stat-divider"></div>
			<div class="hero-stat">
				<span class="hero-stat-value accent">{onlineNodes}</span>
				<span class="hero-stat-label">Online</span>
			</div>
			<div class="hero-stat-divider"></div>
			<div class="hero-stat">
				<span class="hero-stat-value">{totalWireless}</span>
				<span class="hero-stat-label">WiFi Clients</span>
			</div>
		</div>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'topology'} onclick={() => activeTab = 'topology'}>
			Topology <span class="tab-badge">{$meshNodes.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'clients'} onclick={() => activeTab = 'clients'}>
			Wireless Clients <span class="tab-badge">{totalWireless}</span>
		</button>
	</div>

	{#if activeTab === 'topology'}
	<!-- Topology tree -->
	<section class="topo-section">

		{#if sortedNodes.length === 0}
			<div class="topo-empty">
				<Radio size={32} strokeWidth={1.5} />
				<p>No mesh nodes detected. Check mesh settings.</p>
			</div>
		{:else}
			{@const mainNode = sortedNodes.find(n => n.isMainNode)}
			{@const childNodes = sortedNodes.filter(n => !n.isMainNode)}

			<div class="topo-centered">
				<div class="tree-panel">
					{#if mainNode}
						{@const mainCount = clientsForNode(mainNode)}
						{@const mainFiltered = selectedNodeFilter === mainNode.mac.toLowerCase()}

						<!-- Primary node -->
						<button class="tree-node main" class:active={mainFiltered}
							onclick={() => selectNode(mainNode.mac.toLowerCase())}>
							<div class="tn-icon online"><Router size={22} strokeWidth={1.5} /></div>
							<div class="tn-led on"></div>
							<div class="tn-body">
								<span class="tn-name">{mainNode.alias} <span class="tn-badge primary">Primary</span></span>
								<span class="tn-detail">{mainNode.model} &middot; <span class="mono">{mainNode.ip}</span></span>
							</div>
							<div class="tn-stats">
								{#each mainNode.radios as radio}
									<span class="tn-radio" style="--bc: {bandColor(radio.band)}">{radio.band} <b>{radio.clientCount}</b></span>
								{/each}
								<span class="tn-clients"><Wifi size={11} /> {mainCount}</span>
							</div>
						</button>

						<!-- Child nodes branching from primary -->
						{#each childNodes as node, i (node.id)}
							{@const count = clientsForNode(node)}
							{@const isFiltered = selectedNodeFilter === node.mac.toLowerCase()}
							{@const isLast = i === childNodes.length - 1}
							<div class="tree-branch" class:last={isLast} style="--link-color: {linkColor(node.linkRate)}">
								<button class="tree-node child" class:active={isFiltered}
									onclick={() => selectNode(node.mac.toLowerCase())}>
									<div class="tn-icon" class:online={node.online}><Router size={20} strokeWidth={1.5} /></div>
									<div class="tn-led" class:on={node.online}></div>
									<div class="tn-body">
										<span class="tn-name">{node.alias}</span>
										<span class="tn-detail">{node.model} &middot; <span class="mono">{node.ip}</span></span>
									</div>
									<div class="tn-stats">
										{#each node.radios as radio}
											<span class="tn-radio" style="--bc: {bandColor(radio.band)}">{radio.band} <b>{radio.clientCount}</b></span>
										{/each}
										<span class="tn-clients"><Wifi size={11} /> {count}</span>
										<span class="tn-link" style="color: {linkColor(node.linkRate)}">{linkLabel(node.linkRate) || '?'}</span>
									</div>
								</button>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</section>

	{:else}
	<!-- Wireless client table -->
	<section class="client-section">
		<div class="section-header">
			<h2 class="section-heading">
				Wireless Clients
				<span class="count-badge">{filtered.length}</span>
			</h2>
			{#if selectedNodeFilter}
				{@const nodeName = $meshNodes.find(n => n.mac.toLowerCase() === selectedNodeFilter)?.alias ?? ''}
				<button class="filter-tag" onclick={() => { selectedNodeFilter = null; }}>
					Showing: {nodeName} &times;
				</button>
			{/if}
		</div>

		<div class="toolbar">
			<div class="search-box">
				<Search size={15} />
				<input type="text" placeholder="Search clients..." bind:value={searchQuery} />
			</div>
		</div>

		<div class="table-card">
			<table>
				<thead>
					<tr>
						<th onclick={() => toggleSort('name')}>Client{sortIcon('name')}</th>
						<th onclick={() => toggleSort('ip')}>IP{sortIcon('ip')}</th>
						<th onclick={() => toggleSort('band')}>Band{sortIcon('band')}</th>
						<th onclick={() => toggleSort('signal')}>Signal{sortIcon('signal')}</th>
						<th onclick={() => toggleSort('speed')}>Speed{sortIcon('speed')}</th>
						<th onclick={() => toggleSort('node')}>Mesh Node{sortIcon('node')}</th>
						<th>Bound</th>
						<th>Uptime</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as client, i (client.mac)}
						<tr class="client-row" onclick={() => openClientDetail(client)}>
							<td class="name-cell">
								<span class="led" class:on={client.isOnline}></span>
								<div>
									<span class="client-name">{client.name}</span>
									{#if client.vendor}
										<span class="client-vendor">{client.vendor}</span>
									{/if}
								</div>
							</td>
							<td class="mono">{client.ip}</td>
							<td>
								{#if client.band}
									<span class="band-pill" style="--band-color: {bandColor(client.band)}">{client.band}</span>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td>
								{#if client.signal != null}
									<SignalBars signal={client.signal} showValue={true} />
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="mono speed-cell">
								{#if client.txRate}
									<span class="tx">{formatRate(client.txRate)}</span>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="node-cell">{client.connectedToName || '—'}</td>
							<td class="bound-cell">
								{#if client.boundToName}
									<span class="bound-badge" title="Bound to {client.boundToName}">
										<Link size={11} /> {client.boundToName}
									</span>
								{/if}
								<button class="bind-btn" title={client.boundToMac ? 'Change/Unbind' : 'Bind to node'} onclick={(e) => { e.stopPropagation(); startBind(client); }}>
									{#if client.boundToMac}<Unlink size={12} />{:else}<Link size={12} />{/if}
								</button>
							</td>
							<td class="mono">{client.connectTime || '—'}</td>
						</tr>
					{:else}
						<tr><td colspan="8" class="empty">No wireless clients {selectedNodeFilter ? 'on this node' : 'found'}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
	{/if}
</div>

<!-- Detail panel -->
<DetailPanel open={panelOpen} title={selectedClient?.name || 'Client'} onClose={() => { panelOpen = false; }}>
	{#if selectedClient}
		<div class="dp">
			<div class="dp-row"><span class="dp-l">IP Address</span><span class="dp-v mono">{selectedClient.ip}</span></div>
			<div class="dp-row"><span class="dp-l">MAC</span><span class="dp-v mono">{selectedClient.mac}</span></div>
			{#if selectedClient.vendor}<div class="dp-row"><span class="dp-l">Vendor</span><span class="dp-v">{selectedClient.vendor}</span></div>{/if}
			<div class="dp-row"><span class="dp-l">Band</span><span class="dp-v">{#if selectedClient.band}<span class="band-pill" style="--band-color: {bandColor(selectedClient.band)}">{selectedClient.band}</span>{:else}—{/if}</span></div>
			{#if selectedClient.signal != null}<div class="dp-row"><span class="dp-l">Signal</span><span class="dp-v">{selectedClient.signal} dBm</span></div>{/if}
			<div class="dp-row"><span class="dp-l">Mesh Node</span><span class="dp-v">{selectedClient.connectedToName}</span></div>
			{#if selectedClient.txRate}<div class="dp-row"><span class="dp-l">TX Rate</span><span class="dp-v mono">{formatRate(selectedClient.txRate)}</span></div>{/if}
			{#if selectedClient.rxRate}<div class="dp-row"><span class="dp-l">RX Rate</span><span class="dp-v mono">{formatRate(selectedClient.rxRate)}</span></div>{/if}
			{#if selectedClient.connectTime}<div class="dp-row"><span class="dp-l">Connected</span><span class="dp-v mono">{selectedClient.connectTime}</span></div>{/if}
		</div>
	{/if}
</DetailPanel>

<!-- Bind modal -->
{#if bindingClient}
	<div class="modal-backdrop" role="presentation" onclick={() => { bindingClient = null; }}>
		<div class="modal-card" role="dialog" onclick={(e) => e.stopPropagation()}>
			<h3 class="modal-title">Bind Client to Node</h3>
			<p class="modal-sub">Assign <b>{bindingClient.name}</b> ({bindingClient.mac}) to a specific mesh node.</p>

			<div class="bind-form">
				<label class="bind-label">Target Node</label>
				<select class="bind-select" bind:value={bindTargetNode}>
					<option value="">None (Auto-roaming)</option>
					{#each $meshNodes as node}
						<option value={node.mac.toUpperCase()}>{node.alias} ({node.ip})</option>
					{/each}
				</select>
			</div>

			<div class="modal-actions">
				<button class="btn-secondary" onclick={() => { bindingClient = null; }}>Cancel</button>
				<button class="btn-primary" onclick={confirmBind} disabled={bindLoading}>
					{bindLoading ? 'Applying...' : bindTargetNode ? 'Bind' : 'Unbind'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.mesh-page { display: flex; flex-direction: column; gap: 28px; max-width: 1400px; }

	/* ── Hero ── */
	.hero {
		background: linear-gradient(135deg, var(--color-surface-800) 0%, rgba(0,111,255,0.06) 100%);
		border: 1px solid var(--color-surface-500);
		border-radius: 14px;
		padding: 28px 32px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.hero-left { display: flex; align-items: center; gap: 16px; }
	.hero-icon {
		width: 52px; height: 52px; border-radius: 14px;
		background: var(--color-accent-muted); color: var(--color-accent-light);
		display: flex; align-items: center; justify-content: center;
	}
	.hero-ssid { font-size: 26px; font-weight: 800; color: var(--color-text-primary); margin: 0; letter-spacing: -0.5px; }
	.hero-provider { font-size: 13px; color: var(--color-text-muted); }
	.hero-stats { display: flex; align-items: center; gap: 28px; }
	.hero-stat { text-align: center; }
	.hero-stat-value { display: block; font-size: 28px; font-weight: 800; color: var(--color-text-primary); line-height: 1; font-family: var(--font-mono); }
	.hero-stat-value.accent { color: var(--color-success); }
	.hero-stat-label { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; display: block; }
	.hero-stat-divider { width: 1px; height: 36px; background: var(--color-surface-500); }

	/* ── Tabs ── */
	.tabs { display: flex; gap: 0; border-bottom: 2px solid var(--color-surface-500); }
	.tab {
		padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent;
		margin-bottom: -2px; color: var(--color-text-muted); font-size: 14px; font-weight: 500;
		cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 8px;
		font-family: inherit;
	}
	.tab:hover { color: var(--color-text-primary); }
	.tab.active { color: var(--color-accent-light); border-bottom-color: var(--color-accent); }
	.tab-badge {
		font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px;
		background: var(--color-surface-600); color: var(--color-text-secondary);
	}
	.tab.active .tab-badge { background: var(--color-accent-muted); color: var(--color-accent-light); }

	/* ── Topology — Centered tree ── */
	.section-heading { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }

	.topo-centered { display: flex; justify-content: center; }
	.tree-panel { width: 70%; max-width: 800px; }

	/* Tree panel */
	.tree-panel { display: flex; flex-direction: column; gap: 6px; }

	.tree-node {
		display: flex; align-items: center; gap: 12px; position: relative;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 10px 14px; width: 100%;
		cursor: pointer; transition: all 0.15s ease;
		font-family: inherit; color: inherit; text-align: left;
	}
	.tree-node:hover { border-color: var(--color-accent); }
	.tree-node.main {
		border-color: var(--color-accent);
		background: linear-gradient(135deg, var(--color-surface-800) 0%, rgba(0,111,255,0.06) 100%);
		position: relative; margin-bottom: 6px;
	}
	/* Vertical connector from primary node down to the branches */
	.tree-node.main::after {
		content: ''; position: absolute; left: 55px; bottom: -7px;
		width: 2px; height: 7px; background: var(--color-chart-cyan);
	}
	.tree-node.active { box-shadow: 0 0 0 2px rgba(0,111,255,0.3); }

	.tn-icon {
		width: 38px; height: 38px; border-radius: 10px;
		background: var(--color-surface-700); color: var(--color-text-muted);
		display: flex; align-items: center; justify-content: center; flex-shrink: 0;
	}
	.tn-icon.online { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.tn-led {
		position: absolute; left: 42px; top: 10px;
		width: 9px; height: 9px; border-radius: 50%;
		border: 2px solid var(--color-surface-800); background: var(--color-text-muted);
	}
	.tn-led.on { background: var(--color-success); box-shadow: 0 0 6px rgba(34,197,94,0.5); }

	.tn-body { flex: 1; min-width: 0; }
	.tn-name { font-size: 14px; font-weight: 600; color: var(--color-text-primary); display: flex; align-items: center; gap: 8px; }
	.tn-badge.primary {
		font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
		padding: 2px 7px; border-radius: 4px;
		background: var(--color-accent-muted); color: var(--color-accent-light);
	}
	.tn-detail { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
	.mono { font-family: var(--font-mono); }

	.tn-stats { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
	.tn-radio {
		font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
		background: color-mix(in srgb, var(--bc) 15%, transparent); color: var(--bc);
	}
	.tn-clients { font-size: 11px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 3px; }
	.tn-link { font-size: 10px; font-weight: 700; font-family: var(--font-mono); }

	/* Tree branch with L-shaped connector using pseudo-elements */
	.tree-branch {
		position: relative;
		margin-left: 56px;
		padding-left: 28px;
	}
	/* Vertical line on left — runs full height of the item plus gap */
	.tree-branch::before {
		content: '';
		position: absolute;
		left: 0;
		top: -6px;
		bottom: -6px;
		width: 2px;
		background: var(--link-color, #22c55e);
	}
	/* Last item: vertical line stops at the middle */
	.tree-branch.last::before {
		bottom: 50%;
	}
	/* Horizontal line from vertical to the node card */
	.tree-branch::after {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 28px;
		height: 2px;
		background: var(--link-color, #22c55e);
	}

	.tree-branch .tree-node { width: 100%; }

	@media (max-width: 900px) {
		.tree-panel { width: 100%; }
	}

	.topo-node {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 16px; padding: 24px 20px 20px; width: 210px;
		display: flex; flex-direction: column; align-items: center; gap: 4px;
		cursor: pointer; transition: all 0.2s ease; text-align: center;
		font-family: inherit; color: inherit;
	}
	.topo-node:hover { border-color: var(--color-accent); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
	.topo-node.main { border-color: var(--color-accent); background: linear-gradient(180deg, rgba(0,111,255,0.08) 0%, var(--color-surface-800) 100%); }
	.topo-node.active { border-color: var(--color-accent-light); box-shadow: 0 0 0 2px rgba(0,111,255,0.3); }

	.topo-node-head { position: relative; margin-bottom: 8px; }
	.topo-icon {
		width: 56px; height: 56px; border-radius: 50%;
		background: var(--color-surface-700); color: var(--color-text-muted);
		display: flex; align-items: center; justify-content: center;
		transition: all 0.2s ease;
	}
	.topo-icon.online { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.topo-led {
		position: absolute; bottom: 2px; right: 2px;
		width: 12px; height: 12px; border-radius: 50%;
		border: 2px solid var(--color-surface-800);
		background: var(--color-text-muted);
	}
	.topo-led.on { background: var(--color-success); box-shadow: 0 0 8px rgba(34,197,94,0.6); }

	.topo-alias { font-size: 16px; font-weight: 700; color: var(--color-text-primary); }
	.topo-model { font-size: 12px; color: var(--color-text-secondary); }
	.topo-ip { font-size: 11px; font-family: var(--font-mono); color: var(--color-text-muted); }

	.topo-radios { display: flex; gap: 5px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }
	.topo-radio {
		font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px;
		background: color-mix(in srgb, var(--band-color) 15%, transparent);
		color: var(--band-color); display: flex; align-items: center; gap: 5px;
	}
	.topo-radio b { font-size: 12px; }

	.topo-clients { font-size: 12px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 5px; margin-top: 8px; }
	.topo-role {
		font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
		color: var(--color-accent-light); margin-top: 4px;
	}

	.topo-empty { width: 100%; padding: 48px; text-align: center; color: var(--color-text-muted); display: flex; flex-direction: column; align-items: center; gap: 12px; }

	/* ── Client table ── */
	.client-section { display: flex; flex-direction: column; gap: 12px; }
	.section-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
	.count-badge { font-size: 13px; font-weight: 500; background: var(--color-accent-muted); color: var(--color-accent-light); padding: 2px 10px; border-radius: 20px; }
	.filter-tag {
		font-size: 12px; padding: 4px 12px; background: var(--color-accent-muted); color: var(--color-accent-light);
		border: 1px solid var(--color-accent); border-radius: 20px; cursor: pointer; font-family: inherit;
	}

	.toolbar { display: flex; gap: 12px; }
	.search-box {
		flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 14px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; color: var(--color-text-muted); transition: border-color 0.2s;
	}
	.search-box:focus-within { border-color: var(--color-accent); }
	.search-box input { flex: 1; background: none; border: none; color: var(--color-text-primary); font-size: 14px; outline: none; font-family: inherit; }
	.search-box input::placeholder { color: var(--color-text-muted); }

	.table-card { background: var(--color-surface-800); border: 1px solid var(--color-surface-500); border-radius: 12px; overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; }
	thead th {
		text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600;
		color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em;
		border-bottom: 1px solid var(--color-surface-500); cursor: pointer; user-select: none;
		white-space: nowrap;
	}
	thead th:hover { color: var(--color-text-secondary); }
	tbody td { padding: 11px 16px; font-size: 13px; color: var(--color-text-primary); border-bottom: 1px solid var(--color-surface-700); }
	tbody tr:last-child td { border-bottom: none; }
	.client-row { cursor: pointer; transition: background 0.15s; }
	.client-row:hover td { background: rgba(255,255,255,0.04); }

	.name-cell { display: flex; align-items: center; gap: 10px; }
	.led { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--color-text-muted); }
	.led.on { background: var(--color-success); box-shadow: 0 0 6px rgba(34,197,94,0.5); }
	.client-name { font-weight: 500; display: block; }
	.client-vendor { font-size: 11px; color: var(--color-text-muted); display: block; }
	.mono { font-family: var(--font-mono); font-size: 12px; }

	.band-pill {
		font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 20px;
		background: color-mix(in srgb, var(--band-color) 15%, transparent);
		color: var(--band-color);
	}

	.speed-cell .tx { color: var(--color-chart-cyan); }
	.node-cell { font-size: 13px; color: var(--color-text-secondary); }
	.muted { color: var(--color-text-muted); }
	.empty { text-align: center; color: var(--color-text-muted); padding: 40px 16px !important; }

	/* ── Detail panel ── */
	.dp { display: flex; flex-direction: column; gap: 0; }
	.dp-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-surface-700); }
	.dp-row:last-child { border-bottom: none; }
	.dp-l { font-size: 13px; color: var(--color-text-muted); }
	.dp-v { font-size: 13px; color: var(--color-text-primary); }

	@media (max-width: 900px) {
		.hero { flex-direction: column; gap: 20px; align-items: flex-start; }
		.topo-map { flex-direction: column; align-items: center; }
		.topo-link { width: auto; height: 32px; flex-direction: column; }
		.topo-link::before { width: 2px; height: 100%; left: 50%; top: 0; bottom: 0; transform: translateX(-50%); }
		.topo-item { flex-direction: column; }
	}

	/* Bound indicator + bind button */
	.bound-cell { display: flex; align-items: center; gap: 6px; }
	.bound-badge {
		display: inline-flex; align-items: center; gap: 4px;
		font-size: 11px; font-weight: 500; color: var(--color-accent-light);
		background: var(--color-accent-muted); padding: 2px 8px; border-radius: 10px;
	}
	.bind-btn {
		display: flex; align-items: center; justify-content: center;
		width: 24px; height: 24px; border-radius: 6px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		color: var(--color-text-muted); cursor: pointer; transition: all 0.15s ease;
	}
	.bind-btn:hover { background: var(--color-surface-600); color: var(--color-text-primary); }

	/* Bind modal */
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6);
		display: flex; align-items: center; justify-content: center; z-index: 200;
		backdrop-filter: blur(2px);
	}
	.modal-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 14px; padding: 24px; width: 400px; max-width: 90vw;
	}
	.modal-title { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 8px; }
	.modal-sub { font-size: 13px; color: var(--color-text-muted); margin: 0 0 20px; }
	.bind-form { margin-bottom: 20px; }
	.bind-label { font-size: 13px; color: var(--color-text-secondary); display: block; margin-bottom: 6px; }
	.bind-select {
		width: 100%; padding: 10px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 14px; font-family: inherit;
	}
	.bind-select:focus { border-color: var(--color-accent); outline: none; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-secondary {
		padding: 8px 16px; background: var(--color-surface-600); color: var(--color-text-primary);
		border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
		font-family: inherit;
	}
	.btn-primary {
		padding: 8px 16px; background: var(--color-accent); color: white;
		border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
		font-family: inherit;
	}
	.btn-primary:disabled { opacity: 0.6; }
</style>
