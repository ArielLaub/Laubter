<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { systemBoard, systemInfo } from '$stores/system';
	import { formatUptime, formatBytes, formatLoad } from '$utils/format';
	import { call } from '$api/ubus';
	import { HardDrive, Clock } from 'lucide-svelte';

	const memUsed = $derived(
		$systemInfo
			? $systemInfo.memory.total - ($systemInfo.memory.available ?? $systemInfo.memory.free)
			: 0
	);
	const memTotal = $derived($systemInfo?.memory.total ?? 0);
	const memPercent = $derived(memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0);

	const loadAvg = $derived($systemInfo ? formatLoad($systemInfo.load[0]) : '0.00');

	const rootUsed = $derived($systemInfo?.root?.used ?? 0);
	const rootTotal = $derived($systemInfo?.root?.total ?? 0);
	const rootPercent = $derived(rootTotal > 0 ? Math.round((rootUsed / rootTotal) * 100) : 0);

	// CPU % and Temperature from laubter-stats (real CPU usage, not load average)
	let cpuPercent = $state(0);
	let tempC = $state(0);
	let tempPercent = $derived(Math.max(0, Math.min(100, ((tempC - 30) / (90 - 30)) * 100)));
	let statsInterval: ReturnType<typeof setInterval>;

	async function fetchStats() {
		try {
			const data = await call<{ cpu_pct: number; temp_mc: number }>('laubter-stats', 'get_current', {});
			cpuPercent = data.cpu_pct ?? 0;
			tempC = (data.temp_mc ?? 0) / 1000;
		} catch { /* laubter-stats may not be available */ }
	}

	onMount(() => {
		fetchStats();
		statsInterval = setInterval(fetchStats, 5000);
	});

	onDestroy(() => {
		clearInterval(statsInterval);
	});

	// SVG circle math
	const radius = 20;
	const circumference = 2 * Math.PI * radius; // ~125.66

	const cpuOffset = $derived(circumference - (cpuPercent / 100) * circumference);
	const tempOffset = $derived(circumference - (tempPercent / 100) * circumference);
	const memOffset = $derived(circumference - (memPercent / 100) * circumference);

	function gaugeColor(percent: number): string {
		if (percent > 80) return '#ef4444';
		if (percent > 50) return '#f59e0b';
		return '#22c55e';
	}

	function tempGaugeColor(deg: number): string {
		if (deg > 75) return '#ef4444';
		if (deg >= 60) return '#f59e0b';
		return '#22c55e';
	}

	function gaugeGlow(percent: number): string {
		if (percent > 80) return '0 0 12px rgba(239, 68, 68, 0.5)';
		if (percent > 50) return '0 0 12px rgba(245, 158, 11, 0.4)';
		return '0 0 12px rgba(34, 197, 94, 0.3)';
	}

	function tempGaugeGlow(deg: number): string {
		if (deg > 75) return '0 0 12px rgba(239, 68, 68, 0.5)';
		if (deg >= 60) return '0 0 12px rgba(245, 158, 11, 0.4)';
		return '0 0 12px rgba(34, 197, 94, 0.3)';
	}
</script>

<div class="card">
	<h3 class="card-title">{$systemBoard?.hostname ?? 'Router'}</h3>
	<p class="card-subtitle">{$systemBoard?.model ?? ''}</p>

	<!-- Circular gauges -->
	<div class="gauges">
		<div class="gauge">
			<svg viewBox="0 0 48 48" width="56" height="56">
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke="var(--color-surface-600)"
					stroke-width="3"
				/>
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke={gaugeColor(cpuPercent)}
					stroke-width="3"
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={cpuOffset}
					transform="rotate(-90 24 24)"
					style="filter: drop-shadow({gaugeGlow(cpuPercent)}); transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"
				/>
				<text x="24" y="26" text-anchor="middle" fill="var(--color-text-primary)" font-size="10" font-weight="600" font-family="var(--font-mono)">{cpuPercent}%</text>
			</svg>
			<span class="gauge-label">CPU</span>
		</div>

		<div class="gauge">
			<svg viewBox="0 0 48 48" width="56" height="56">
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke="var(--color-surface-600)"
					stroke-width="3"
				/>
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke={tempGaugeColor(tempC)}
					stroke-width="3"
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={tempOffset}
					transform="rotate(-90 24 24)"
					style="filter: drop-shadow({tempGaugeGlow(tempC)}); transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"
				/>
				<text x="24" y="26" text-anchor="middle" fill="var(--color-text-primary)" font-size="9" font-weight="600" font-family="var(--font-mono)">{Math.round(tempC)}°C</text>
			</svg>
			<span class="gauge-label">Temp</span>
		</div>

		<div class="gauge">
			<svg viewBox="0 0 48 48" width="56" height="56">
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke="var(--color-surface-600)"
					stroke-width="3"
				/>
				<circle
					cx="24" cy="24" r={radius}
					fill="none"
					stroke={gaugeColor(memPercent)}
					stroke-width="3"
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={memOffset}
					transform="rotate(-90 24 24)"
					style="filter: drop-shadow({gaugeGlow(memPercent)}); transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"
				/>
				<text x="24" y="26" text-anchor="middle" fill="var(--color-text-primary)" font-size="10" font-weight="600" font-family="var(--font-mono)">{memPercent}%</text>
			</svg>
			<span class="gauge-label">Memory</span>
		</div>
	</div>

	<!-- Details below gauges -->
	<div class="details">
		<div class="detail-row">
			<Clock size={13} class="detail-icon" />
			<span class="detail-label">Uptime</span>
			<span class="detail-value">{$systemInfo ? formatUptime($systemInfo.uptime) : '—'}</span>
		</div>

		<div class="detail-row">
			<span class="detail-label" style="margin-left: 21px">Load</span>
			<span class="detail-value">{loadAvg}</span>
		</div>

		<div class="detail-row">
			<span class="detail-label" style="margin-left: 21px">RAM</span>
			<span class="detail-value">{formatBytes(memUsed)} / {formatBytes(memTotal)}</span>
		</div>

		{#if rootTotal > 0}
			<div class="detail-divider"></div>
			<div class="detail-row">
				<HardDrive size={13} class="detail-icon" />
				<span class="detail-label">Storage</span>
				<span class="detail-value">{rootPercent}% ({formatBytes(rootUsed)} / {formatBytes(rootTotal)})</span>
			</div>
		{/if}
	</div>

	<div class="version">
		{$systemBoard?.release?.distribution ?? 'OpenWrt'} {$systemBoard?.release?.version ?? ''}
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
		margin: 0;
	}
	.card-subtitle {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 2px 0 16px;
	}

	.gauges {
		display: flex;
		gap: 24px;
		justify-content: center;
		margin-bottom: 16px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.gauge {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.gauge-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.detail-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	:global(.detail-icon) {
		color: var(--color-text-muted);
		flex-shrink: 0;
	}
	.detail-label {
		color: var(--color-text-secondary);
		font-size: 12px;
		flex: 1;
	}
	.detail-value {
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.detail-divider {
		border-bottom: 1px solid var(--color-surface-600);
		margin: 4px 0;
	}
	.version {
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 16px;
	}
</style>
