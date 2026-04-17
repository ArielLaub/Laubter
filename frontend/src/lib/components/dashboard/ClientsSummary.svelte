<script lang="ts">
	import { wirelessClientCount, wiredClientCount, onlineClientCount } from '$stores/mesh';
	import { dhcpLeaseList } from '$stores/wireless';
	import { Users } from 'lucide-svelte';

	const totalCount = $derived($onlineClientCount > 0 ? $onlineClientCount : $dhcpLeaseList.length);
	const wirelessCount = $derived($wirelessClientCount);
	const wiredCount = $derived($wiredClientCount > 0 ? $wiredClientCount : Math.max(0, totalCount - wirelessCount));

	// Donut chart SVG math
	const donutRadius = 18;
	const donutCircumference = 2 * Math.PI * donutRadius;
	const wirelessFraction = $derived(totalCount > 0 ? wirelessCount / totalCount : 0);
	const wiredFraction = $derived(totalCount > 0 ? wiredCount / totalCount : 0);
	const wirelessArc = $derived(wirelessFraction * donutCircumference);
	const wiredArc = $derived(wiredFraction * donutCircumference);
	const wirelessOffset = $derived(0);
	const wiredOffset = $derived(-wirelessArc);
</script>

<a href="/clients" class="card">
	<h3 class="card-title">
		<Users size={16} strokeWidth={1.75} />
		Clients
	</h3>

	<div class="main-content">
		<div class="count-side">
			<div class="total-count">{totalCount}</div>
			<div class="count-label">Total Devices</div>
		</div>

		<!-- Mini donut chart -->
		<div class="donut-wrap">
			<svg viewBox="0 0 44 44" width="60" height="60">
				<!-- Background ring -->
				<circle
					cx="22" cy="22" r={donutRadius}
					fill="none"
					stroke="var(--color-surface-600)"
					stroke-width="5"
				/>
				<!-- Wireless segment -->
				{#if wirelessCount > 0}
					<circle
						cx="22" cy="22" r={donutRadius}
						fill="none"
						stroke="var(--color-accent)"
						stroke-width="5"
						stroke-linecap="butt"
						stroke-dasharray="{wirelessArc} {donutCircumference - wirelessArc}"
						stroke-dashoffset={wirelessOffset}
						transform="rotate(-90 22 22)"
						style="transition: stroke-dasharray 0.5s ease;"
					/>
				{/if}
				<!-- Wired segment -->
				{#if wiredCount > 0}
					<circle
						cx="22" cy="22" r={donutRadius}
						fill="none"
						stroke="var(--color-chart-cyan)"
						stroke-width="5"
						stroke-linecap="butt"
						stroke-dasharray="{wiredArc} {donutCircumference - wiredArc}"
						stroke-dashoffset={wiredOffset}
						transform="rotate(-90 22 22)"
						style="transition: stroke-dasharray 0.5s ease;"
					/>
				{/if}
			</svg>
		</div>
	</div>

	<div class="breakdown">
		<div class="breakdown-item">
			<div class="dot wireless"></div>
			<span class="breakdown-label">{wirelessCount} wireless</span>
		</div>
		<div class="breakdown-item">
			<div class="dot wired"></div>
			<span class="breakdown-label">{wiredCount} wired</span>
		</div>
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
	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.main-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 12px 0 16px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.count-side {
		display: flex;
		flex-direction: column;
	}
	.total-count {
		font-size: 56px;
		font-weight: 800;
		color: var(--color-text-primary);
		line-height: 1;
		letter-spacing: -1px;
	}
	.count-label {
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 4px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.donut-wrap {
		flex-shrink: 0;
	}

	.breakdown {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.breakdown-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.breakdown-label {
		font-size: 13px;
		color: var(--color-text-secondary);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot.wireless {
		background: var(--color-accent);
	}
	.dot.wired {
		background: var(--color-chart-cyan);
	}
</style>
