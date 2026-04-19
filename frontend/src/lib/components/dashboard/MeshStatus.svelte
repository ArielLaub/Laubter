<script lang="ts">
	import { wirelessNodes, wirelessSsid, wirelessClientCount, activeProviderName, activeProviderLabel, activeCapabilities } from '$stores/wireless-provider';
	import { wifiClients } from '$stores/wireless';
	import { Wifi, Router, Radio, ChevronRight } from 'lucide-svelte';

	const isMultiNode = $derived($activeCapabilities.multiNode);
	const nodeCount = $derived($wirelessNodes.length);
	const onlineNodes = $derived($wirelessNodes.filter((n) => n.online).length);
	const offlineNodes = $derived(nodeCount - onlineNodes);
	const clientCount = $derived($wirelessClientCount || $wifiClients.size);
</script>

<a href="/mesh" class="card">
	<div class="card-header">
		<div class="wifi-icon-wrap">
			<Wifi size={16} strokeWidth={1.75} />
		</div>
		<div>
			<h3 class="card-title">{$wirelessSsid || 'WiFi'}</h3>
			<p class="total-clients">{clientCount} wireless client{clientCount !== 1 ? 's' : ''}</p>
		</div>
	</div>

	{#if isMultiNode}
		<!-- Mesh node summary -->
		<div class="node-summary">
			<span class="node-count">{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
			<span class="node-status">
				{#if onlineNodes > 0}
					<span class="dot online"></span> {onlineNodes} online
				{/if}
				{#if offlineNodes > 0}
					<span class="dot offline"></span> {offlineNodes} offline
				{/if}
			</span>
		</div>

		<div class="node-list">
			{#each $wirelessNodes as node}
				<div class="node-row">
					<span class="node-icon">
						<Router size={14} strokeWidth={1.75} />
					</span>
					<div class="node-info">
						<span class="node-alias">{node.alias}</span>
						<span class="node-model">{node.model}</span>
					</div>
					<span class="node-online-dot" class:online={node.online} class:offline={!node.online}></span>
					<span class="node-clients">
						{node.radios.reduce((sum, r) => sum + r.clientCount, 0)}
					</span>
				</div>
			{:else}
				<p class="no-nodes">No mesh nodes detected</p>
			{/each}
		</div>
	{:else}
		<!-- OpenWrt radio summary -->
		<div class="radio-list">
			{#each $wirelessNodes as node}
				{#each node.radios as radio}
					<div class="radio-row">
						<span class="band-badge">{radio.band === '2G' ? '2.4 GHz' : radio.band === '5G' ? '5 GHz' : radio.band === '6G' ? '6 GHz' : radio.band}</span>
						<div class="radio-info">
							{#if radio.channel}<span class="radio-detail">Ch {radio.channel}</span>{/if}
							{#if radio.htmode}
								<span class="radio-sep">&middot;</span>
								<span class="radio-detail">{radio.htmode}</span>
							{/if}
							<span class="radio-sep">&middot;</span>
							<span class="radio-detail">{radio.clientCount} client{radio.clientCount !== 1 ? 's' : ''}</span>
						</div>
					</div>
					{#if radio.ssid}
						<div class="ssid-row">
							<Wifi size={11} strokeWidth={1.75} />
							<span>{radio.ssid}</span>
						</div>
					{/if}
				{/each}
			{:else}
				<p class="no-nodes">No active radios</p>
			{/each}
		</div>
	{/if}

	<div class="card-footer">
		<span>{isMultiNode ? 'View mesh topology' : 'View WiFi details'}</span>
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

	.node-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 0;
		margin-bottom: 8px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.node-count {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.node-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		display: inline-block;
	}
	.dot.online { background: #22c55e; }
	.dot.offline { background: var(--color-text-muted); }

	.node-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.node-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
	}
	.node-icon {
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
	}
	.node-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.node-alias {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.node-model {
		font-size: 11px;
		color: var(--color-text-muted);
	}
	.node-online-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.node-online-dot.online {
		background: #22c55e;
		box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
		animation: pulse-green 2s ease-in-out infinite;
	}
	.node-online-dot.offline {
		background: var(--color-text-muted);
	}
	.node-clients {
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
		min-width: 16px;
		text-align: right;
	}
	.no-nodes {
		font-size: 13px;
		color: var(--color-text-muted);
	}

	/* Radio list for OpenWrt */
	.radio-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.radio-row {
		display: flex;
		align-items: center;
		gap: 10px;
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

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--color-surface-600);
		font-size: 12px;
		color: var(--color-text-muted);
	}

	@keyframes pulse-green {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>
