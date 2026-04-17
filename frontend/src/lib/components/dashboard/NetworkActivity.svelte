<script lang="ts">
	import { systemInfo } from '$stores/system';
	import { interfaces } from '$stores/network';
	import { formatBytes } from '$utils/format';
	import { Activity, Network, ArrowDownUp, MemoryStick } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';

	// Conntrack
	let conntrackCount = $state(0);
	let conntrackMax = $state(16384);

	// Bandwidth stats from laubter-stats
	let todayRx = $state(0);
	let todayTx = $state(0);

	const activeInterfaces = $derived(
		$interfaces ? $interfaces.filter((i) => i.up).length : 0
	);

	const memPercent = $derived(() => {
		const info = $systemInfo;
		if (!info) return 0;
		const used = info.memory.total - (info.memory.available ?? info.memory.free);
		return Math.round((used / info.memory.total) * 100);
	});

	const conntrackPercent = $derived(
		conntrackMax > 0 ? Math.round((conntrackCount / conntrackMax) * 100) : 0
	);

	async function fetchConntrack() {
		try {
			const result = await call<{ count: number; limit: number }>(
				'luci-rpc', 'getConntrackCount', {}
			);
			conntrackCount = result.count ?? 0;
			conntrackMax = result.limit ?? 16384;
		} catch {
			// Try reading from file as fallback
			try {
				const countRes = await call<{ data: string }>(
					'file', 'read', { path: '/proc/sys/net/netfilter/nf_conntrack_count' }
				);
				const maxRes = await call<{ data: string }>(
					'file', 'read', { path: '/proc/sys/net/netfilter/nf_conntrack_max' }
				);
				conntrackCount = parseInt(countRes.data) || 0;
				conntrackMax = parseInt(maxRes.data) || 16384;
			} catch { /* ok */ }
		}
	}

	async function fetchBandwidthStats() {
		try {
			const stats = await call<{
				today_rx: number; today_tx: number;
			}>('laubter-stats', 'get_peaks', {});
			todayRx = stats.today_rx || 0;
			todayTx = stats.today_tx || 0;
		} catch { /* ok */ }
	}

	let interval: ReturnType<typeof setInterval>;

	onMount(() => {
		fetchConntrack();
		fetchBandwidthStats();
		interval = setInterval(() => {
			fetchConntrack();
			fetchBandwidthStats();
		}, 10000);
	});

	onDestroy(() => {
		clearInterval(interval);
	});
</script>

<div class="card">
	<h3 class="card-title">Network Activity</h3>

	<div class="stat-list">
		<!-- Conntrack -->
		<div class="stat-row">
			<div class="stat-icon-wrap">
				<Activity size={14} />
			</div>
			<div class="stat-info">
				<span class="stat-label">Connections</span>
				<span class="stat-value">{conntrackCount.toLocaleString()} / {conntrackMax.toLocaleString()}</span>
			</div>
			<div class="mini-bar-wrap">
				<div class="mini-bar" class:warning={conntrackPercent > 75} style="width: {conntrackPercent}%"></div>
			</div>
		</div>

		<!-- Active interfaces -->
		<div class="stat-row">
			<div class="stat-icon-wrap">
				<Network size={14} />
			</div>
			<div class="stat-info">
				<span class="stat-label">Active Interfaces</span>
				<span class="stat-value">{activeInterfaces}</span>
			</div>
		</div>

		<!-- Today's traffic -->
		<div class="stat-row">
			<div class="stat-icon-wrap">
				<ArrowDownUp size={14} />
			</div>
			<div class="stat-info">
				<span class="stat-label">Traffic Today</span>
				<span class="stat-value">{formatBytes(todayRx + todayTx)}</span>
			</div>
			<div class="traffic-split">
				<span class="traffic-down">{formatBytes(todayRx)}</span>
				<span class="traffic-sep">/</span>
				<span class="traffic-up">{formatBytes(todayTx)}</span>
			</div>
		</div>

		<!-- Memory -->
		<div class="stat-row">
			<div class="stat-icon-wrap">
				<MemoryStick size={14} />
			</div>
			<div class="stat-info">
				<span class="stat-label">Memory Usage</span>
				<span class="stat-value">{memPercent()}%</span>
			</div>
			<div class="mini-bar-wrap">
				<div class="mini-bar" class:warning={memPercent() > 80} style="width: {memPercent()}%"></div>
			</div>
		</div>
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
	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 16px;
	}

	.stat-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.stat-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.stat-row:last-child {
		border-bottom: none;
	}

	.stat-icon-wrap {
		color: var(--color-text-muted);
		flex-shrink: 0;
		width: 20px;
		display: flex;
		justify-content: center;
	}

	.stat-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.stat-label {
		font-size: 12px;
		color: var(--color-text-secondary);
	}
	.stat-value {
		font-size: 13px;
		font-family: var(--font-mono);
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.mini-bar-wrap {
		width: 60px;
		height: 4px;
		background: var(--color-surface-600);
		border-radius: var(--radius-full);
		overflow: hidden;
		flex-shrink: 0;
	}
	.mini-bar {
		height: 100%;
		background: var(--color-accent);
		border-radius: var(--radius-full);
		transition: width 0.5s ease;
	}
	.mini-bar.warning {
		background: var(--color-warning);
	}

	.traffic-split {
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
		flex-shrink: 0;
		display: flex;
		gap: 2px;
	}
	.traffic-down {
		color: var(--color-chart-blue);
	}
	.traffic-sep {
		color: var(--color-text-muted);
	}
	.traffic-up {
		color: var(--color-chart-cyan);
	}
</style>
