<script lang="ts">
	import { onMount } from 'svelte';
	import { wanInterface } from '$stores/network';
	import { call } from '$api/ubus';
	import { formatUptime } from '$utils/format';
	import { Copy, Check } from 'lucide-svelte';

	// Don't show disconnected while data is still loading
	let loaded = $state(false);
	$effect(() => {
		if ($wanInterface) loaded = true;
	});

	const isUp = $derived(loaded ? ($wanInterface?.up ?? false) : null);
	const wanIp = $derived($wanInterface?.['ipv4-address']?.[0]?.address ?? '—');
	const gateway = $derived(
		$wanInterface?.route?.find((r) => r.target === '0.0.0.0')?.nexthop ?? '—'
	);
	const dns = $derived($wanInterface?.['dns-server']?.join(', ') ?? '—');
	const proto = $derived($wanInterface?.proto ?? '—');
	const uptime = $derived($wanInterface?.uptime ?? 0);

	// Fetch real public IP
	let publicIp = $state('');
	let ddnsHostname = $state('');

	onMount(async () => {
		try {
			// Check if DDNS is configured
			const ddns = await call<{ enabled: string; domain: string }>('laubter-ddns', 'get_config', {});
			if (ddns.enabled === '1' && ddns.domain) {
				ddnsHostname = ddns.domain + '.duckdns.org';
			}
		} catch {}

		try {
			// Get public IP from DDNS status (it fetches from ipify)
			const status = await call<{ public_ip: string }>('laubter-ddns', 'get_status', {});
			if (status.public_ip) {
				publicIp = status.public_ip;
			}
		} catch {
			// Fallback: use WAN IP
		}
	});

	const displayIp = $derived(publicIp || wanIp);

	let copied = $state(false);

	function copyIp(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (displayIp && displayIp !== '—') {
			navigator.clipboard.writeText(displayIp);
			copied = true;
			setTimeout(() => copied = false, 2000);
		}
	}
</script>

<a href="/settings/internet" class="card" class:up={isUp === true} class:down={isUp === false}>
	<div class="status-header">
		{#if isUp === null}
			<div class="status-dot loading"></div>
			<div>
				<h3 class="card-title">Internet</h3>
				<p class="status-text loading-text">Checking...</p>
			</div>
		{:else}
			<div class="status-dot" class:online={isUp} class:offline={!isUp}></div>
			<div>
				<h3 class="card-title">Internet</h3>
				<p class="status-text" class:connected={isUp} class:disconnected={!isUp}>
					{isUp ? 'Connected' : 'Disconnected'}
				</p>
			</div>
		{/if}
	</div>

	{#if isUp}
		<div class="wan-ip-row">
			<span class="wan-ip">{displayIp}</span>
			<button class="copy-btn" onclick={copyIp} title="Copy IP">
				{#if copied}
					<Check size={14} />
				{:else}
					<Copy size={14} />
				{/if}
			</button>
		</div>

		{#if ddnsHostname}
			<div class="detail-row ddns-row">
				<span class="detail-label">DDNS</span>
				<span class="detail-value mono ddns-value">{ddnsHostname}</span>
			</div>
		{/if}

		{#if publicIp && wanIp !== publicIp}
			<div class="detail-row">
				<span class="detail-label">WAN IP</span>
				<span class="detail-value mono">{wanIp}</span>
			</div>
		{/if}

		<div class="details">
			<div class="detail-row">
				<span class="detail-label">Gateway</span>
				<span class="detail-value mono">{gateway}</span>
			</div>
			<div class="detail-row">
				<span class="detail-label">DNS</span>
				<span class="detail-value mono">{dns}</span>
			</div>
			<div class="detail-divider"></div>
			<div class="detail-row">
				<span class="detail-label">Protocol</span>
				<span class="detail-value">{proto.toUpperCase()}</span>
			</div>
			{#if uptime > 0}
				<div class="detail-row">
					<span class="detail-label">Uptime</span>
					<span class="detail-value">{formatUptime(uptime)}</span>
				</div>
			{/if}
		</div>
	{/if}
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
	.card.up {
		background: linear-gradient(135deg, var(--color-surface-800) 0%, rgba(0, 111, 255, 0.03) 100%);
	}
	.card:hover {
		border-color: var(--color-surface-400);
	}

	.status-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	.status-dot {
		width: 12px; height: 12px; border-radius: 50%;
		flex-shrink: 0;
	}
	.status-dot.online {
		background: var(--color-success);
		box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
		animation: pulse-green 2s ease-in-out infinite;
	}
	.status-dot.offline {
		background: var(--color-danger);
		box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
	}
	.status-dot.loading {
		background: var(--color-text-muted);
		animation: pulse-dim 1.5s ease-in-out infinite;
	}

	@keyframes pulse-green {
		0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
		50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
	}
	@keyframes pulse-dim {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}

	.card-title {
		font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin: 0;
	}
	.status-text {
		font-size: 12px; margin: 1px 0 0; font-weight: 500;
	}
	.status-text.connected { color: var(--color-success); }
	.status-text.disconnected { color: var(--color-danger); }
	.loading-text { color: var(--color-text-muted); }

	.wan-ip-row {
		display: flex; align-items: center; gap: 8px;
		margin-bottom: 10px; padding-bottom: 10px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.wan-ip {
		font-family: var(--font-mono); font-size: 16px; font-weight: 700;
		color: var(--color-text-primary); letter-spacing: 0.3px;
	}
	.copy-btn {
		display: flex; align-items: center; justify-content: center;
		background: var(--color-surface-600); border: none;
		border-radius: var(--radius-sm); color: var(--color-text-muted);
		cursor: pointer; padding: 4px; transition: all 0.15s ease;
	}
	.copy-btn:hover {
		background: var(--color-surface-500); color: var(--color-text-primary);
	}

	.ddns-row { margin-bottom: 6px; }
	.ddns-value { color: var(--color-accent-light); font-size: 12px; }

	.details {
		display: flex; flex-direction: column; gap: 6px;
	}
	.detail-row {
		display: flex; justify-content: space-between; font-size: 13px;
	}
	.detail-label {
		color: var(--color-text-secondary); font-size: 12px;
	}
	.detail-value {
		color: var(--color-text-primary); font-size: 13px;
	}
	.detail-divider {
		border-bottom: 1px solid var(--color-surface-600); margin: 2px 0;
	}
	.mono {
		font-family: var(--font-mono); font-size: 12px;
	}
</style>
