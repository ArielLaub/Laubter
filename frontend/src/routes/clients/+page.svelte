<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { dhcpLeaseList } from '$stores/wireless';
	import { meshClientMap } from '$stores/mesh';
	import { wifiClients } from '$stores/wireless';
	import { call } from '$api/ubus';
	import { formatBytes } from '$utils/format';
	import { Wifi, Cable, ShieldBan, ArrowDown, ArrowUp } from 'lucide-svelte';
	import DetailPanel from '$components/shared/DetailPanel.svelte';

	let searchQuery = $state('');
	let filterMode = $state<'all' | 'wireless' | 'wired'>('all');
	let sortColumn = $state<string>('name');
	let sortAsc = $state(true);
	let selectedClient = $state<(typeof clients)[0] | null>(null);
	let panelOpen = $state(false);

	// Per-client traffic data from nlbwmon
	let trafficMap = $state(new Map<string, { rx: number; tx: number; conns: number }>());

	async function fetchTraffic() {
		try {
			const data = await call<{ columns: string[]; data: any[][] }>('laubter-traffic', 'get_clients', {});
			const map = new Map<string, { rx: number; tx: number; conns: number }>();
			for (const row of data.data || []) {
				const mac = (row[0] as string || '').toLowerCase();
				if (mac && mac !== '00:00:00:00:00:00') {
					map.set(mac, { rx: row[3] as number || 0, tx: row[5] as number || 0, conns: row[2] as number || 0 });
				}
			}
			trafficMap = map;
		} catch {}
	}

	let trafficTimer: ReturnType<typeof setInterval>;
	onMount(() => {
		fetchTraffic();
		trafficTimer = setInterval(fetchTraffic, 5000);
	});
	onDestroy(() => clearInterval(trafficTimer));

	// Build client list from DHCP leases + mesh + traffic
	const clients = $derived.by(() => {
		return $dhcpLeaseList.map((lease) => {
			const mesh = $meshClientMap.get(lease.mac.toLowerCase());
			const localWifi = $wifiClients.get(lease.mac.toLowerCase());
			const traffic = trafficMap.get(lease.mac.toLowerCase());
			return {
				hostname: lease.hostname || '(unknown)',
				ip: lease.ip,
				mac: lease.mac,
				isWireless: mesh?.isWireless ?? !!localWifi,
				band: mesh?.band,
				signal: mesh?.signal ?? localWifi?.signal,
				leaseExpire: lease.expire,
				rxBytes: traffic?.rx ?? 0,
				txBytes: traffic?.tx ?? 0,
				conns: traffic?.conns ?? 0
			};
		});
	});

	const filtered = $derived.by(() => {
		let list = clients;
		if (filterMode === 'wireless') list = list.filter((c) => c.isWireless);
		else if (filterMode === 'wired') list = list.filter((c) => !c.isWireless);

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(
				(c) =>
					c.hostname.toLowerCase().includes(q) ||
					c.ip.toLowerCase().includes(q) ||
					c.mac.toLowerCase().includes(q)
			);
		}
		return list;
	});

	const sorted = $derived.by(() => {
		const list = [...filtered];
		const dir = sortAsc ? 1 : -1;
		list.sort((a, b) => {
			switch (sortColumn) {
				case 'name': return dir * a.hostname.localeCompare(b.hostname);
				case 'ip': return dir * a.ip.localeCompare(b.ip, undefined, { numeric: true });
				case 'mac': return dir * a.mac.localeCompare(b.mac);
				case 'connection': return dir * (Number(a.isWireless) - Number(b.isWireless));
				case 'traffic': return dir * ((a.rxBytes + a.txBytes) - (b.rxBytes + b.txBytes));
				default: return 0;
			}
		});
		return list;
	});

	function toggleSort(col: string) {
		if (sortColumn === col) sortAsc = !sortAsc;
		else { sortColumn = col; sortAsc = true; }
	}

	function sortIcon(col: string): string {
		if (sortColumn !== col) return '';
		return sortAsc ? ' ▲' : ' ▼';
	}

	function openClientDetail(client: (typeof clients)[0]) {
		selectedClient = client;
		panelOpen = true;
	}

	function formatLeaseExpiry(expire: number): string {
		if (!expire) return 'Unknown';
		const date = new Date(expire * 1000);
		const now = Date.now();
		if (date.getTime() < now) return 'Expired';
		const diffMs = date.getTime() - now;
		const hours = Math.floor(diffMs / 3600000);
		const mins = Math.floor((diffMs % 3600000) / 60000);
		if (hours > 0) return `${hours}h ${mins}m remaining`;
		return `${mins}m remaining`;
	}

	function isLeaseActive(expire: number): boolean {
		if (!expire) return false;
		return new Date(expire * 1000).getTime() > Date.now();
	}
</script>

<div class="clients-page">
	<div class="page-header">
		<h1>Clients <span class="badge">{filtered.length}</span></h1>
	</div>

	<div class="toolbar">
		<input
			type="text"
			class="search-input"
			placeholder="Search by name, IP, or MAC..."
			bind:value={searchQuery}
		/>
		<div class="filter-buttons">
			<button class:active={filterMode === 'all'} onclick={() => (filterMode = 'all')}>All</button>
			<button class:active={filterMode === 'wireless'} onclick={() => (filterMode = 'wireless')}>Wireless</button>
			<button class:active={filterMode === 'wired'} onclick={() => (filterMode = 'wired')}>Wired</button>
		</div>
	</div>

	<div class="table-wrapper">
		<table>
			<thead>
				<tr>
					<th onclick={() => toggleSort('name')}>Name{sortIcon('name')}</th>
					<th onclick={() => toggleSort('ip')}>IP Address{sortIcon('ip')}</th>
					<th onclick={() => toggleSort('mac')}>MAC{sortIcon('mac')}</th>
					<th onclick={() => toggleSort('connection')}>Connection{sortIcon('connection')}</th>
					<th onclick={() => toggleSort('traffic')}>Traffic{sortIcon('traffic')}</th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as client, i (client.mac)}
					<tr class="clickable-row" class:row-odd={i % 2 === 1} onclick={() => openClientDetail(client)}>
						<td class="name-cell">
							<span class="status-dot" class:active={isLeaseActive(client.leaseExpire)} class:expired={!isLeaseActive(client.leaseExpire)}></span>
							{client.hostname}
						</td>
						<td class="mono">{client.ip}</td>
						<td class="mono">{client.mac}</td>
						<td>
							<span class="connection-badge" class:wireless={client.isWireless} class:wired={!client.isWireless}>
								{#if client.isWireless}
									<Wifi size={13} strokeWidth={2} />
									WiFi
								{:else}
									<Cable size={13} strokeWidth={2} />
									Ethernet
								{/if}
							</span>
						</td>
						<td class="traffic-cell">
							{#if client.rxBytes > 0 || client.txBytes > 0}
								<span class="traf-dl"><ArrowDown size={11} /> {formatBytes(client.rxBytes)}</span>
								<span class="traf-ul"><ArrowUp size={11} /> {formatBytes(client.txBytes)}</span>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="empty-state">No clients found</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<DetailPanel open={panelOpen} title={selectedClient?.hostname || 'Client Details'} onClose={() => { panelOpen = false; }}>
	{#if selectedClient}
		<div class="detail-section">
			<div class="detail-row">
				<span class="detail-label">Hostname</span>
				<span class="detail-value">{selectedClient.hostname}</span>
			</div>
			<div class="detail-row">
				<span class="detail-label">IP Address</span>
				<span class="detail-value mono">{selectedClient.ip}</span>
			</div>
			<div class="detail-row">
				<span class="detail-label">MAC Address</span>
				<span class="detail-value mono">{selectedClient.mac}</span>
			</div>
			<div class="detail-row">
				<span class="detail-label">Connection</span>
				<span class="detail-value">
					<span class="connection-badge" class:wireless={selectedClient.isWireless} class:wired={!selectedClient.isWireless}>
						{#if selectedClient.isWireless}
							<Wifi size={13} strokeWidth={2} /> WiFi
						{:else}
							<Cable size={13} strokeWidth={2} /> Ethernet
						{/if}
					</span>
				</span>
			</div>
			<div class="detail-row">
				<span class="detail-label">DHCP Lease</span>
				<span class="detail-value">{formatLeaseExpiry(selectedClient.leaseExpire)}</span>
			</div>
			{#if selectedClient.rxBytes > 0 || selectedClient.txBytes > 0}
				<div class="detail-row">
					<span class="detail-label">Download</span>
					<span class="detail-value mono">{formatBytes(selectedClient.rxBytes)}</span>
				</div>
				<div class="detail-row">
					<span class="detail-label">Upload</span>
					<span class="detail-value mono">{formatBytes(selectedClient.txBytes)}</span>
				</div>
				<div class="detail-row">
					<span class="detail-label">Connections</span>
					<span class="detail-value">{selectedClient.conns}</span>
				</div>
			{/if}
		</div>

		<div class="detail-actions">
			<button class="btn-block-client">
				<ShieldBan size={16} strokeWidth={2} />
				Block Client
			</button>
		</div>
	{/if}
</DetailPanel>

<style>
	.clients-page { display: flex; flex-direction: column; gap: 16px; max-width: 1400px; }

	.page-header h1 {
		font-size: 24px; font-weight: 600; color: var(--color-text-primary);
		margin: 0; display: flex; align-items: center; gap: 10px;
	}
	.badge {
		font-size: 13px; font-weight: 500; background: var(--color-accent-muted);
		color: var(--color-accent-light); padding: 2px 10px; border-radius: var(--radius-full);
	}

	.toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
	.search-input {
		flex: 1; min-width: 200px; padding: 8px 12px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: all 0.2s ease; font-family: inherit;
	}
	.search-input::placeholder { color: var(--color-text-muted); }
	.search-input:focus { border-color: var(--color-accent); }

	.filter-buttons {
		display: flex; border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); overflow: hidden;
	}
	.filter-buttons button {
		padding: 8px 16px; background: var(--color-surface-800); border: none;
		color: var(--color-text-secondary); font-size: 13px; font-weight: 500;
		cursor: pointer; transition: all 0.2s ease; font-family: inherit;
	}
	.filter-buttons button:not(:last-child) { border-right: 1px solid var(--color-surface-500); }
	.filter-buttons button.active { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.filter-buttons button:hover:not(.active) { background: var(--color-surface-700); }

	.table-wrapper {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; overflow-x: auto;
	}
	table { width: 100%; border-collapse: collapse; }
	thead th {
		text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600;
		color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em;
		border-bottom: 1px solid var(--color-surface-500); cursor: pointer;
		user-select: none; white-space: nowrap;
	}
	thead th:hover { color: var(--color-text-secondary); }
	tbody td {
		padding: 10px 16px; font-size: 14px; color: var(--color-text-primary);
		border-bottom: 1px solid var(--color-surface-700);
	}
	tbody tr:last-child td { border-bottom: none; }
	tbody tr.row-odd td { background: rgba(255, 255, 255, 0.015); }
	tbody tr:hover td { background: rgba(255, 255, 255, 0.05); }
	.clickable-row { cursor: pointer; }

	.name-cell { font-weight: 500; display: flex; align-items: center; gap: 8px; }
	.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.status-dot.active { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
	.status-dot.expired { background: var(--color-text-muted); }
	.mono { font-family: var(--font-mono); font-size: 13px; }

	.connection-badge {
		display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px;
		border-radius: var(--radius-full); font-size: 12px; font-weight: 500;
	}
	.connection-badge.wireless { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.connection-badge.wired { background: var(--color-info-muted); color: var(--color-info); }

	.traffic-cell { white-space: nowrap; }
	.traf-dl { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-family: var(--font-mono); color: #006fff; margin-right: 8px; }
	.traf-ul { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-family: var(--font-mono); color: #06b6d4; }
	.muted { color: var(--color-text-muted); }

	.empty-state { text-align: center; color: var(--color-text-muted); padding: 40px 16px !important; }

	.detail-section { display: flex; flex-direction: column; gap: 0; }
	.detail-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 10px 0; border-bottom: 1px solid var(--color-surface-700);
	}
	.detail-row:last-child { border-bottom: none; }
	.detail-label { font-size: 13px; color: var(--color-text-muted); }
	.detail-value { font-size: 14px; color: var(--color-text-primary); }

	.detail-actions { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--color-surface-500); }
	.btn-block-client {
		width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
		padding: 10px 16px; background: rgba(239, 68, 68, 0.12); color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px;
		font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; font-family: inherit;
	}
	.btn-block-client:hover { background: rgba(239, 68, 68, 0.22); border-color: rgba(239, 68, 68, 0.4); }
</style>
