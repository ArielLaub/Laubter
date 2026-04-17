<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import { Shield, ChevronRight } from 'lucide-svelte';

	interface Peer {
		name: string;
		section: string;
		online: boolean;
		rx_bytes: number;
		tx_bytes: number;
	}

	interface VpnStatusData {
		running: boolean;
		listen_port: number;
		address: string;
		peers: Peer[];
	}

	let status = $state<VpnStatusData | null>(null);
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	const onlinePeers = $derived(status?.peers?.filter(p => p.online) ?? []);
	const totalPeers = $derived(status?.peers?.length ?? 0);
	const isActive = $derived(status?.running && onlinePeers.length > 0);

	onMount(async () => {
		await refresh();
		pollInterval = setInterval(refresh, 10000);
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
	});

	async function refresh() {
		try {
			status = await call<VpnStatusData>('laubter-vpn', 'get_status');
		} catch {
			status = { running: false, listen_port: 0, address: '', peers: [] };
		}
	}
</script>

<a href="/settings/vpn" class="card">
	<div class="card-header">
		<div class="shield-icon" class:active={isActive} class:running={status?.running}>
			<Shield size={16} strokeWidth={1.75} />
		</div>
		<div>
			<h3 class="card-title">WireGuard VPN</h3>
			<p class="card-status">
				{#if !status}
					Loading...
				{:else if status.running}
					{onlinePeers.length} peer{onlinePeers.length !== 1 ? 's' : ''} connected
				{:else}
					Server off
				{/if}
			</p>
		</div>
	</div>

	{#if status?.running && status.peers.length > 0}
		<div class="peer-list">
			{#each status.peers as peer (peer.section)}
				<div class="peer-row">
					<span class="peer-dot" class:online={peer.online}></span>
					<span class="peer-name">{peer.name || peer.section}</span>
				</div>
			{/each}
		</div>
	{:else if status && !status.running}
		<div class="off-hint">
			<p>Enable VPN for secure remote access</p>
		</div>
	{/if}

	<div class="card-footer">
		<span>{status?.running ? 'Manage VPN' : 'Set up VPN'}</span>
		<ChevronRight size={14} strokeWidth={2} />
	</div>
</a>

<style>
	.card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 20px;
		text-decoration: none;
		display: block;
		height: 100%;
		transition: all 0.2s ease;
	}
	.card:hover {
		border-color: var(--color-surface-400);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.shield-icon {
		color: var(--color-text-muted);
	}
	.shield-icon.running {
		color: var(--color-accent-light);
	}
	.shield-icon.active {
		color: #22c55e;
	}
	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.card-status {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 1px 0 0;
	}

	.peer-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 0;
		border-top: 1px solid var(--color-surface-600);
		border-bottom: 1px solid var(--color-surface-600);
		margin-bottom: 8px;
	}
	.peer-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}
	.peer-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-text-muted);
		flex-shrink: 0;
	}
	.peer-dot.online {
		background: #22c55e;
		box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
	}
	.peer-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.off-hint {
		padding: 8px 0;
		border-top: 1px solid var(--color-surface-600);
		border-bottom: 1px solid var(--color-surface-600);
		margin-bottom: 8px;
	}
	.off-hint p {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 0;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 4px;
		padding-top: 10px;
		font-size: 12px;
		color: var(--color-text-muted);
	}
</style>
