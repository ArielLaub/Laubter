<script lang="ts">
	import { meshNodes, meshClients, meshSsid, meshTopology, fetchMeshTopology, activeCapabilities, activeProviderLabel, bindClient } from '$stores/mesh';
	import { Router, Wifi, Cable, Search, Radio, Signal, Link, Unlink, Power, Settings, ChevronRight, Activity } from 'lucide-svelte';
	import SignalBars from '$components/shared/SignalBars.svelte';
	import DetailPanel from '$components/shared/DetailPanel.svelte';
	import type { WirelessClient, WirelessNode } from '$lib/wireless/types';
	import { call } from '$api/ubus';

	let activeTab = $state<'topology' | 'clients'>('topology');
	let searchQuery = $state('');
	let sortColumn = $state<string>('signal');
	let sortAsc = $state(false);
	let selectedClient = $state<WirelessClient | null>(null);
	let panelOpen = $state(false);
	let selectedNodeFilter = $state<string | null>(null);

	// Node detail panel
	let selectedNode = $state<WirelessNode | null>(null);
	let nodePanelOpen = $state(false);
	let nodePanelTab = $state<'clients' | 'network' | 'management'>('clients');

	// Management state
	let mgmtLoading = $state(false);
	let mgmtError = $state('');

	const providerLabel = $derived($activeProviderLabel);
	const canBind = $derived($activeCapabilities.clientBinding);
	const isMultiNode = $derived($activeCapabilities.multiNode);
	const onlineNodes = $derived($meshNodes.filter((n) => n.online).length);

	// Only wireless clients
	const wirelessClients = $derived($meshClients.filter((c) => c.isWireless && c.isOnline));
	const totalWireless = $derived(wirelessClients.length);

	// Build node map for tree traversal
	const nodeMap = $derived.by(() => {
		const map = new Map<string, WirelessNode>();
		for (const n of $meshNodes) map.set(n.mac, n);
		return map;
	});

	// Sort nodes: main first, then by level
	const mainNode = $derived($meshNodes.find((n) => n.isMainNode));

	// Get children of a node, sorted by alias
	function getChildren(parentMac: string): WirelessNode[] {
		return $meshNodes
			.filter((n) => n.parentMac === parentMac && !n.isMainNode)
			.sort((a, b) => a.alias.localeCompare(b.alias));
	}

	// Get clients per node for the topology cards
	function clientsForNode(node: WirelessNode): number {
		return wirelessClients.filter((c) => c.connectedTo === node.id).length;
	}

	// Clients connected to a specific node
	function clientsOfNode(nodeMac: string): WirelessClient[] {
		return $meshClients.filter((c) => c.connectedTo === nodeMac && c.isOnline);
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
		return sortAsc ? ' \u25B2' : ' \u25BC';
	}

	function formatRate(mbps: number | undefined): string {
		if (!mbps) return '\u2014';
		if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
		return `${mbps} Mbps`;
	}

	function bandColor(band: string): string {
		if (band === '5G' || band === '5G1') return '#22c55e';
		if (band === '6G') return '#a354e3';
		return '#006fff';
	}

	function qualityColor(q?: string): string {
		switch (q) {
			case 'good': return '#22c55e';
			case 'ok': return '#3b82f6';
			case 'weak': return '#f59e0b';
			case 'poor': return '#ef4444';
			default: return '#6b7280';
		}
	}

	function qualityLabel(q?: string): string {
		switch (q) {
			case 'good': return 'Good';
			case 'ok': return 'OK';
			case 'weak': return 'Weak';
			case 'poor': return 'Poor';
			default: return '';
		}
	}

	function linkColor(node: WirelessNode): string {
		if (node.backhaulType === 'wireless') {
			return qualityColor(node.connectionQuality);
		}
		// Wired: color by link rate
		if (!node.linkRate) return '#22c55e';
		if (node.linkRate === 'Q') return '#22c55e';
		if (node.linkRate === 'G') return '#22c55e';
		if (node.linkRate === 'M') return '#f59e0b';
		return '#ef4444';
	}

	function linkLabel(node: WirelessNode): string {
		if (node.backhaulType === 'wireless') {
			const parts: string[] = [];
			if (node.backhaulBand) parts.push(node.backhaulBand);
			if (node.backhaulRssi) parts.push(`${node.backhaulRssi} dBm`);
			return parts.join(' ') || 'Wireless';
		}
		if (!node.linkRate) return '';
		if (node.linkRate === 'Q') return '2.5G';
		if (node.linkRate === 'G') return '1G';
		if (node.linkRate === 'M') return '100M';
		return node.linkRate;
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

	function openNodeDetail(node: WirelessNode, e: MouseEvent) {
		e.stopPropagation();
		selectedNode = node;
		nodePanelOpen = true;
		nodePanelTab = 'clients';
		mgmtError = '';
	}

	let bindingClient = $state<WirelessClient | null>(null);
	let bindTargetNode = $state('');
	let bindLoading = $state(false);
	let bindError = $state('');
	let bindApplying = $state(false);
	let bindApplyProgress = $state(0);
	let bindApplyMessage = $state('');

	function startBind(client: WirelessClient) {
		bindingClient = client;
		bindTargetNode = client.boundToMac || '';
		bindError = '';
	}

	async function confirmBind() {
		if (!bindingClient) return;
		bindLoading = true;
		bindError = '';
		try {
			const result = await bindClient(bindingClient.mac, bindTargetNode || '') as unknown as { status?: string; error?: string };
			if (result && result.error) {
				bindError = result.error;
				bindLoading = false;
				return;
			}
			// Success — show applying modal while ASUS processes the change
			bindingClient = null;
			bindLoading = false;
			bindApplying = true;
			bindApplyProgress = 0;
			bindApplyMessage = 'Applying binding to mesh network...';

			const totalWait = 12;
			for (let i = 1; i <= totalWait; i++) {
				await new Promise((r) => setTimeout(r, 1000));
				bindApplyProgress = Math.round((i / totalWait) * 100);
				if (i === 3) bindApplyMessage = 'Waiting for mesh nodes to sync...';
				if (i === 8) bindApplyMessage = 'Refreshing topology...';
			}
			await fetchMeshTopology();
			bindApplyMessage = 'Done!';
			bindApplyProgress = 100;
			await new Promise((r) => setTimeout(r, 500));
			bindApplying = false;
		} catch (e) {
			bindError = e instanceof Error ? e.message : 'Bind failed';
			bindLoading = false;
		}
	}

	function openClientDetail(client: WirelessClient) {
		selectedClient = client;
		panelOpen = true;
	}

	// Management actions
	async function toggleLed(node: WirelessNode) {
		mgmtLoading = true;
		mgmtError = '';
		try {
			const newVal = node.config?.ledEnabled ? '0' : '1';
			await call('laubter-mesh', 'set_node_config', { mac: node.mac.toUpperCase(), led: newVal });
			setTimeout(() => fetchMeshTopology(), 1500);
		} catch (e) {
			mgmtError = e instanceof Error ? e.message : 'Failed to toggle LED';
		} finally {
			mgmtLoading = false;
		}
	}

	async function setBackhaulPriority(node: WirelessNode, value: string) {
		mgmtLoading = true;
		mgmtError = '';
		try {
			await call('laubter-mesh', 'set_node_config', { mac: node.mac.toUpperCase(), backhaul_priority: value });
			setTimeout(() => fetchMeshTopology(), 1500);
		} catch (e) {
			mgmtError = e instanceof Error ? e.message : 'Failed to set backhaul priority';
		} finally {
			mgmtLoading = false;
		}
	}

	async function setPreferredUplink(node: WirelessNode, bssid: string) {
		mgmtLoading = true;
		mgmtError = '';
		try {
			await call('laubter-mesh', 'set_node_config', { mac: node.mac.toUpperCase(), preferred_uplink: bssid });
			setTimeout(() => fetchMeshTopology(), 1500);
		} catch (e) {
			mgmtError = e instanceof Error ? e.message : 'Failed to set preferred uplink';
		} finally {
			mgmtLoading = false;
		}
	}

	let rebootConfirm = $state(false);
	async function rebootNode(node: WirelessNode) {
		if (!rebootConfirm) { rebootConfirm = true; return; }
		mgmtLoading = true;
		mgmtError = '';
		rebootConfirm = false;
		try {
			await call('laubter-mesh', 'reboot_node', { mac: node.mac.toUpperCase() });
		} catch (e) {
			mgmtError = e instanceof Error ? e.message : 'Failed to reboot node';
		} finally {
			mgmtLoading = false;
		}
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

		{#if $meshNodes.length === 0}
			<div class="topo-empty">
				<Radio size={32} strokeWidth={1.5} />
				<p>No mesh nodes detected. Check mesh settings.</p>
			</div>
		{:else if mainNode}
			<div class="topo-centered">
				<div class="tree-panel">
					{#snippet nodeCard(node: WirelessNode, isMain: boolean)}
						{@const count = clientsForNode(node)}
						{@const isFiltered = selectedNodeFilter === node.id}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="tree-node" class:main={isMain} class:active={isFiltered}
							role="button" tabindex="0"
							onclick={() => selectNode(node.id)}
							onkeydown={(e) => { if (e.key === 'Enter') selectNode(node.id); }}>
							<div class="tn-icon" class:online={node.online}><Router size={isMain ? 22 : 20} strokeWidth={1.5} /></div>
							<div class="tn-led" class:on={node.online}></div>
							<div class="tn-body">
								<span class="tn-name">
									{node.alias}
									{#if isMain}<span class="tn-badge primary">Primary</span>{/if}
									{#if node.connectionQuality && node.backhaulType === 'wireless'}
										<span class="tn-badge quality" style="--qc: {qualityColor(node.connectionQuality)}">{qualityLabel(node.connectionQuality)}</span>
									{/if}
								</span>
								<span class="tn-detail">{node.model} &middot; <span class="mono">{node.ip}</span></span>
							</div>
							<div class="tn-stats">
								{#each node.radios as radio}
									<span class="tn-radio" style="--bc: {bandColor(radio.band)}">{radio.band} <b>{radio.clientCount}</b></span>
								{/each}
								<span class="tn-clients"><Wifi size={11} /> {count}</span>
								{#if !isMain}
									<span class="tn-link" style="color: {linkColor(node)}">
										{#if node.backhaulType === 'wireless'}<Wifi size={10} />{:else}<Cable size={10} />{/if}
										{linkLabel(node) || '?'}
									</span>
								{/if}
							</div>
							<button class="tn-expand" title="Details" onclick={(e) => openNodeDetail(node, e)}>
								<ChevronRight size={14} />
							</button>
						</div>
					{/snippet}

					{#snippet nodeTree(parentMac: string, depth: number)}
						{@const children = getChildren(parentMac)}
						{#each children as node, i (node.id)}
							{@const isLast = i === children.length - 1}
							{@const hasChildren = (node.children?.length ?? 0) > 0}
							<div class="tree-branch" class:last={isLast}
								style="--link-color: {linkColor(node)}{node.backhaulType === 'wireless' ? '; --link-style: dashed' : ''}"
								title="{node.backhaulType === 'wireless' ? `Wireless ${node.backhaulBand || ''} ${node.backhaulRssi ? node.backhaulRssi + ' dBm' : ''}` : `Wired ${linkLabel(node)}`} via {node.parentName || 'main'}">
								{@render nodeCard(node, false)}
								{#if hasChildren}
									<div class="tree-children">
										{@render nodeTree(node.mac, depth + 1)}
									</div>
								{/if}
							</div>
						{/each}
					{/snippet}

					<!-- Main node -->
					{@render nodeCard(mainNode, true)}

					<!-- Children tree (recursive) -->
					<div class="tree-children root-children">
						{@render nodeTree(mainNode.mac, 1)}
					</div>
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
				{@const nodeName = $meshNodes.find(n => n.id === selectedNodeFilter)?.alias ?? ''}
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
						{#if isMultiNode}<th onclick={() => toggleSort('node')}>Mesh Node{sortIcon('node')}</th>{/if}
						{#if canBind}<th>Bound</th>{/if}
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
									<span class="muted">&mdash;</span>
								{/if}
							</td>
							<td>
								{#if client.signal != null}
									<SignalBars signal={client.signal} showValue={true} />
								{:else}
									<span class="muted">&mdash;</span>
								{/if}
							</td>
							<td class="mono speed-cell">
								{#if client.txRate}
									<span class="tx">{formatRate(client.txRate)}</span>
								{:else}
									<span class="muted">&mdash;</span>
								{/if}
							</td>
							{#if isMultiNode}<td class="node-cell">{client.connectedToName || '\u2014'}</td>{/if}
							{#if canBind}<td class="bound-cell">
								{#if client.boundToName}
									<span class="bound-badge" title="Bound to {client.boundToName}">
										<Link size={11} /> {client.boundToName}
									</span>
								{/if}
								<button class="bind-btn" title={client.boundToMac ? 'Change/Unbind' : 'Bind to node'} onclick={(e) => { e.stopPropagation(); startBind(client); }}>
									{#if client.boundToMac}<Unlink size={12} />{:else}<Link size={12} />{/if}
								</button>
							</td>{/if}
							<td class="mono">{client.connectTime || '\u2014'}</td>
						</tr>
					{:else}
						<tr><td colspan={5 + (isMultiNode ? 1 : 0) + (canBind ? 1 : 0) + 1} class="empty">No wireless clients {selectedNodeFilter ? 'on this node' : 'found'}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
	{/if}
</div>

<!-- Client detail panel -->
<DetailPanel open={panelOpen} title={selectedClient?.name || 'Client'} onClose={() => { panelOpen = false; }}>
	{#if selectedClient}
		<div class="dp">
			<div class="dp-row"><span class="dp-l">IP Address</span><span class="dp-v mono">{selectedClient.ip}</span></div>
			<div class="dp-row"><span class="dp-l">MAC</span><span class="dp-v mono">{selectedClient.mac}</span></div>
			{#if selectedClient.vendor}<div class="dp-row"><span class="dp-l">Vendor</span><span class="dp-v">{selectedClient.vendor}</span></div>{/if}
			<div class="dp-row"><span class="dp-l">Band</span><span class="dp-v">{#if selectedClient.band}<span class="band-pill" style="--band-color: {bandColor(selectedClient.band)}">{selectedClient.band}</span>{:else}\u2014{/if}</span></div>
			{#if selectedClient.signal != null}<div class="dp-row"><span class="dp-l">Signal</span><span class="dp-v">{selectedClient.signal} dBm</span></div>{/if}
			{#if isMultiNode}<div class="dp-row"><span class="dp-l">Mesh Node</span><span class="dp-v">{selectedClient.connectedToName}</span></div>{/if}
			{#if selectedClient.txRate}<div class="dp-row"><span class="dp-l">TX Rate</span><span class="dp-v mono">{formatRate(selectedClient.txRate)}</span></div>{/if}
			{#if selectedClient.rxRate}<div class="dp-row"><span class="dp-l">RX Rate</span><span class="dp-v mono">{formatRate(selectedClient.rxRate)}</span></div>{/if}
			{#if selectedClient.connectTime}<div class="dp-row"><span class="dp-l">Connected</span><span class="dp-v mono">{selectedClient.connectTime}</span></div>{/if}
		</div>
	{/if}
</DetailPanel>

<!-- Node detail panel -->
<DetailPanel open={nodePanelOpen} title={selectedNode?.alias || 'Node'} onClose={() => { nodePanelOpen = false; rebootConfirm = false; }}>
	{#if selectedNode}
		{@const nc = clientsOfNode(selectedNode.mac)}
		{@const ncWireless = nc.filter(c => c.isWireless)}
		{@const ncWired = nc.filter(c => !c.isWireless)}

		<div class="node-detail">
			<!-- Node header -->
			<div class="nd-header">
				<div class="nd-model">{selectedNode.model}</div>
				<div class="nd-mac mono">{selectedNode.mac.toUpperCase()}</div>
				{#if selectedNode.connectionQuality && !selectedNode.isMainNode}
					<div class="nd-quality" style="color: {qualityColor(selectedNode.connectionQuality)}">
						Connection Quality: <b>{qualityLabel(selectedNode.connectionQuality)}</b>
					</div>
				{/if}
				<div class="nd-fw">Firmware: {selectedNode.firmware}</div>
				{#if selectedNode.newFirmware}
					<div class="nd-update">Update available: {selectedNode.newFirmware}</div>
				{/if}
			</div>

			<!-- Tabs -->
			<div class="nd-tabs">
				<button class="nd-tab" class:active={nodePanelTab === 'clients'} onclick={() => nodePanelTab = 'clients'}>
					<Wifi size={14} /> Clients
				</button>
				<button class="nd-tab" class:active={nodePanelTab === 'network'} onclick={() => nodePanelTab = 'network'}>
					<Activity size={14} /> Network
				</button>
				{#if !selectedNode.isMainNode}
					<button class="nd-tab" class:active={nodePanelTab === 'management'} onclick={() => { nodePanelTab = 'management'; rebootConfirm = false; }}>
						<Settings size={14} /> Manage
					</button>
				{/if}
			</div>

			{#if nodePanelTab === 'clients'}
				<div class="nd-section">
					<div class="nd-section-header">
						<span>Client List</span>
						<span class="nd-count">{nc.length} Online</span>
					</div>
					{#if nc.length === 0}
						<div class="nd-empty">No clients connected</div>
					{:else}
						<div class="nd-client-list">
							{#each nc as client (client.mac)}
								<button class="nd-client" onclick={() => openClientDetail(client)}>
									<div class="nd-client-info">
										<span class="nd-client-name">{client.name}</span>
										<span class="nd-client-meta mono">{client.mac.toUpperCase()} &middot; {client.ip || 'no IP'}</span>
									</div>
									<div class="nd-client-right">
										{#if client.band}
											<span class="band-pill small" style="--band-color: {bandColor(client.band)}">{client.band}</span>
										{:else if !client.isWireless}
											<span class="band-pill small" style="--band-color: #6b7280"><Cable size={10} /></span>
										{/if}
										{#if client.signal != null}
											<SignalBars signal={client.signal} showValue={false} />
										{/if}
									</div>
									{#if canBind}
										<button class="bind-btn small" title="Bind" onclick={(e) => { e.stopPropagation(); startBind(client); }}>
											<Link size={11} />
										</button>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>

			{:else if nodePanelTab === 'network'}
				<div class="nd-section">
					<!-- Uplink info -->
					{#if !selectedNode.isMainNode}
						<div class="nd-section-header">Uplink Information</div>
						<div class="dp">
							<div class="dp-row">
								<span class="dp-l">Uplink Type</span>
								<span class="dp-v">
									{#if selectedNode.backhaulType === 'wireless'}
										<span class="nd-uplink-badge wireless">
											<Wifi size={12} />
											Wireless{selectedNode.backhaulBand ? ` - ${selectedNode.backhaulBand === '5G1' ? '5 GHz DWB' : selectedNode.backhaulBand === '5G' ? '5 GHz' : selectedNode.backhaulBand === '2G' ? '2.4 GHz' : selectedNode.backhaulBand}` : ''}
										</span>
									{:else}
										<span class="nd-uplink-badge wired">
											<Cable size={12} />
											Ethernet {selectedNode.linkRate === 'Q' ? '2.5G' : selectedNode.linkRate === 'G' ? '1G' : selectedNode.linkRate === 'M' ? '100M' : ''}
										</span>
									{/if}
								</span>
							</div>
							<div class="dp-row">
								<span class="dp-l">IP Address</span>
								<span class="dp-v mono">{selectedNode.ip}</span>
							</div>
							{#if selectedNode.parentName}
								<div class="dp-row">
									<span class="dp-l">Connected Through</span>
									<span class="dp-v">{selectedNode.parentName}</span>
								</div>
							{/if}
							{#if selectedNode.backhaulType === 'wireless'}
								{#if selectedNode.backhaulRssi}
									<div class="dp-row">
										<span class="dp-l">Backhaul RSSI</span>
										<span class="dp-v" style="color: {qualityColor(selectedNode.connectionQuality)}">{selectedNode.backhaulRssi} dBm</span>
									</div>
								{/if}
								{#if selectedNode.connectionQuality}
									<div class="dp-row">
										<span class="dp-l">Connection Quality</span>
										<span class="dp-v" style="color: {qualityColor(selectedNode.connectionQuality)}; font-weight: 600">{qualityLabel(selectedNode.connectionQuality)}</span>
									</div>
								{/if}
								{#if selectedNode.backhaulSsid}
									<div class="dp-row">
										<span class="dp-l">Backhaul SSID</span>
										<span class="dp-v">{selectedNode.backhaulSsid}</span>
									</div>
								{/if}
							{/if}
						</div>
					{:else}
						<div class="nd-section-header">Network</div>
						<div class="dp">
							<div class="dp-row">
								<span class="dp-l">Role</span>
								<span class="dp-v">Primary Router</span>
							</div>
							<div class="dp-row">
								<span class="dp-l">IP Address</span>
								<span class="dp-v mono">{selectedNode.ip}</span>
							</div>
						</div>
					{/if}

					<!-- Radios -->
					<div class="nd-section-header" style="margin-top: 16px">Radios</div>
					<div class="dp">
						{#each selectedNode.radios as radio}
							<div class="dp-row">
								<span class="dp-l">
									<span class="band-pill small" style="--band-color: {bandColor(radio.band)}">{radio.band}</span>
									{radio.ssid}
								</span>
								<span class="dp-v">{radio.clientCount} clients</span>
							</div>
						{/each}
					</div>

					<!-- General info -->
					<div class="nd-section-header" style="margin-top: 16px">Device Info</div>
					<div class="dp">
						<div class="dp-row"><span class="dp-l">Model</span><span class="dp-v">{selectedNode.model}</span></div>
						{#if selectedNode.productId}<div class="dp-row"><span class="dp-l">Product ID</span><span class="dp-v">{selectedNode.productId}</span></div>{/if}
						<div class="dp-row"><span class="dp-l">Firmware</span><span class="dp-v mono">{selectedNode.firmware}</span></div>
						{#if selectedNode.bandCount}<div class="dp-row"><span class="dp-l">Bands</span><span class="dp-v">{selectedNode.bandCount}</span></div>{/if}
					</div>
				</div>

			{:else if nodePanelTab === 'management'}
				<div class="nd-section">
					{#if mgmtError}
						<div class="nd-error">{mgmtError}</div>
					{/if}

					<div class="mgmt-row">
						<div class="mgmt-label">LED</div>
						<button class="toggle" class:on={selectedNode.config?.ledEnabled}
							disabled={mgmtLoading}
							onclick={() => selectedNode && toggleLed(selectedNode)}>
							<span class="toggle-knob"></span>
						</button>
					</div>

					<div class="mgmt-row">
						<div class="mgmt-label">Backhaul Priority</div>
						<select class="mgmt-select" disabled={mgmtLoading}
							value={selectedNode.config?.backhaulPriority || 'auto'}
							onchange={(e) => selectedNode && setBackhaulPriority(selectedNode, (e.target as HTMLSelectElement).value)}>
							<option value="auto">Auto</option>
							<option value="ethernet">Ethernet</option>
							<option value="wireless">Wireless</option>
						</select>
					</div>

					<div class="mgmt-row">
						<div class="mgmt-label">Preferred Uplink AP</div>
						<select class="mgmt-select" disabled={mgmtLoading}
							value={selectedNode.config?.preferredUplink || ''}
							onchange={(e) => selectedNode && setPreferredUplink(selectedNode, (e.target as HTMLSelectElement).value)}>
							<option value="">Auto</option>
							{#each $meshNodes.filter(n => n.mac !== selectedNode?.mac) as node}
								<option value={node.mac.toUpperCase()}>{node.alias}</option>
							{/each}
						</select>
					</div>

					<div class="mgmt-divider"></div>

					<button class="mgmt-btn danger" disabled={mgmtLoading} onclick={() => selectedNode && rebootNode(selectedNode)}>
						<Power size={14} />
						{rebootConfirm ? 'Confirm Reboot?' : 'Reboot Node'}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</DetailPanel>

<!-- Bind modal -->
{#if canBind && bindingClient}
	<div class="modal-backdrop" role="presentation" onclick={() => { bindingClient = null; }}>
		<div class="modal-card" role="dialog" onclick={(e) => e.stopPropagation()}>
			<h3 class="modal-title">Bind Client to Node</h3>
			<p class="modal-sub">Assign <b>{bindingClient.name}</b> ({bindingClient.mac}) to a specific mesh node.</p>

			{#if bindError}
				<div class="nd-error">{bindError}</div>
			{/if}

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

<!-- Applying progress modal -->
{#if bindApplying}
	<div class="modal-backdrop" role="presentation">
		<div class="modal-card apply-modal" role="dialog">
			<div class="apply-icon">
				<Wifi size={28} strokeWidth={1.5} />
			</div>
			<h3 class="modal-title" style="text-align: center">{bindApplyMessage}</h3>
			<div class="progress-bar">
				<div class="progress-fill" style="width: {bindApplyProgress}%"></div>
			</div>
			<p class="apply-pct">{bindApplyProgress}%</p>
		</div>
	</div>
{/if}

<style>
	.mesh-page { display: flex; flex-direction: column; gap: 28px; max-width: 1400px; }

	/* -- Hero -- */
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

	/* -- Tabs -- */
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

	/* -- Topology tree -- */
	.section-heading { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
	.topo-centered { display: flex; justify-content: center; }
	.tree-panel { width: 70%; max-width: 800px; display: flex; flex-direction: column; }

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
	.tn-name { font-size: 14px; font-weight: 600; color: var(--color-text-primary); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.tn-badge.primary {
		font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
		padding: 2px 7px; border-radius: 4px;
		background: var(--color-accent-muted); color: var(--color-accent-light);
	}
	.tn-badge.quality {
		font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
		padding: 2px 7px; border-radius: 4px;
		background: color-mix(in srgb, var(--qc) 15%, transparent); color: var(--qc);
	}
	.tn-detail { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
	.mono { font-family: var(--font-mono); font-size: 12px; }

	.tn-stats { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
	.tn-radio {
		font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
		background: color-mix(in srgb, var(--bc) 15%, transparent); color: var(--bc);
	}
	.tn-clients { font-size: 11px; color: var(--color-text-secondary); display: flex; align-items: center; gap: 3px; }
	.tn-link { font-size: 10px; font-weight: 700; font-family: var(--font-mono); display: flex; align-items: center; gap: 3px; }

	.tn-expand {
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		color: var(--color-text-muted); cursor: pointer; transition: all 0.15s ease;
	}
	.tn-expand:hover { background: var(--color-surface-600); color: var(--color-text-primary); }

	/* -- Recursive tree branches -- */
	/* All tree indentation uses a fixed 34px step (aligns with node icon center) */

	.root-children { margin-left: 33px; }
	.tree-children { display: flex; flex-direction: column; }

	.tree-branch {
		position: relative;
		margin-left: 0;
		padding-left: 34px;
		padding-top: 8px;
		padding-bottom: 0;
	}
	/* Vertical trunk — glow line running down the left edge */
	.tree-branch::before {
		content: '';
		position: absolute;
		left: 0;
		top: -1px;
		bottom: -1px;
		width: 3px;
		border-radius: 1.5px;
		background: var(--link-color, #22c55e);
		box-shadow: 0 0 4px var(--link-color, #22c55e),
		            0 0 10px color-mix(in srgb, var(--link-color, #22c55e) 40%, transparent);
	}
	/* Non-last branches: horizontal connector as a simple line at card center */
	.tree-branch > .tree-node {
		position: relative;
		z-index: 1;
	}
	.tree-branch > .tree-node::before {
		content: '';
		position: absolute;
		left: -34px;
		top: 50%;
		transform: translateY(-50%);
		width: 34px;
		height: 3px;
		border-radius: 1.5px;
		background: var(--link-color, #22c55e);
		box-shadow: 0 0 4px var(--link-color, #22c55e),
		            0 0 10px color-mix(in srgb, var(--link-color, #22c55e) 40%, transparent);
	}
	/* Last branch: replace vertical trunk + horizontal with a single L-corner */
	.tree-branch.last::before { display: none; }
	.tree-branch.last > .tree-node::before {
		/* L-shape: vertical from branch top down to card center, then horizontal to card */
		top: -8px;
		left: -34px;
		height: calc(50% + 8px);
		width: 34px;
		background: none;
		border-left: 3px solid var(--link-color, #22c55e);
		border-bottom: 3px solid var(--link-color, #22c55e);
		border-radius: 0 0 0 8px;
		transform: none;
		box-shadow: none;
		filter: drop-shadow(0 0 4px var(--link-color, #22c55e))
		        drop-shadow(0 0 8px color-mix(in srgb, var(--link-color, #22c55e) 30%, transparent));
	}

	/* Sub-children inherit the same indent pattern */
	.tree-branch > .tree-children { margin-left: 33px; }

	@media (max-width: 900px) {
		.tree-panel { width: 100%; }
	}

	.topo-empty { width: 100%; padding: 48px; text-align: center; color: var(--color-text-muted); display: flex; flex-direction: column; align-items: center; gap: 12px; }

	/* -- Client table -- */
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

	.band-pill {
		font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 20px;
		background: color-mix(in srgb, var(--band-color) 15%, transparent);
		color: var(--band-color);
	}
	.band-pill.small { font-size: 9px; padding: 1px 6px; display: inline-flex; align-items: center; gap: 3px; }

	.speed-cell .tx { color: var(--color-chart-cyan); }
	.node-cell { font-size: 13px; color: var(--color-text-secondary); }
	.muted { color: var(--color-text-muted); }
	.empty { text-align: center; color: var(--color-text-muted); padding: 40px 16px !important; }

	/* -- Detail panel shared -- */
	.dp { display: flex; flex-direction: column; gap: 0; }
	.dp-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-surface-700); }
	.dp-row:last-child { border-bottom: none; }
	.dp-l { font-size: 13px; color: var(--color-text-muted); display: flex; align-items: center; gap: 6px; }
	.dp-v { font-size: 13px; color: var(--color-text-primary); }

	/* -- Node detail panel -- */
	.node-detail { display: flex; flex-direction: column; gap: 0; }
	.nd-header { padding-bottom: 12px; border-bottom: 1px solid var(--color-surface-700); margin-bottom: 12px; }
	.nd-model { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
	.nd-mac { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
	.nd-quality { font-size: 13px; margin-top: 8px; }
	.nd-fw { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
	.nd-update { font-size: 12px; color: var(--color-warning, #f59e0b); margin-top: 2px; }

	.nd-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--color-surface-700); margin-bottom: 12px; }
	.nd-tab {
		padding: 8px 14px; background: none; border: none; border-bottom: 2px solid transparent;
		margin-bottom: -1px; color: var(--color-text-muted); font-size: 13px; font-weight: 500;
		cursor: pointer; display: flex; align-items: center; gap: 6px; font-family: inherit;
		transition: all 0.15s;
	}
	.nd-tab:hover { color: var(--color-text-primary); }
	.nd-tab.active { color: var(--color-accent-light); border-bottom-color: var(--color-accent); }

	.nd-section { display: flex; flex-direction: column; gap: 8px; }
	.nd-section-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); display: flex; justify-content: space-between; align-items: center; }
	.nd-count { font-size: 12px; color: var(--color-text-secondary); text-transform: none; letter-spacing: 0; }
	.nd-empty { font-size: 13px; color: var(--color-text-muted); padding: 20px 0; text-align: center; }
	.nd-error { font-size: 12px; color: #ef4444; background: rgba(239,68,68,0.1); padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; }

	.nd-client-list { display: flex; flex-direction: column; gap: 2px; }
	.nd-client {
		display: flex; align-items: center; gap: 10px; padding: 8px 10px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-600);
		border-radius: 8px; cursor: pointer; transition: all 0.15s; font-family: inherit;
		color: inherit; text-align: left; width: 100%;
	}
	.nd-client:hover { border-color: var(--color-accent); }
	.nd-client-info { flex: 1; min-width: 0; }
	.nd-client-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.nd-client-meta { font-size: 10px; color: var(--color-text-muted); display: block; margin-top: 1px; }
	.nd-client-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

	.nd-uplink-badge {
		display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600;
		padding: 3px 10px; border-radius: 6px;
	}
	.nd-uplink-badge.wireless { background: rgba(34,197,94,0.1); color: #22c55e; }
	.nd-uplink-badge.wired { background: rgba(59,130,246,0.1); color: #3b82f6; }

	/* -- Management -- */
	.mgmt-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--color-surface-700); }
	.mgmt-label { font-size: 13px; color: var(--color-text-primary); }
	.mgmt-select {
		padding: 6px 10px; background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-family: inherit;
	}
	.mgmt-select:focus { border-color: var(--color-accent); outline: none; }
	.mgmt-divider { height: 1px; background: var(--color-surface-700); margin: 8px 0; }
	.mgmt-btn {
		display: flex; align-items: center; gap: 8px; padding: 10px 16px;
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit;
		background: var(--color-surface-700); color: var(--color-text-primary);
		transition: all 0.15s;
	}
	.mgmt-btn.danger { border-color: rgba(239,68,68,0.3); color: #ef4444; }
	.mgmt-btn.danger:hover { background: rgba(239,68,68,0.1); }
	.mgmt-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Toggle switch */
	.toggle {
		width: 40px; height: 22px; border-radius: 11px; border: none; padding: 2px;
		background: var(--color-surface-600); cursor: pointer; transition: background 0.2s;
		position: relative;
	}
	.toggle.on { background: var(--color-accent); }
	.toggle-knob {
		display: block; width: 18px; height: 18px; border-radius: 50%;
		background: white; transition: transform 0.2s;
	}
	.toggle.on .toggle-knob { transform: translateX(18px); }
	.toggle:disabled { opacity: 0.5; cursor: not-allowed; }

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
	.bind-btn.small { width: 22px; height: 22px; }
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

	/* Applying progress modal */
	.apply-modal { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 32px; }
	.apply-icon {
		width: 56px; height: 56px; border-radius: 50%;
		background: var(--color-accent-muted); color: var(--color-accent-light);
		display: flex; align-items: center; justify-content: center;
		animation: pulse-icon 1.5s ease-in-out infinite;
	}
	@keyframes pulse-icon {
		0%, 100% { opacity: 0.7; transform: scale(1); }
		50% { opacity: 1; transform: scale(1.05); }
	}
	.progress-bar {
		width: 100%; height: 6px; border-radius: 3px;
		background: var(--color-surface-600); overflow: hidden;
	}
	.progress-fill {
		height: 100%; border-radius: 3px;
		background: var(--color-accent);
		box-shadow: 0 0 8px rgba(0,111,255,0.4);
		transition: width 0.5s ease;
	}
	.apply-pct { font-size: 12px; color: var(--color-text-muted); margin: 0; font-family: var(--font-mono); }

	@media (max-width: 900px) {
		.hero { flex-direction: column; gap: 20px; align-items: flex-start; }
	}
</style>
