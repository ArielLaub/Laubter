<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import { formatSpeed, formatBytes } from '$utils/format';
	import uPlot from 'uplot';

	let timeRange = $state<'1H' | '6H' | '24H'>('1H');
	let loading = $state(true);

	// Current values
	let currentCpu = $state(0);
	let currentTemp = $state(0);
	let currentMem = $state(0);
	let currentConns = $state(0);
	let peakRx = $state(0);
	let todayRx = $state(0);
	let todayTx = $state(0);

	// Chart elements — 6 separate charts
	let dlChartEl: HTMLDivElement;
	let ulChartEl: HTMLDivElement;
	let cpuChartEl: HTMLDivElement;
	let tempChartEl: HTMLDivElement;
	let memChartEl: HTMLDivElement;
	let connsChartEl: HTMLDivElement;

	let dlChart: uPlot | null = null;
	let ulChart: uPlot | null = null;
	let cpuChart: uPlot | null = null;
	let tempChart: uPlot | null = null;
	let memChart: uPlot | null = null;
	let connsChart: uPlot | null = null;

	let histTs: number[] = [];
	let histRx: number[] = [];
	let histTx: number[] = [];
	let histCpu: number[] = [];
	let histTemp: number[] = [];
	let histMem: number[] = [];
	let histConns: number[] = [];

	let resizeObserver: ResizeObserver;
	let pollInterval: ReturnType<typeof setInterval>;
	let peaksInterval: ReturnType<typeof setInterval>;

	const rangeSeconds: Record<string, number> = { '1H': 3600, '6H': 21600, '24H': 86400 };
	const CHART_HEIGHT = 200;

	const axisFont = '12px Inter, sans-serif';
	const axisColor = '#8b949e';
	const gridColor = '#1c2333';

	function timeAxis(): uPlot.Axis {
		return {
			stroke: axisColor,
			grid: { stroke: gridColor, width: 1 },
			ticks: { show: false },
			font: axisFont,
			values: (_: uPlot, ticks: number[]) =>
				ticks.map((v: number) => {
					const d = new Date(v * 1000);
					return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
				})
		};
	}

	function valAxis(size: number, fmt: (v: number) => string): uPlot.Axis {
		return {
			stroke: axisColor,
			grid: { stroke: gridColor, width: 1 },
			ticks: { show: false },
			font: axisFont,
			size,
			values: (_: uPlot, ticks: number[]) => ticks.map(fmt)
		};
	}

	function makeChart(el: HTMLDivElement, label: string, color: string, fill: string, ySize: number, yFmt: (v: number) => string): uPlot {
		return new uPlot({
			width: el.clientWidth || 400,
			height: CHART_HEIGHT,
			cursor: { show: true, x: true, y: false },
			select: { show: false, left: 0, top: 0, width: 0, height: 0 },
			legend: { show: false },
			axes: [timeAxis(), valAxis(ySize, yFmt)],
			series: [
				{},
				{ label, stroke: color, fill, width: 2 }
			]
		}, [new Float64Array(0), new Float64Array(0)], el);
	}

	function updateChart(chart: uPlot | null, ts: number[], data: number[]) {
		if (!chart || ts.length === 0) return;
		chart.setData([new Float64Array(ts), new Float64Array(data)]);
	}

	function updateAll() {
		updateChart(dlChart, histTs, histRx);
		updateChart(ulChart, histTs, histTx);
		updateChart(cpuChart, histTs, histCpu);
		updateChart(tempChart, histTs, histTemp);
		updateChart(memChart, histTs, histMem);
		updateChart(connsChart, histTs, histConns);
	}

	async function loadHistory() {
		loading = true;
		try {
			const data = await call<{
				ts: number[]; rx: number[]; tx: number[];
				cpu: number[]; mem: number[]; temp: number[]; conns: number[];
			}>('laubter-stats', 'get_history', { seconds: rangeSeconds[timeRange] });

			if (data.ts?.length > 0) {
				histTs = data.ts;
				histRx = data.rx;
				histTx = data.tx;
				histCpu = data.cpu;
				histTemp = data.temp.map(t => t / 10); // centidegrees to °C
				histMem = data.mem.map(m => m / 1024); // KB to MB
				histConns = data.conns;
				updateAll();
			}
		} catch {} finally { loading = false; }
	}

	async function loadPeaks() {
		try {
			const p = await call<{
				peak_rx: number; today_rx: number; today_tx: number;
			}>('laubter-stats', 'get_peaks', {});
			peakRx = p.peak_rx || 0;
			todayRx = p.today_rx || 0;
			todayTx = p.today_tx || 0;
		} catch {}
	}

	async function pollCurrent() {
		try {
			const d = await call<{
				ts: number; rx_rate: number; tx_rate: number;
				cpu_pct: number; mem_used_kb: number; temp_mc: number; conns: number;
			}>('laubter-stats', 'get_current', {});

			currentCpu = d.cpu_pct || 0;
			currentTemp = (d.temp_mc || 0) / 1000;
			currentMem = (d.mem_used_kb || 0) / 1024;
			currentConns = d.conns || 0;

			if (d.ts > 0) {
				histTs.push(d.ts);
				histRx.push(d.rx_rate || 0);
				histTx.push(d.tx_rate || 0);
				histCpu.push(d.cpu_pct || 0);
				histTemp.push((d.temp_mc || 0) / 1000);
				histMem.push((d.mem_used_kb || 0) / 1024);
				histConns.push(d.conns || 0);

				const cutoff = d.ts - rangeSeconds[timeRange];
				while (histTs.length > 0 && histTs[0] < cutoff) {
					histTs.shift(); histRx.shift(); histTx.shift();
					histCpu.shift(); histTemp.shift(); histMem.shift(); histConns.shift();
				}
				updateAll();
			}
		} catch {}
	}

	function switchRange(range: '1H' | '6H' | '24H') {
		timeRange = range;
		loadHistory();
	}

	onMount(async () => {
		dlChart = makeChart(dlChartEl, 'Download', '#006fff', 'rgba(0,111,255,0.15)', 70, v => formatSpeed(v));
		ulChart = makeChart(ulChartEl, 'Upload', '#06b6d4', 'rgba(6,182,212,0.15)', 70, v => formatSpeed(v));
		cpuChart = makeChart(cpuChartEl, 'CPU', '#22c55e', 'rgba(34,197,94,0.12)', 50, v => `${Math.round(v)}%`);
		tempChart = makeChart(tempChartEl, 'Temp', '#f59e0b', 'rgba(245,158,11,0.12)', 50, v => `${Math.round(v)}°C`);
		memChart = makeChart(memChartEl, 'Memory', '#a855f7', 'rgba(168,85,247,0.12)', 60, v => `${Math.round(v)} MB`);
		connsChart = makeChart(connsChartEl, 'Connections', '#14b8a6', 'rgba(20,184,166,0.12)', 60, v => `${Math.round(v)}`);

		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const w = entry.contentRect.width;
				if (w <= 0) continue;
				const charts: [HTMLDivElement, uPlot | null][] = [
					[dlChartEl, dlChart], [ulChartEl, ulChart],
					[cpuChartEl, cpuChart], [tempChartEl, tempChart],
					[memChartEl, memChart], [connsChartEl, connsChart]
				];
				for (const [el, ch] of charts) {
					if (entry.target === el) ch?.setSize({ width: w, height: CHART_HEIGHT });
				}
			}
		});
		[dlChartEl, ulChartEl, cpuChartEl, tempChartEl, memChartEl, connsChartEl].forEach(el => resizeObserver.observe(el));

		await loadHistory();
		await loadPeaks();
		await pollCurrent();
		pollInterval = setInterval(pollCurrent, 5000);
		peaksInterval = setInterval(loadPeaks, 30000);
	});

	onDestroy(() => {
		clearInterval(pollInterval);
		clearInterval(peaksInterval);
		resizeObserver?.disconnect();
		[dlChart, ulChart, cpuChart, tempChart, memChart, connsChart].forEach(c => c?.destroy());
	});
</script>

<div class="stats-page">
	<div class="page-header">
		<h1>Statistics</h1>
		<div class="range-buttons">
			<button class:active={timeRange === '1H'} onclick={() => switchRange('1H')}>1H</button>
			<button class:active={timeRange === '6H'} onclick={() => switchRange('6H')}>6H</button>
			<button class:active={timeRange === '24H'} onclick={() => switchRange('24H')}>24H</button>
		</div>
	</div>

	<!-- Summary cards -->
	<div class="summary-row">
		<div class="summary-card"><span class="sv">{Math.round(currentCpu)}%</span><span class="sl">CPU</span></div>
		<div class="summary-card"><span class="sv">{Math.round(currentTemp)}°C</span><span class="sl">Temperature</span></div>
		<div class="summary-card"><span class="sv">{Math.round(currentMem)} MB</span><span class="sl">Memory Used</span></div>
		<div class="summary-card"><span class="sv">{currentConns.toLocaleString()}</span><span class="sl">Connections</span></div>
		<div class="summary-card"><span class="sv">{formatSpeed(peakRx)}</span><span class="sl">Peak Download</span></div>
		<div class="summary-card"><span class="sv">{formatBytes(todayRx + todayTx)}</span><span class="sl">Today Total</span></div>
	</div>

	<!-- 2-column chart grid -->
	<div class="chart-grid">
		<div class="chart-card">
			<h2 class="chart-title">Download</h2>
			<div class="chart-wrap" bind:this={dlChartEl}></div>
		</div>
		<div class="chart-card">
			<h2 class="chart-title">Upload</h2>
			<div class="chart-wrap" bind:this={ulChartEl}></div>
		</div>
		<div class="chart-card">
			<h2 class="chart-title">CPU Usage</h2>
			<div class="chart-wrap" bind:this={cpuChartEl}></div>
		</div>
		<div class="chart-card">
			<h2 class="chart-title">Temperature</h2>
			<div class="chart-wrap" bind:this={tempChartEl}></div>
		</div>
		<div class="chart-card">
			<h2 class="chart-title">Memory Usage</h2>
			<div class="chart-wrap" bind:this={memChartEl}></div>
		</div>
		<div class="chart-card">
			<h2 class="chart-title">Active Connections</h2>
			<div class="chart-wrap" bind:this={connsChartEl}></div>
		</div>
	</div>
</div>

<style>
	.stats-page { display: flex; flex-direction: column; gap: 20px; max-width: 1400px; }

	.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
	.page-header h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0; }

	.range-buttons {
		display: flex; border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); overflow: hidden;
	}
	.range-buttons button {
		padding: 8px 16px; background: var(--color-surface-800); border: none;
		color: var(--color-text-secondary); font-size: 13px; font-weight: 500;
		cursor: pointer; transition: all 0.15s ease; font-family: inherit;
	}
	.range-buttons button:not(:last-child) { border-right: 1px solid var(--color-surface-500); }
	.range-buttons button.active { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.range-buttons button:hover:not(.active) { background: var(--color-surface-700); }

	.summary-row {
		display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px;
	}
	.summary-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 16px;
		display: flex; flex-direction: column; align-items: center; gap: 4px;
	}
	.sv { font-size: 20px; font-weight: 700; color: var(--color-text-primary); font-family: var(--font-mono); line-height: 1.2; }
	.sl { font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

	.chart-grid {
		display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
	}
	.chart-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 16px;
	}
	.chart-title {
		font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 8px;
	}
	.chart-wrap { width: 100%; min-height: 200px; }

	:global(.u-wrap) { width: 100% !important; }

	@media (max-width: 1000px) {
		.summary-row { grid-template-columns: repeat(3, 1fr); }
		.chart-grid { grid-template-columns: 1fr; }
	}
	@media (max-width: 600px) {
		.summary-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
