<script lang="ts">
	import { dhcpLeaseList, wifiClients } from '$stores/wireless';
	import { Monitor } from 'lucide-svelte';

	interface ClientRow {
		hostname: string;
		ip: string;
		mac: string;
		isWireless: boolean;
		activity: number; // bytes for relative bar
	}

	const clients = $derived.by(() => {
		const leases = $dhcpLeaseList;
		const wifi = $wifiClients;

		const rows: ClientRow[] = leases.map((lease) => {
			const wifiClient = wifi.get(lease.mac);
			const activity = wifiClient ? wifiClient.rxBytes + wifiClient.txBytes : 0;
			return {
				hostname: lease.hostname || '(unknown)',
				ip: lease.ip,
				mac: lease.mac,
				isWireless: !!wifiClient,
				activity
			};
		});

		// Sort by activity descending, take top 5
		rows.sort((a, b) => b.activity - a.activity);
		return rows.slice(0, 5);
	});

	const maxActivity = $derived(
		clients.length > 0 ? Math.max(...clients.map((c) => c.activity), 1) : 1
	);
</script>

<div class="card">
	<div class="card-header">
		<h3 class="card-title">Active Clients</h3>
		<span class="count-badge">{$dhcpLeaseList.length}</span>
	</div>

	<div class="client-list">
		{#each clients as client, i}
			<div class="client-row">
				<div class="client-index">{i + 1}</div>
				<div class="client-info">
					<div class="client-name-row">
						<span class="client-name">{client.hostname}</span>
						<span class="client-type-dot" class:wireless={client.isWireless} class:wired={!client.isWireless}></span>
					</div>
					<span class="client-ip">{client.ip}</span>
				</div>
				<div class="activity-bar-wrap">
					<div
						class="activity-bar"
						style="width: {Math.max(4, (client.activity / maxActivity) * 100)}%"
					></div>
				</div>
			</div>
		{:else}
			<div class="empty-state">
				<Monitor size={20} />
				<span>No clients detected</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 20px;
		height: 100%;
		transition: all 0.2s ease;
	}
	.card:hover {
		border-color: var(--color-surface-400);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.count-badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		background: var(--color-accent-muted);
		color: var(--color-accent-light);
		border-radius: var(--radius-full);
	}

	.client-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.client-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--color-surface-600);
		transition: background 0.15s ease;
	}
	.client-row:last-child {
		border-bottom: none;
	}
	.client-row:hover {
		background: rgba(255, 255, 255, 0.015);
		margin: 0 -8px;
		padding: 10px 8px;
		border-radius: var(--radius-sm);
	}

	.client-index {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		width: 18px;
		text-align: center;
		flex-shrink: 0;
	}

	.client-info {
		flex: 1;
		min-width: 0;
	}
	.client-name-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.client-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.client-type-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.client-type-dot.wireless {
		background: var(--color-accent);
	}
	.client-type-dot.wired {
		background: var(--color-chart-cyan);
	}
	.client-ip {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}

	.activity-bar-wrap {
		width: 80px;
		height: 4px;
		background: var(--color-surface-600);
		border-radius: var(--radius-full);
		overflow: hidden;
		flex-shrink: 0;
	}
	.activity-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--color-accent), var(--color-accent-light));
		border-radius: var(--radius-full);
		transition: width 0.5s ease;
	}

	.empty-state {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 24px 0;
		color: var(--color-text-muted);
		font-size: 13px;
	}
</style>
