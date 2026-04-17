<script lang="ts">
	import { onMount } from 'svelte';
	import { call } from '$api/ubus';
	import { formatBytes } from '$utils/format';

	interface SpeedResult {
		timestamp: string;
		user_info: { IP: string; Isp: string };
		servers: Array<{
			name: string;
			country: string;
			sponsor: string;
			distance: number;
			latency: number;
			jitter: number;
			dl_speed: number;
			ul_speed: number;
			packet_loss: { sent: number; dup: number; max: number };
		}>;
	}

	let running = $state(false);
	let phase = $state<'idle' | 'ping' | 'download' | 'upload' | 'done'>('idle');
	let lastResult = $state<SpeedResult | null>(null);
	let history = $state<SpeedResult[]>([]);
	let error = $state('');

	// Animated gauge values
	let gaugeDownload = $state(0);
	let gaugeUpload = $state(0);
	let gaugePing = $state(0);

	// Results
	let dlSpeed = $state(0);
	let ulSpeed = $state(0);
	let ping = $state(0);
	let jitter = $state(0);
	let serverName = $state('');
	let isp = $state('');
	let publicIp = $state('');

	function bitsToMbps(bps: number): number {
		return Math.round((bps / 1_000_000) * 100) / 100;
	}

	function nsToMs(ns: number): number {
		return Math.round(ns / 1_000_000 * 10) / 10;
	}

	// SVG speedometer gauge
	function gaugeArc(percent: number): string {
		// 270-degree arc from -225 to 45 degrees
		const clamp = Math.max(0, Math.min(100, percent));
		const angle = (clamp / 100) * 270;
		const rad = ((angle - 225) * Math.PI) / 180;
		const r = 90;
		const cx = 100, cy = 100;
		const x = cx + r * Math.cos(rad);
		const y = cy + r * Math.sin(rad);
		const largeArc = angle > 180 ? 1 : 0;
		// Start point at -225 degrees
		const startRad = (-225 * Math.PI) / 180;
		const sx = cx + r * Math.cos(startRad);
		const sy = cy + r * Math.sin(startRad);
		return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`;
	}

	// Background arc (full 270 degrees)
	const bgArc = (() => {
		const r = 90, cx = 100, cy = 100;
		const startRad = (-225 * Math.PI) / 180;
		const endRad = (45 * Math.PI) / 180;
		const sx = cx + r * Math.cos(startRad);
		const sy = cy + r * Math.sin(startRad);
		const ex = cx + r * Math.cos(endRad);
		const ey = cy + r * Math.sin(endRad);
		return `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`;
	})();

	// Total arc length for stroke-dashoffset animation
	const ARC_LENGTH = (270 / 360) * 2 * Math.PI * 90; // ~424

	function gaugeOffset(percent: number): number {
		const clamp = Math.max(0, Math.min(100, percent));
		return ARC_LENGTH * (1 - clamp / 100);
	}

	const GAUGE_MAX = 2500; // 2.5 Gbps max

	function speedToPercent(mbps: number): number {
		return Math.min(100, (mbps / GAUGE_MAX) * 100);
	}

	// Generate tick marks around the gauge arc
	// Ticks at 0, 250, 500, 750, 1000, 1500, 2000, 2500
	const gaugeTicks = [0, 250, 500, 750, 1000, 1500, 2000, 2500];

	function tickPosition(value: number): { x: number; y: number; lx: number; ly: number } {
		const pct = value / GAUGE_MAX;
		const angle = pct * 270 - 225;
		const rad = (angle * Math.PI) / 180;
		const r = 90, lr = 76, cx = 100, cy = 100;
		return {
			x: cx + r * Math.cos(rad),
			y: cy + r * Math.sin(rad),
			lx: cx + lr * Math.cos(rad),
			ly: cy + lr * Math.sin(rad)
		};
	}

	function tickLabel(value: number): string {
		if (value >= 1000) return `${value / 1000}G`;
		return `${value}`;
	}

	interface Progress {
		phase: string;
		download: number;
		upload: number;
		ping: number;
		jitter: number;
		server: string;
		progress: number;
	}

	let progressPercent = $state(0);

	async function runTest() {
		running = true;
		error = '';
		phase = 'ping';
		gaugeDownload = 0;
		gaugeUpload = 0;
		gaugePing = 0;
		dlSpeed = 0;
		ulSpeed = 0;
		ping = 0;
		jitter = 0;
		progressPercent = 0;

		try {
			// Start the test (non-blocking)
			const startRes = await call<{ status: string }>('laubter-speedtest', 'start', {});
			if (startRes.status === 'already_running') {
				// Already running, just poll
			}

			// Poll progress every second
			const pollTimer = setInterval(async () => {
				try {
					const p = await call<Progress>('laubter-speedtest', 'get_progress', {});
					phase = p.phase as any;
					progressPercent = p.progress;

					// Live gauge update — show real-time throughput on the active gauge
					if (p.phase === 'download') {
						gaugeDownload = p.live_speed || p.download || 0;
						dlSpeed = p.download || 0; // backend-tracked peak
					} else if (p.phase === 'upload') {
						gaugeDownload = p.download; // freeze download at peak
						gaugeUpload = p.live_speed || p.upload || 0;
						ulSpeed = p.upload || 0; // backend-tracked peak
					} else if (p.phase === 'ping') {
						// Pulsing effect during ping
					}

					if (p.phase === 'done') {
						clearInterval(pollTimer);
						gaugePing = p.ping;
						ping = p.ping;
						jitter = p.jitter;
						// Use backend peak values for final gauge (WAN counter peaks, not speedtest-go)
						// p.download/p.upload in 'done' phase are from speedtest-go (can differ from WAN peaks)
						// So use whichever is higher: the last live gauge value or the done values
						gaugeDownload = Math.max(gaugeDownload, p.download || 0);
						gaugeUpload = Math.max(gaugeUpload, p.upload || 0);
						dlSpeed = gaugeDownload;
						ulSpeed = gaugeUpload;
						phase = 'done';
						running = false;

						// Load full result for details (server, ISP, etc) but don't overwrite gauges
						try {
							const full = await call<SpeedResult>('laubter-speedtest', 'get_last', {});
							if (!(full as any).error) {
								lastResult = full;
								const srv = full.servers?.[0];
								if (srv) {
									serverName = `${srv.name}, ${srv.country} (${srv.sponsor})`;
								}
								isp = full.user_info?.Isp ?? '';
								publicIp = full.user_info?.IP ?? '';
							}
						} catch {}
						await loadHistory();
					} else if (p.phase === 'error') {
						clearInterval(pollTimer);
						error = p.server || 'Speed test failed';
						phase = 'idle';
						running = false;
					}
				} catch {}
			}, 1000);

			// Safety timeout — stop polling after 60 seconds
			setTimeout(() => {
				clearInterval(pollTimer);
				if (running) {
					running = false;
					phase = 'idle';
					error = 'Speed test timed out';
				}
			}, 60000);

		} catch (e) {
			error = e instanceof Error ? e.message : 'Speed test failed';
			phase = 'idle';
			running = false;
		}
	}

	async function loadLast() {
		try {
			const result = await call<SpeedResult>('laubter-speedtest', 'get_last', {});
			if (!(result as any).error) {
				lastResult = result;
				const srv = result.servers?.[0];
				if (srv) {
					serverName = `${srv.name}, ${srv.country} (${srv.sponsor})`;
					ping = nsToMs(srv.latency);
					jitter = nsToMs(srv.jitter);
				}
				isp = result.user_info?.Isp ?? '';
				publicIp = result.user_info?.IP ?? '';
				// Don't set gauges from stored results — they use different measurement
				// Gauges only show values from live WAN monitoring during a test run
			}
		} catch {}
	}

	async function loadHistory() {
		try {
			const results = await call<SpeedResult[]>('laubter-speedtest', 'get_history', {});
			if (Array.isArray(results)) {
				history = results.reverse();
			}
		} catch {}
	}

	onMount(() => {
		loadHistory();
	});
</script>

<div class="page">
	<h1>Speed Test</h1>
	<p class="subtitle">Measure your router's internet connection speed</p>

	<!-- Gauges -->
	<div class="gauges-row">
		<div class="gauge-card">
			<svg viewBox="0 0 200 160" class="gauge-svg">
				<path d={bgArc} fill="none" stroke="var(--color-surface-600)" stroke-width="8" stroke-linecap="round" />
				{#each gaugeTicks as tick}
					{@const pos = tickPosition(tick)}
					<line x1={pos.x} y1={pos.y} x2={pos.lx} y2={pos.ly} stroke="var(--color-surface-500)" stroke-width="1.5" />
					<text x={pos.lx} y={pos.ly} text-anchor="middle" dominant-baseline="middle" fill="var(--color-text-muted)" font-size="7" font-family="var(--font-mono)">{tickLabel(tick)}</text>
				{/each}
				<path d={bgArc} fill="none" stroke="#006fff" stroke-width="8" stroke-linecap="round"
					class="gauge-fill"
					stroke-dasharray={ARC_LENGTH}
					stroke-dashoffset={gaugeOffset(speedToPercent(gaugeDownload))} />
				<text x="100" y="88" text-anchor="middle" fill="var(--color-text-primary)" font-size="30" font-weight="700" font-family="var(--font-mono)">
					{gaugeDownload > 0 ? gaugeDownload.toFixed(0) : '—'}
				</text>
				<text x="100" y="108" text-anchor="middle" fill="var(--color-text-muted)" font-size="11">Mbps</text>
			</svg>
			<span class="gauge-label">Download</span>
		</div>

		<div class="gauge-card">
			<svg viewBox="0 0 200 160" class="gauge-svg">
				<path d={bgArc} fill="none" stroke="var(--color-surface-600)" stroke-width="8" stroke-linecap="round" />
				{#each gaugeTicks as tick}
					{@const pos = tickPosition(tick)}
					<line x1={pos.x} y1={pos.y} x2={pos.lx} y2={pos.ly} stroke="var(--color-surface-500)" stroke-width="1.5" />
					<text x={pos.lx} y={pos.ly} text-anchor="middle" dominant-baseline="middle" fill="var(--color-text-muted)" font-size="7" font-family="var(--font-mono)">{tickLabel(tick)}</text>
				{/each}
				<path d={bgArc} fill="none" stroke="#06b6d4" stroke-width="8" stroke-linecap="round"
					class="gauge-fill"
					stroke-dasharray={ARC_LENGTH}
					stroke-dashoffset={gaugeOffset(speedToPercent(gaugeUpload))} />
				<text x="100" y="88" text-anchor="middle" fill="var(--color-text-primary)" font-size="30" font-weight="700" font-family="var(--font-mono)">
					{gaugeUpload > 0 ? gaugeUpload.toFixed(0) : '—'}
				</text>
				<text x="100" y="108" text-anchor="middle" fill="var(--color-text-muted)" font-size="11">Mbps</text>
			</svg>
			<span class="gauge-label">Upload</span>
		</div>
	</div>

	<!-- Ping/Jitter strip -->
	<div class="ping-strip">
		<div class="ping-item">
			<span class="ping-label">Ping</span>
			<span class="ping-val">{ping > 0 ? ping.toFixed(1) : '—'} <small>ms</small></span>
		</div>
		<div class="ping-sep"></div>
		<div class="ping-item">
			<span class="ping-label">Jitter</span>
			<span class="ping-val">{jitter > 0 ? jitter.toFixed(1) : '—'} <small>ms</small></span>
		</div>
	</div>

	<!-- Run button -->
	<div class="action-row">
		<button class="run-btn" onclick={runTest} disabled={running}>
			{#if running}
				<span class="spinner"></span>
				{#if phase === 'ping'}Testing latency...
				{:else if phase === 'download'}Measuring download...
				{:else if phase === 'upload'}Measuring upload...
				{:else}Starting...
				{/if}
			{:else}
				Run Speed Test
			{/if}
		</button>
	</div>

	{#if error}
		<div class="error-msg">{error}</div>
	{/if}

	<!-- Result details -->
	{#if phase === 'done' && lastResult}
		<div class="result-details">
			<div class="detail"><span class="dl">Server</span><span class="dv">{serverName}</span></div>
			<div class="detail"><span class="dl">ISP</span><span class="dv">{isp}</span></div>
			<div class="detail"><span class="dl">Public IP</span><span class="dv mono">{publicIp}</span></div>
			<div class="detail"><span class="dl">Tested</span><span class="dv">{lastResult.timestamp}</span></div>
		</div>
	{/if}

	<!-- History -->
	{#if history.length > 0}
		<div class="history-section">
			<h2>History</h2>
			<div class="history-table">
				<table>
					<thead>
						<tr>
							<th>Date</th>
							<th>Download</th>
							<th>Upload</th>
							<th>Ping</th>
							<th>Server</th>
						</tr>
					</thead>
					<tbody>
						{#each history as result}
							{@const srv = result.servers?.[0]}
							<tr>
								<td class="mono">{result.timestamp?.split('.')[0] ?? '—'}</td>
								<td class="mono dl-val">{srv ? bitsToMbps(srv.dl_speed).toFixed(1) : '—'} Mbps</td>
								<td class="mono ul-val">{srv ? bitsToMbps(srv.ul_speed).toFixed(1) : '—'} Mbps</td>
								<td class="mono">{srv ? nsToMs(srv.latency).toFixed(1) : '—'} ms</td>
								<td>{srv?.name ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 24px; max-width: 900px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: -16px 0 0; }

	.gauge-fill { transition: stroke-dashoffset 0.8s ease-out; }

	/* Gauges — two columns filling width */
	.gauges-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.gauge-card {
		display: flex; flex-direction: column; align-items: center; gap: 4px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 16px; padding: 24px 16px 16px;
	}
	.gauge-svg { width: 220px; height: 170px; }
	.gauge-label { font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }

	/* Ping/Jitter strip */
	.ping-strip {
		display: flex; align-items: center; justify-content: center; gap: 32px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 12px; padding: 12px 24px;
	}
	.ping-item { display: flex; align-items: center; gap: 10px; }
	.ping-label { font-size: 12px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
	.ping-val { font-size: 18px; font-weight: 700; color: var(--color-text-primary); font-family: var(--font-mono); }
	.ping-val small { font-size: 12px; font-weight: 400; color: var(--color-text-muted); }
	.ping-sep { width: 1px; height: 24px; background: var(--color-surface-500); }

	@media (max-width: 600px) {
		.gauges-row { grid-template-columns: 1fr; }
	}

	/* Run button */
	.action-row { display: flex; justify-content: center; }
	.run-btn {
		padding: 14px 48px; background: var(--color-accent); color: white;
		border: none; border-radius: 12px; font-size: 16px; font-weight: 600;
		cursor: pointer; transition: all 0.2s ease; font-family: inherit;
		display: flex; align-items: center; gap: 10px;
	}
	.run-btn:hover:not(:disabled) { background: var(--color-accent-hover); transform: scale(1.02); }
	.run-btn:disabled { opacity: 0.7; cursor: wait; }

	.spinner {
		width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3);
		border-top-color: white; border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.error-msg { text-align: center; color: var(--color-danger); font-size: 14px; }

	/* Result details */
	.result-details {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 12px; padding: 16px 20px;
		display: flex; flex-direction: column; gap: 8px;
	}
	.detail { display: flex; justify-content: space-between; font-size: 13px; }
	.dl { color: var(--color-text-muted); }
	.dv { color: var(--color-text-primary); }
	.mono { font-family: var(--font-mono); font-size: 12px; }

	/* History */
	.history-section { display: flex; flex-direction: column; gap: 12px; }
	.history-section h2 { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.history-table {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; overflow-x: auto;
	}
	table { width: 100%; border-collapse: collapse; }
	thead th {
		text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 600;
		color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;
		border-bottom: 1px solid var(--color-surface-500);
	}
	tbody td { padding: 10px 14px; font-size: 13px; color: var(--color-text-primary); border-bottom: 1px solid var(--color-surface-700); }
	tbody tr:last-child td { border-bottom: none; }
	tbody tr:hover td { background: rgba(255,255,255,0.03); }
	.dl-val { color: #006fff; }
	.ul-val { color: #06b6d4; }
</style>
