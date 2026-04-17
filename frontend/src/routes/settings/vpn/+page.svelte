<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import { formatBytes } from '$utils/format';

	interface Peer {
		public_key: string;
		name: string;
		section: string;
		endpoint: string;
		allowed_ips: string;
		latest_handshake: number;
		rx_bytes: number;
		tx_bytes: number;
		online: boolean;
	}

	interface ServerStatus {
		running: boolean;
		listen_port: number;
		address: string;
		peers: Peer[];
	}

	let loading = $state(true);
	let status = $state<ServerStatus | null>(null);
	let serverPublicKey = $state('');
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let enabling = $state(false);
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	// Add peer state
	let showAddPeer = $state(false);
	let newPeerName = $state('');
	let addingPeer = $state(false);
	let createdPeer = $state<{
		name: string;
		section: string;
		public_key: string;
		private_key: string;
		psk: string;
		allowed_ip: string;
		client_ip: string;
		qr?: string;
		config?: string;
	} | null>(null);

	// QR modal state
	let showQrModal = $state(false);
	let qrModalPeerName = $state('');
	let qrModalSection = $state('');
	let qrModalData = $state('');
	let qrModalLoading = $state(false);

	// Delete confirm state
	let deleteConfirmSection = $state('');
	let deleteConfirmName = $state('');
	let deleting = $state(false);

	// Server settings
	let showServerSettings = $state(false);
	let settingsPort = $state('51820');
	let settingsSubnet = $state('10.0.0.1/24');
	let settingsDns = $state('192.168.50.1');

	// Clipboard state
	let copiedKey = $state(false);

	// DDNS state
	interface DdnsConfig {
		enabled: string;
		provider: string;
		domain: string;
		has_token: boolean;
		interval: string;
	}
	interface DdnsStatus {
		enabled: boolean;
		provider: string;
		domain: string;
		last_update: string;
		public_ip: string;
	}
	interface DdnsTestResult {
		status: string;
		ip: string;
		domain: string;
		message?: string;
	}

	let ddnsEnabled = $state(false);
	let ddnsProvider = $state('duckdns');
	let ddnsDomain = $state('');
	let ddnsToken = $state('');
	let ddnsHasToken = $state(false);
	let ddnsInterval = $state('300');
	let ddnsShowToken = $state(false);
	let ddnsSaving = $state(false);
	let ddnsStatus = $state<DdnsStatus | null>(null);
	let ddnsTestResult = $state<DdnsTestResult | null>(null);
	let ddnsLoading = $state(true);

	const intervalOptions = [
		{ value: '60', label: '1 min' },
		{ value: '300', label: '5 min' },
		{ value: '900', label: '15 min' },
		{ value: '1800', label: '30 min' },
		{ value: '3600', label: '1 hour' },
	];

	const connectedPeers = $derived(status?.peers?.filter(p => p.online) ?? []);

	onMount(async () => {
		await Promise.all([refreshStatus(), loadDdnsConfig()]);
		loading = false;
		pollInterval = setInterval(refreshStatus, 5000);
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
	});

	async function refreshStatus() {
		try {
			const res = await call<ServerStatus>('laubter-vpn', 'get_status');
			status = res;
			if (res.running && !serverPublicKey) {
				const keyRes = await call<{ public_key: string }>('laubter-vpn', 'get_server_public_key');
				serverPublicKey = keyRes.public_key;
			}
		} catch {
			if (!status) {
				status = { running: false, listen_port: 0, address: '', peers: [] };
			}
		}
	}

	async function enableServer() {
		enabling = true;
		message = '';
		try {
			const res = await call<{ status: string; public_key: string; listen_port: number; address: string }>(
				'laubter-vpn', 'setup_server',
				{ listen_port: settingsPort, address: settingsSubnet }
			);
			serverPublicKey = res.public_key;
			message = 'VPN server enabled successfully';
			messageType = 'success';
			await refreshStatus();
		} catch (e) {
			message = 'Failed to enable VPN: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			enabling = false;
		}
	}

	async function addPeer() {
		if (!newPeerName.trim()) return;
		addingPeer = true;
		message = '';
		try {
			const res = await call<{
				status: string; name: string; section: string;
				public_key: string; private_key: string; psk: string;
				allowed_ip: string; client_ip: string;
			}>('laubter-vpn', 'add_peer', { name: newPeerName.trim() });

			const qrRes = await call<{ qr_svg_base64: string }>('laubter-vpn', 'generate_qr', { peer_name: res.section });

			createdPeer = { ...res, qr: qrRes.qr_svg_base64 };
			newPeerName = '';
			await refreshStatus();
		} catch (e) {
			message = 'Failed to add peer: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			addingPeer = false;
		}
	}

	async function downloadConfig(peerSection: string, peerName: string) {
		try {
			const res = await call<{ config: string }>('laubter-vpn', 'get_client_config', { peer_name: peerSection });
			const blob = new Blob([res.config], { type: 'text/plain' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${peerName}.conf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (e) {
			message = 'Failed to download config: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		}
	}

	async function showQr(peerName: string, peerSection: string) {
		qrModalPeerName = peerName;
		qrModalSection = peerSection;
		qrModalLoading = true;
		showQrModal = true;
		try {
			const res = await call<{ qr_svg_base64: string }>('laubter-vpn', 'generate_qr', { peer_name: peerSection });
			qrModalData = res.qr_svg_base64;
		} catch (e) {
			message = 'Failed to generate QR code: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
			showQrModal = false;
		} finally {
			qrModalLoading = false;
		}
	}

	async function deletePeer() {
		if (!deleteConfirmSection) return;
		deleting = true;
		try {
			await call('laubter-vpn', 'remove_peer', { name: deleteConfirmSection });
			deleteConfirmSection = '';
			deleteConfirmName = '';
			message = 'Peer removed';
			messageType = 'success';
			await refreshStatus();
		} catch (e) {
			message = 'Failed to remove peer: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			deleting = false;
		}
	}

	function confirmDelete(section: string, name: string) {
		deleteConfirmSection = section;
		deleteConfirmName = name;
	}

	function relativeTime(timestamp: number | string): string {
		const ts = Number(timestamp);
		if (!ts || ts <= 0) return 'Never';
		const now = Math.floor(Date.now() / 1000);
		const diff = now - ts;
		if (diff < 0 || diff > 31536000) return 'Never'; // sanity: >1 year = bad data
		if (diff < 60) return `${diff}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	}

	function truncateKey(key: string): string {
		if (!key) return '';
		return key.substring(0, 10) + '...' + key.substring(key.length - 6);
	}

	async function copyKey(key: string) {
		try {
			await navigator.clipboard.writeText(key);
			copiedKey = true;
			setTimeout(() => copiedKey = false, 2000);
		} catch {}
	}

	async function loadDdnsConfig() {
		try {
			const cfg = await call<DdnsConfig>('laubter-ddns', 'get_config');
			ddnsEnabled = cfg.enabled === '1';
			ddnsProvider = cfg.provider || 'duckdns';
			ddnsDomain = cfg.domain || '';
			ddnsHasToken = cfg.has_token;
			ddnsInterval = cfg.interval || '300';
			if (ddnsEnabled) {
				await refreshDdnsStatus();
			}
		} catch {
			// DDNS not available
		} finally {
			ddnsLoading = false;
		}
	}

	async function refreshDdnsStatus() {
		try {
			ddnsStatus = await call<DdnsStatus>('laubter-ddns', 'get_status');
		} catch {
			ddnsStatus = null;
		}
	}

	async function ddnsTestAndSave() {
		ddnsSaving = true;
		ddnsTestResult = null;
		try {
			await call('laubter-ddns', 'configure', {
				enabled: ddnsEnabled ? '1' : '0',
				provider: ddnsProvider,
				domain: ddnsDomain,
				token: ddnsToken || undefined,
				interval: ddnsInterval,
			});
			if (ddnsEnabled) {
				const result = await call<DdnsTestResult>('laubter-ddns', 'test');
				ddnsTestResult = result;
				await refreshDdnsStatus();
			} else {
				ddnsTestResult = null;
				ddnsStatus = null;
			}
			ddnsHasToken = ddnsHasToken || !!ddnsToken;
			ddnsToken = '';
			message = 'DDNS settings saved';
			messageType = 'success';
		} catch (e) {
			message = 'Failed to save DDNS: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			ddnsSaving = false;
		}
	}

	function closeCreatedPeer() {
		createdPeer = null;
		showAddPeer = false;
	}
</script>

<div class="page">
	<h1>WireGuard VPN</h1>
	<p class="subtitle">Manage VPN server and client peers</p>

	{#if loading}
		<div class="loading">Loading VPN status...</div>
	{:else}
		<!-- Server Status Card -->
		<div class="status-card">
			<div class="status-header">
				<div class="status-indicator" class:running={status?.running}>
					<div class="status-dot"></div>
					<span class="status-text">{status?.running ? 'Running' : 'Stopped'}</span>
				</div>
				{#if status?.running}
					<div class="server-badge">WireGuard</div>
				{/if}
			</div>

			{#if status?.running}
				<div class="server-details">
					<div class="detail-row">
						<span class="detail-label">Listen Port</span>
						<span class="detail-value mono">{status.listen_port}</span>
					</div>
					<div class="detail-row">
						<span class="detail-label">VPN Subnet</span>
						<span class="detail-value mono">{status.address}</span>
					</div>
					<div class="detail-row">
						<span class="detail-label">Public Key</span>
						<span class="detail-value mono key-value">
							{truncateKey(serverPublicKey)}
							<button class="copy-btn" onclick={() => copyKey(serverPublicKey)} title="Copy public key">
								{copiedKey ? '✓' : '⧉'}
							</button>
						</span>
					</div>
					<div class="detail-row">
						<span class="detail-label">Connected Peers</span>
						<span class="detail-value">{connectedPeers.length} / {status.peers?.length ?? 0}</span>
					</div>
				</div>
			{:else}
				<div class="enable-section">
					<p class="enable-text">VPN server is not running. Enable it to allow secure remote access to your network.</p>
					<button class="btn btn-primary btn-lg" onclick={enableServer} disabled={enabling}>
						{#if enabling}
							<span class="spinner"></span> Enabling...
						{:else}
							Enable VPN Server
						{/if}
					</button>
				</div>
			{/if}
		</div>

		{#if status?.running}
			<!-- Peers Section -->
			<div class="section-header">
				<h2 class="section-title">Peers</h2>
				<button class="btn btn-primary btn-sm" onclick={() => { showAddPeer = true; createdPeer = null; }}>
					Add Peer
				</button>
			</div>

			<!-- Add Peer / Created Peer -->
			{#if showAddPeer}
				<div class="form-card">
					{#if createdPeer}
						<!-- Success state with QR code -->
						<div class="peer-created">
							<div class="created-header">
								<span class="created-check">✓</span>
								<h3 class="created-title">Peer "{createdPeer.name}" Created</h3>
							</div>
							<p class="created-subtitle">Scan the QR code with the WireGuard app on your device</p>

							<div class="qr-container">
								{#if createdPeer.qr}
									<div class="qr-wrapper">
										<img src="data:image/svg+xml;base64,{createdPeer.qr}" alt="WireGuard QR Code" class="qr-image" />
									</div>
								{/if}
							</div>

							<div class="created-details">
								<div class="created-detail">
									<span class="detail-label">Client IP</span>
									<span class="detail-value mono">{createdPeer.client_ip}</span>
								</div>
								<div class="created-detail">
									<span class="detail-label">Allowed IP</span>
									<span class="detail-value mono">{createdPeer.allowed_ip}</span>
								</div>
							</div>

							<div class="created-actions">
								<button class="btn btn-secondary" onclick={() => downloadConfig(createdPeer!.section, createdPeer!.name)}>
									Download Config
								</button>
								<button class="btn btn-primary" onclick={closeCreatedPeer}>
									Done
								</button>
							</div>
						</div>
					{:else}
						<!-- Add peer form -->
						<h3 class="card-subtitle">Add New Peer</h3>
						<div class="add-peer-form">
							<div class="form-group">
								<label class="form-label">Device Name</label>
								<input
									type="text"
									class="form-input"
									bind:value={newPeerName}
									placeholder="iPhone, Laptop, etc."
									onkeydown={(e) => { if (e.key === 'Enter') addPeer(); }}
								/>
							</div>
							<div class="add-peer-actions">
								<button class="btn btn-secondary" onclick={() => { showAddPeer = false; newPeerName = ''; }}>
									Cancel
								</button>
								<button class="btn btn-primary" onclick={addPeer} disabled={addingPeer || !newPeerName.trim()}>
									{#if addingPeer}
										<span class="spinner"></span> Creating...
									{:else}
										Create
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Peers Table -->
			<div class="form-card">
				{#if status.peers && status.peers.length > 0}
					<div class="peers-table">
						<div class="table-header">
							<span class="col-peer-name">Name</span>
							<span class="col-peer-ip">IP</span>
							<span class="col-peer-status">Status</span>
							<span class="col-peer-handshake">Last Handshake</span>
							<span class="col-peer-transfer">Transfer</span>
							<span class="col-peer-actions">Actions</span>
						</div>
						{#each status.peers as peer (peer.section)}
							<div class="table-row">
								<span class="col-peer-name peer-name-cell">
									<span class="peer-name-text">{peer.name || peer.section}</span>
								</span>
								<span class="col-peer-ip mono">{peer.allowed_ips || '--'}</span>
								<span class="col-peer-status">
									<span class="online-dot" class:online={peer.online}></span>
									<span class="online-text">{peer.online ? 'Online' : 'Offline'}</span>
								</span>
								<span class="col-peer-handshake">
									{relativeTime(peer.latest_handshake)}
								</span>
								<span class="col-peer-transfer mono">
									{#if Number(peer.rx_bytes) > 0 || Number(peer.tx_bytes) > 0}
										<span class="transfer-down">↓ {formatBytes(Number(peer.rx_bytes) || 0)}</span>
										<span class="transfer-up">↑ {formatBytes(Number(peer.tx_bytes) || 0)}</span>
									{:else}
										—
									{/if}
								</span>
								<span class="col-peer-actions">
									<button class="btn-icon" title="Show QR Code" onclick={() => showQr(peer.name || peer.section, peer.section)}>
										⊞
									</button>
									<button class="btn-icon" title="Download Config" onclick={() => downloadConfig(peer.section, peer.name || peer.section)}>
										↓
									</button>
									<button class="btn-icon btn-icon-danger" title="Remove Peer" onclick={() => confirmDelete(peer.section, peer.name || peer.section)}>
										✕
									</button>
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p class="empty-text">No peers configured. Add your first device above.</p>
					</div>
				{/if}
			</div>

			<!-- Server Settings (collapsible) -->
			<button class="settings-toggle" onclick={() => showServerSettings = !showServerSettings}>
				<span>Server Settings</span>
				<span class="chevron" class:open={showServerSettings}>▸</span>
			</button>

			{#if showServerSettings}
				<div class="form-card">
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Listen Port</label>
							<input type="text" class="form-input mono" bind:value={settingsPort} placeholder="51820" />
						</div>
						<div class="form-group">
							<label class="form-label">VPN Subnet</label>
							<input type="text" class="form-input mono" bind:value={settingsSubnet} placeholder="10.0.0.1/24" />
						</div>
						<div class="form-group">
							<label class="form-label">DNS for Clients</label>
							<input type="text" class="form-input mono" bind:value={settingsDns} placeholder="192.168.50.1" />
						</div>
					</div>
				</div>
			{/if}
		{/if}

		<!-- Dynamic DNS Section -->
		<div class="ddns-section">
			<div class="ddns-card">
				<div class="ddns-header">
					<div>
						<h3 class="ddns-title">Dynamic DNS</h3>
						<p class="ddns-subtitle">Keep your VPN accessible when your public IP changes</p>
					</div>
					<label class="toggle-switch">
						<input type="checkbox" bind:checked={ddnsEnabled} />
						<span class="toggle-slider"></span>
					</label>
				</div>

				{#if ddnsEnabled}
					<div class="ddns-form">
						<div class="form-group">
							<label class="form-label">Provider</label>
							<select class="form-input form-select" bind:value={ddnsProvider} disabled>
								<option value="duckdns">DuckDNS</option>
							</select>
						</div>

						<div class="form-group">
							<label class="form-label">Domain</label>
							<div class="domain-input-wrapper">
								<input
									type="text"
									class="form-input domain-input mono"
									bind:value={ddnsDomain}
									placeholder="my-subdomain"
								/>
								<span class="domain-suffix">.duckdns.org</span>
							</div>
						</div>

						<div class="form-group">
							<label class="form-label">Token {#if ddnsHasToken}<span class="token-saved">(saved)</span>{/if}</label>
							<div class="token-input-wrapper">
								<input
									type={ddnsShowToken ? 'text' : 'password'}
									class="form-input mono"
									bind:value={ddnsToken}
									placeholder={ddnsHasToken ? 'Leave blank to keep existing token' : 'Paste your DuckDNS token'}
								/>
								<button class="token-toggle" onclick={() => ddnsShowToken = !ddnsShowToken} type="button">
									{ddnsShowToken ? 'Hide' : 'Show'}
								</button>
							</div>
						</div>

						<div class="form-group">
							<label class="form-label">Update Interval</label>
							<select class="form-input form-select" bind:value={ddnsInterval}>
								{#each intervalOptions as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>

						<div class="ddns-actions">
							<button
								class="btn btn-primary"
								onclick={ddnsTestAndSave}
								disabled={ddnsSaving || !ddnsDomain.trim() || (!ddnsToken && !ddnsHasToken)}
							>
								{#if ddnsSaving}
									<span class="spinner"></span> Saving...
								{:else}
									Test & Save
								{/if}
							</button>
						</div>

						{#if ddnsTestResult}
							<div class="ddns-test-result" class:ddns-test-ok={ddnsTestResult.status === 'ok'} class:ddns-test-err={ddnsTestResult.status === 'error'}>
								{#if ddnsTestResult.status === 'ok'}
									<span class="ddns-test-icon">&#10003;</span>
									<span>Your VPN is reachable at <strong>{ddnsTestResult.domain}</strong></span>
								{:else}
									<span class="ddns-test-icon">&#10007;</span>
									<span>{ddnsTestResult.message || 'Update failed'}</span>
								{/if}
							</div>
						{:else if ddnsStatus?.enabled && ddnsStatus.domain}
							<div class="ddns-test-result ddns-test-ok">
								<span class="ddns-test-icon">&#10003;</span>
								<span>Your VPN is reachable at <strong>{ddnsStatus.domain}</strong></span>
							</div>
						{/if}

						{#if ddnsStatus}
							<div class="ddns-status-details">
								{#if ddnsStatus.public_ip}
									<div class="ddns-status-row">
										<span class="detail-label">Public IP</span>
										<span class="detail-value mono">{ddnsStatus.public_ip}</span>
									</div>
								{/if}
								{#if ddnsStatus.last_update}
									<div class="ddns-status-row">
										<span class="detail-label">Last Update</span>
										<span class="detail-value">{ddnsStatus.last_update}</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<p class="ddns-note">Register a free subdomain at <a href="https://www.duckdns.org" target="_blank" rel="noopener noreferrer">duckdns.org</a></p>
			</div>
		</div>
	{/if}

	<!-- QR Code Modal -->
	{#if showQrModal}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="modal-backdrop" onclick={() => showQrModal = false} onkeydown={(e) => { if (e.key === 'Escape') showQrModal = false; }} role="dialog" tabindex="-1">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="modal-content" onclick={(e) => e.stopPropagation()} role="document">
				<div class="modal-header">
					<h3 class="modal-title">{qrModalPeerName}</h3>
					<button class="modal-close" onclick={() => showQrModal = false}>✕</button>
				</div>
				{#if qrModalLoading}
					<div class="modal-loading">
						<span class="spinner"></span>
						<span>Generating QR code...</span>
					</div>
				{:else}
					<div class="qr-container">
						<div class="qr-wrapper">
							<img src="data:image/svg+xml;base64,{qrModalData}" alt="WireGuard QR Code for {qrModalPeerName}" class="qr-image" />
						</div>
					</div>
					<div class="modal-actions">
						<button class="btn btn-secondary" onclick={() => downloadConfig(qrModalSection, qrModalPeerName)}>
							Download Config
						</button>
						<button class="btn btn-primary" onclick={() => showQrModal = false}>
							Close
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Delete Confirm Dialog -->
	{#if deleteConfirmSection}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="modal-backdrop" onclick={() => { deleteConfirmSection = ''; deleteConfirmName = ''; }} onkeydown={(e) => { if (e.key === 'Escape') { deleteConfirmSection = ''; deleteConfirmName = ''; } }} role="dialog" tabindex="-1">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="modal-content modal-sm" onclick={(e) => e.stopPropagation()} role="document">
				<h3 class="modal-title">Remove Peer</h3>
				<p class="delete-confirm-text">
					Are you sure you want to remove <strong>{deleteConfirmName}</strong>? This device will no longer be able to connect.
				</p>
				<div class="modal-actions">
					<button class="btn btn-secondary" onclick={() => { deleteConfirmSection = ''; deleteConfirmName = ''; }} disabled={deleting}>
						Cancel
					</button>
					<button class="btn btn-danger" onclick={deletePeer} disabled={deleting}>
						{#if deleting}Removing...{:else}Remove{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Toast message -->
	{#if message}
		<div class="message-toast {messageType}">
			<span>{message}</span>
			<button class="toast-close" onclick={() => message = ''}>✕</button>
		</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 16px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Status Card */
	.status-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 12px;
		padding: 24px;
	}
	.status-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
	}
	.status-indicator {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.status-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-text-muted);
	}
	.status-indicator.running .status-dot {
		background: #22c55e;
		box-shadow: 0 0 12px rgba(34, 197, 94, 0.5);
		animation: pulse-green 2s ease-in-out infinite;
	}
	.status-text {
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.server-badge {
		font-size: 12px;
		padding: 4px 12px;
		background: var(--color-accent-muted);
		color: var(--color-accent-light);
		border-radius: 20px;
		font-weight: 500;
	}

	.server-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px;
		background: var(--color-surface-700);
		border-radius: 8px;
	}
	.detail-label {
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.detail-value {
		font-size: 14px;
		color: var(--color-text-primary);
		font-weight: 500;
	}
	.mono { font-family: var(--font-mono); font-size: 13px; }
	.key-value {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.copy-btn {
		background: none;
		border: 1px solid var(--color-surface-500);
		border-radius: 4px;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px 6px;
		font-size: 14px;
		line-height: 1;
		transition: all 0.15s;
	}
	.copy-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-light);
	}

	/* Enable section */
	.enable-section {
		text-align: center;
		padding: 20px 0;
	}
	.enable-text {
		font-size: 14px;
		color: var(--color-text-secondary);
		margin: 0 0 20px;
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	/* Section header */
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 8px;
	}
	.section-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	/* Form card */
	.form-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 12px;
		padding: 20px;
	}
	.card-subtitle {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 16px;
	}

	/* Add peer form */
	.add-peer-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.form-group { margin-bottom: 0; }
	.form-label {
		display: block;
		font-size: 13px;
		color: var(--color-text-secondary);
		margin-bottom: 6px;
	}
	.form-input {
		width: 100%;
		padding: 8px 12px;
		background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500);
		border-radius: 8px;
		color: var(--color-text-primary);
		font-size: 14px;
		outline: none;
		transition: border-color 0.15s;
	}
	.form-input:focus { border-color: var(--color-accent); }
	.form-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 16px;
	}
	.add-peer-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* Created peer success */
	.peer-created {
		text-align: center;
	}
	.created-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin-bottom: 4px;
	}
	.created-check {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		font-weight: 700;
	}
	.created-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.created-subtitle {
		font-size: 14px;
		color: var(--color-text-muted);
		margin: 4px 0 20px;
	}

	/* QR code */
	.qr-container {
		display: flex;
		justify-content: center;
		padding: 20px 0;
	}
	.qr-wrapper {
		background: #ffffff;
		border-radius: 16px;
		padding: 16px;
		display: inline-block;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
	}
	.qr-image {
		display: block;
		width: 240px;
		height: 240px;
		image-rendering: pixelated;
	}

	.created-details {
		display: flex;
		justify-content: center;
		gap: 32px;
		margin: 16px 0;
	}
	.created-detail {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.created-actions {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 20px;
	}

	/* Peers table */
	.peers-table { display: flex; flex-direction: column; }
	.table-header, .table-row {
		display: grid;
		grid-template-columns: 2fr 1.5fr 1fr 1.5fr 2fr 120px;
		align-items: center;
		gap: 8px;
		padding: 10px 4px;
	}
	.table-header {
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border-bottom: 1px solid var(--color-surface-600);
		padding-bottom: 10px;
		margin-bottom: 4px;
	}
	.table-row {
		font-size: 13px;
		color: var(--color-text-primary);
		border-bottom: 1px solid var(--color-surface-700);
	}
	.table-row:last-child { border-bottom: none; }

	.peer-name-cell {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.peer-name-text {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.online-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-muted);
		display: inline-block;
		margin-right: 6px;
	}
	.online-dot.online {
		background: #22c55e;
		box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
	}
	.online-text {
		font-size: 12px;
	}

	.col-peer-status {
		display: flex;
		align-items: center;
	}

	.col-peer-transfer {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}
	.transfer-down { color: var(--color-accent-light); }
	.transfer-up { color: var(--color-text-muted); }

	.col-peer-actions {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 32px 0;
	}
	.empty-text {
		font-size: 14px;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Settings toggle */
	.settings-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 12px 16px;
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 12px;
		color: var(--color-text-secondary);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.settings-toggle:hover {
		border-color: var(--color-surface-400);
	}
	.chevron {
		transition: transform 0.2s;
		font-size: 12px;
	}
	.chevron.open {
		transform: rotate(90deg);
	}

	/* Buttons */
	.btn {
		padding: 8px 20px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.15s;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-sm { padding: 6px 14px; font-size: 13px; }
	.btn-lg { padding: 12px 32px; font-size: 15px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }
	.btn-danger { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
	.btn-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }

	.btn-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid var(--color-surface-500);
		border-radius: 6px;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 14px;
		transition: all 0.15s;
	}
	.btn-icon:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-light);
		background: var(--color-accent-muted);
	}
	.btn-icon-danger:hover {
		border-color: #ef4444;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.12);
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}
	.modal-content {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 16px;
		padding: 28px;
		max-width: 420px;
		width: 90%;
	}
	.modal-sm { max-width: 360px; }
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.modal-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.modal-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 18px;
		padding: 4px;
		line-height: 1;
	}
	.modal-close:hover { color: var(--color-text-primary); }
	.modal-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px 0;
		color: var(--color-text-secondary);
		font-size: 14px;
	}
	.modal-actions {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-top: 20px;
	}
	.delete-confirm-text {
		font-size: 14px;
		color: var(--color-text-secondary);
		margin: 8px 0 20px;
		line-height: 1.5;
	}

	/* Spinner */
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid transparent;
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		display: inline-block;
	}

	/* Toast */
	.message-toast {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 300;
		padding: 12px 20px;
		border-radius: 12px;
		font-size: 13px;
		display: flex;
		align-items: center;
		gap: 12px;
		color: var(--color-text-primary);
	}
	.message-toast.success {
		background: var(--color-success-muted);
		border: 1px solid var(--color-success);
	}
	.message-toast.error {
		background: var(--color-danger-muted);
		border: 1px solid var(--color-danger);
	}
	.toast-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 14px;
		padding: 0;
	}

	@keyframes pulse-green {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 900px) {
		.table-header, .table-row {
			grid-template-columns: 2fr 1fr 1fr 120px;
		}
		.col-peer-handshake,
		.col-peer-transfer { display: none; }
	}

	/* DDNS Section */
	.ddns-section {
		margin-top: 8px;
	}
	.ddns-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 12px;
		padding: 24px;
	}
	.ddns-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.ddns-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 4px;
	}
	.ddns-subtitle {
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Toggle switch */
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 44px;
		height: 24px;
		flex-shrink: 0;
		cursor: pointer;
	}
	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}
	.toggle-slider {
		position: absolute;
		inset: 0;
		background: var(--color-surface-600);
		border-radius: 24px;
		transition: background 0.2s;
	}
	.toggle-slider::before {
		content: '';
		position: absolute;
		left: 3px;
		top: 3px;
		width: 18px;
		height: 18px;
		background: var(--color-text-muted);
		border-radius: 50%;
		transition: all 0.2s;
	}
	.toggle-switch input:checked + .toggle-slider {
		background: var(--color-accent);
	}
	.toggle-switch input:checked + .toggle-slider::before {
		transform: translateX(20px);
		background: white;
	}

	.ddns-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-top: 20px;
		padding-top: 20px;
		border-top: 1px solid var(--color-surface-600);
	}

	.form-select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
	}
	.form-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.domain-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0;
	}
	.domain-input {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-right: none;
		flex: 1;
	}
	.domain-suffix {
		padding: 8px 12px;
		background: var(--color-surface-600);
		border: 1px solid var(--color-surface-500);
		border-left: none;
		border-radius: 0 8px 8px 0;
		color: var(--color-text-muted);
		font-size: 13px;
		font-family: var(--font-mono);
		white-space: nowrap;
		line-height: 1.35;
	}

	.token-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0;
	}
	.token-input-wrapper .form-input {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-right: none;
		flex: 1;
	}
	.token-toggle {
		padding: 8px 14px;
		background: var(--color-surface-600);
		border: 1px solid var(--color-surface-500);
		border-left: none;
		border-radius: 0 8px 8px 0;
		color: var(--color-text-muted);
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		line-height: 1.35;
		transition: color 0.15s;
	}
	.token-toggle:hover {
		color: var(--color-text-primary);
	}
	.token-saved {
		font-size: 11px;
		color: #22c55e;
		font-weight: 400;
	}

	.ddns-actions {
		display: flex;
		justify-content: flex-end;
	}

	.ddns-test-result {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-radius: 8px;
		font-size: 13px;
	}
	.ddns-test-ok {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: #4ade80;
	}
	.ddns-test-err {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
	}
	.ddns-test-icon {
		font-size: 16px;
		font-weight: 700;
	}

	.ddns-status-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	.ddns-status-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		background: var(--color-surface-700);
		border-radius: 8px;
	}

	.ddns-note {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 16px 0 0;
	}
	.ddns-note a {
		color: var(--color-accent-light);
		text-decoration: none;
	}
	.ddns-note a:hover {
		text-decoration: underline;
	}

	@media (max-width: 600px) {
		.table-header, .table-row {
			grid-template-columns: 2fr 1fr 80px;
		}
		.col-peer-ip { display: none; }
		.server-details {
			grid-template-columns: 1fr;
		}
	}
</style>
