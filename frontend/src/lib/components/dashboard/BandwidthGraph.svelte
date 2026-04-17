<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import { formatSpeed, formatBytes } from '$utils/format';
	import { ArrowDown, ArrowUp, TrendingUp, Clock } from 'lucide-svelte';
	import uPlot from 'uplot';

	let chartEl: HTMLDivElement;
	let chart: uPlot | null = null;

	let timestamps: number[] = [];
	let rxData: number[] = [];
	let txData: number[] = [];

	let currentRx = $state(0);
	let currentTx = $state(0);
	let timeRange = $state<'1H' | '24H'>('1H');

	// Stats from backend
	let peakRxRate = $state(0);
	let peakTxRate = $state(0);
	let todayRxBytes = $state(0);
	let todayTxBytes = $state(0);

	async function loadHistoricalData() {
		try {
			const seconds = timeRange === '24H' ? 86400 : 3600;
			const data = await call<{ ts: number[]; rx: number[]; tx: number[] }>(
				'laubter-stats', 'get_history', { seconds }
			);
			if (data.ts?.length > 0) {
				timestamps = data.ts;
				rxData = data.rx;
				txData = data.tx;
				updateChart();
			}
		} catch {
			// Plugin may not have data yet
		}
	}

	async function loadStats() {
		try {
			const stats = await call<{
				peak_rx: number; peak_tx: number;
				today_rx: number; today_tx: number;
			}>('laubter-stats', 'get_peaks', {});
			peakRxRate = stats.peak_rx || 0;
			peakTxRate = stats.peak_tx || 0;
			todayRxBytes = stats.today_rx || 0;
			todayTxBytes = stats.today_tx || 0;
		} catch { /* stats not available yet */ }
	}

	function updateChart() {
		if (chart && timestamps.length > 0) {
			chart.setData([
				new Float64Array(timestamps),
				new Float64Array(rxData),
				new Float64Array(txData)
			]);
		}
	}

	async function sampleCurrent() {
		try {
			const data = await call<{ ts: number; rx_rate: number; tx_rate: number }>(
				'laubter-stats', 'get_current', {}
			);

			currentRx = data.rx_rate || 0;
			currentTx = data.tx_rate || 0;

			// Append live data point in 1H mode
			if (timeRange === '1H' && data.ts > 0) {
				timestamps.push(data.ts);
				rxData.push(data.rx_rate || 0);
				txData.push(data.tx_rate || 0);

				// Keep max 1 hour of data
				const cutoff = data.ts - 3600;
				while (timestamps.length > 0 && timestamps[0] < cutoff) {
					timestamps.shift();
					rxData.shift();
					txData.shift();
				}
				updateChart();
			}
		} catch { /* */ }
	}

	function switchRange(range: '1H' | '24H') {
		timeRange = range;
		loadHistoricalData();
	}

	let sampleInterval: ReturnType<typeof setInterval>;
	let statsInterval: ReturnType<typeof setInterval>;
	let resizeObserver: ResizeObserver;

	onMount(async () => {
		const opts: uPlot.Options = {
			width: chartEl.clientWidth || 600,
			height: 180,
			cursor: { show: true, x: true, y: false },
			select: { show: false, left: 0, top: 0, width: 0, height: 0 },
			legend: { show: false },
			axes: [
				{
					stroke: '#303846',
					grid: { stroke: '#1c2333', width: 1 },
					ticks: { show: false },
					font: '11px Inter, sans-serif',
					values: (_: uPlot, ticks: number[]) =>
						ticks.map((v: number) => {
							const d = new Date(v * 1000);
							return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
						})
				},
				{
					stroke: '#303846',
					grid: { stroke: '#1c2333', width: 1 },
					ticks: { show: false },
					font: '11px Inter, sans-serif',
					size: 70,
					values: (_: uPlot, ticks: number[]) => ticks.map((v: number) => formatSpeed(v))
				}
			],
			series: [
				{},
				{ label: 'Download', stroke: '#006fff', fill: 'rgba(0, 111, 255, 0.15)', width: 2 },
				{ label: 'Upload', stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.1)', width: 2 }
			]
		};

		chart = new uPlot(opts, [new Float64Array(0), new Float64Array(0), new Float64Array(0)], chartEl);

		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.contentRect.width > 0)
					chart?.setSize({ width: entry.contentRect.width, height: 180 });
			}
		});
		resizeObserver.observe(chartEl);

		// Load historical data and stats
		await loadHistoricalData();
		await loadStats();

		// Start live sampling every 2s
		sampleInterval = setInterval(sampleCurrent, 2000);

		// Refresh stats every 30s
		statsInterval = setInterval(loadStats, 30000);
	});

	onDestroy(() => {
		clearInterval(sampleInterval);
		clearInterval(statsInterval);
		resizeObserver?.disconnect();
		chart?.destroy();
	});
</script>

<div class="card">
	<div class="card-header">
		<h3 class="card-title">Bandwidth</h3>
		<div class="header-right">
			<div class="current-rates">
				<span class="rate download">
					<ArrowDown size={14} />
					{formatSpeed(currentRx)}
				</span>
				<span class="rate upload">
					<ArrowUp size={14} />
					{formatSpeed(currentTx)}
				</span>
			</div>
			<div class="range-buttons">
				<button class:active={timeRange === '1H'} onclick={() => switchRange('1H')}>1H</button>
				<button class:active={timeRange === '24H'} onclick={() => switchRange('24H')}>24H</button>
			</div>
		</div>
	</div>

	<div class="chart-container" bind:this={chartEl}></div>

	<!-- Stats row -->
	<div class="stats-row">
		<div class="stat">
			<TrendingUp size={13} />
			<span class="stat-label">Peak ↓</span>
			<span class="stat-value">{formatSpeed(peakRxRate)}</span>
		</div>
		<div class="stat">
			<TrendingUp size={13} />
			<span class="stat-label">Peak ↑</span>
			<span class="stat-value">{formatSpeed(peakTxRate)}</span>
		</div>
		<div class="stat">
			<Clock size={13} />
			<span class="stat-label">Today ↓</span>
			<span class="stat-value">{formatBytes(todayRxBytes)}</span>
		</div>
		<div class="stat">
			<Clock size={13} />
			<span class="stat-label">Today ↑</span>
			<span class="stat-value">{formatBytes(todayTxBytes)}</span>
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
	}
	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.card-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.header-right {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.current-rates {
		display: flex;
		gap: 16px;
	}
	.rate {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 14px;
		font-weight: 600;
		font-family: var(--font-mono);
	}
	.rate.download { color: var(--color-chart-blue); }
	.rate.upload { color: var(--color-chart-cyan); }

	.range-buttons {
		display: flex;
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.range-buttons button {
		padding: 4px 12px;
		background: var(--color-surface-700);
		border: none;
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.range-buttons button:not(:last-child) {
		border-right: 1px solid var(--color-surface-500);
	}
	.range-buttons button.active {
		background: var(--color-accent-muted);
		color: var(--color-accent-light);
	}

	.chart-container {
		width: 100%;
		min-height: 180px;
	}

	.stats-row {
		display: flex;
		gap: 24px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--color-surface-600);
		flex-wrap: wrap;
	}
	.stat {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text-muted);
	}
	.stat-label {
		color: var(--color-text-secondary);
	}
	.stat-value {
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-weight: 500;
	}

	:global(.u-wrap) { width: 100% !important; }
</style>
