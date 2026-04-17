<script lang="ts">
	import { wirelessStatus, wifiClients } from '$stores/wireless';
	import { Wifi } from 'lucide-svelte';

	interface RadioInfo {
		name: string;
		band: string;
		channel: string | number;
		htmode: string;
		clients: number;
		ssids: string[];
	}

	const radios = $derived.by(() => {
		const result: RadioInfo[] = [];
		const status = $wirelessStatus;
		const clients = $wifiClients;

		for (const [name, radio] of Object.entries(status)) {
			if (!radio.up) continue;

			const radioClients = (radio.interfaces || []).reduce((count, iface) => {
				for (const client of clients.values()) {
					if (client.ifname === iface.ifname) count++;
				}
				return count;
			}, 0);

			result.push({
				name,
				band: radio.config.band
					? radio.config.band === '2g' ? '2.4 GHz' : radio.config.band === '5g' ? '5 GHz' : '6 GHz'
					: '',
				channel: radio.config.channel ?? 'auto',
				htmode: radio.config.htmode ?? '',
				clients: radioClients,
				ssids: radio.interfaces?.map((i) => i.config.ssid).filter(Boolean) ?? []
			});
		}
		return result;
	});

	const totalClients = $derived($wifiClients.size);
</script>

<a href="/settings/wifi" class="card">
	<div class="card-header">
		<div class="wifi-icon-wrap">
			<Wifi size={16} strokeWidth={1.75} />
		</div>
		<div>
			<h3 class="card-title">WiFi</h3>
			<p class="total-clients">{totalClients} wireless client{totalClients !== 1 ? 's' : ''}</p>
		</div>
	</div>

	<div class="radios">
		{#each radios as radio}
			<div class="radio-block">
				<div class="radio-row">
					<span class="band-badge">{radio.band}</span>
					<div class="radio-info">
						<span class="radio-detail">Ch {radio.channel}</span>
						{#if radio.htmode}
							<span class="radio-sep">&middot;</span>
							<span class="radio-detail">{radio.htmode.replace('HE', '').replace('VHT', '')}</span>
						{/if}
						<span class="radio-sep">&middot;</span>
						<span class="radio-detail">{radio.clients} client{radio.clients !== 1 ? 's' : ''}</span>
					</div>
				</div>
				{#each radio.ssids as ssid}
					<div class="ssid-row">
						<Wifi size={11} strokeWidth={1.75} />
						<span>{ssid}</span>
					</div>
				{/each}
			</div>
		{/each}

		{#if radios.length === 0}
			<p class="no-radios">No active radios</p>
		{/if}
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
		margin-bottom: 16px;
	}
	.wifi-icon-wrap {
		color: var(--color-accent-light);
	}
	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.total-clients {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 1px 0 0;
	}

	.radios {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.radio-block {
		padding-bottom: 10px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.radio-block:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}
	.radio-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 6px;
	}
	.band-badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		background: var(--color-accent-muted);
		color: var(--color-accent-light);
		border-radius: var(--radius-full);
		white-space: nowrap;
	}
	.radio-info {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}
	.radio-detail {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.radio-sep {
		color: var(--color-text-muted);
	}
	.ssid-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--color-text-secondary);
		margin-left: 12px;
	}
	.no-radios {
		font-size: 13px;
		color: var(--color-text-muted);
	}
</style>
