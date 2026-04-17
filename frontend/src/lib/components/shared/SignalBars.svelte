<script lang="ts">
	let { signal, showValue = false }: { signal: number; showValue?: boolean } = $props();

	const bars = $derived.by(() => {
		if (signal >= -50) return 4;
		if (signal >= -60) return 3;
		if (signal >= -70) return 2;
		if (signal >= -80) return 1;
		return 0;
	});

	const color = $derived(bars >= 3 ? 'var(--color-success)' : bars >= 2 ? 'var(--color-warning)' : 'var(--color-danger)');
	const unfilled = 'var(--color-surface-500)';
</script>

<span class="signal-bars">
	<svg width="20" height="16" viewBox="0 0 20 16">
		<rect x="0" y="12" width="3.5" height="4" rx="0.5" fill={bars >= 1 ? color : unfilled} />
		<rect x="5" y="8" width="3.5" height="8" rx="0.5" fill={bars >= 2 ? color : unfilled} />
		<rect x="10" y="4" width="3.5" height="12" rx="0.5" fill={bars >= 3 ? color : unfilled} />
		<rect x="15" y="0" width="3.5" height="16" rx="0.5" fill={bars >= 4 ? color : unfilled} />
	</svg>
	{#if showValue}
		<span class="signal-value">{signal} dBm</span>
	{/if}
</span>

<style>
	.signal-bars {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.signal-value {
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
	}
</style>
