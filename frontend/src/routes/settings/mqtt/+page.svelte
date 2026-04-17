<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import DetailPanel from '$components/shared/DetailPanel.svelte';

	// --- Types ---
	interface MqttConfig {
		enabled: boolean;
		broker: string;
		port: number;
		username: string;
		has_password: boolean;
		prefix: string;
		interval: number;
		running: boolean;
	}

	interface TrackedDevice {
		name: string;
		mac: string;
		entity_id: string;
		index: number;
	}

	interface HaZone {
		entity_id: string;
		zone_id: string;
		name: string;
	}

	interface ZoneMapping {
		ap_mac: string;
		zone: string;
		zone_name: string;
		ap_name: string;
	}

	interface MeshNode {
		alias: string;
		mac: string;
		[key: string]: unknown;
	}

	interface DhcpHost {
		name: string;
		mac: string;
		ip: string;
	}

	// --- State ---
	let loading = $state(true);
	let saving = $state(false);
	let testing = $state(false);

	// Config form
	let enabled = $state(false);
	let broker = $state('192.168.50.50');
	let port = $state(1883);
	let username = $state('');
	let password = $state('');
	let hasPassword = $state(false);
	let showPassword = $state(false);
	let prefix = $state('laubter');
	let interval = $state(30);
	let running = $state(false);

	// Connection status
	let connectionStatus = $state<'unknown' | 'ok' | 'error'>('unknown');
	let connectionMessage = $state('');

	// Presence detection
	let trackedDevices = $state<TrackedDevice[]>([]);
	let zoneMappings = $state<ZoneMapping[]>([]);
	let meshNodes = $state<MeshNode[]>([]);
	let dhcpHosts = $state<DhcpHost[]>([]);

	// Add device panel
	let showAddDevice = $state(false);
	let newDeviceName = $state('');
	let newDeviceMac = $state('');
	let newDeviceEntityId = $state('');
	let addingDevice = $state(false);

	// Zone saving state
	let savingZone = $state('');
	let haZones = $state<HaZone[]>([]);
	let haToken = $state('');
	let haTokenSaving = $state(false);

	async function loadHaZones() {
		try {
			const result = await call<{ zones?: HaZone[]; error?: string }>('laubter-mqtt', 'get_ha_zones', {});
			if (result.zones) haZones = result.zones;
		} catch {}
	}

	async function saveHaToken() {
		if (!haToken.trim()) return;
		haTokenSaving = true;
		try {
			await call('laubter-mqtt', 'set_ha_token', { token: haToken.trim() });
			haToken = '';
			await loadHaZones();
		} catch {}
		haTokenSaving = false;
	}

	// Re-publish state
	let republishing = $state(false);

	// Toast
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let messageTimeout: ReturnType<typeof setTimeout> | undefined;

	// Polling
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	// Auto-fill name from selected device's hostname
	$effect(() => {
		if (newDeviceMac) {
			const host = dhcpHosts.find(h => h.mac === newDeviceMac.toUpperCase());
			if (host && (host.name || host.ip)) {
				newDeviceName = host.name || host.ip;
			}
		}
	});

	// --- Derived ---
	const autoEntityId = $derived(
		newDeviceName
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.replace(/\s+/g, '_')
			.replace(/^_|_$/g, '')
	);

	const intervalOptions = [
		{ value: 5, label: '5 seconds' },
		{ value: 10, label: '10 seconds' },
		{ value: 30, label: '30 seconds' },
		{ value: 60, label: '60 seconds' }
	];

	const sensorList = [
		'CPU Usage',
		'Memory',
		'Temperature',
		'Download Speed',
		'Upload Speed',
		'Connections',
		'Clients',
		'VPN Peers',
		'DNS Queries',
		'DNS Blocked'
	];

	// --- Toast helper ---
	function showToast(text: string, type: 'success' | 'error') {
		message = text;
		messageType = type;
		clearTimeout(messageTimeout);
		messageTimeout = setTimeout(() => { message = ''; }, 4000);
	}

	// --- Load data ---
	async function loadConfig() {
		try {
			const cfg = await call<MqttConfig>('laubter-mqtt', 'get_config', {});
			enabled = cfg.enabled ?? false;
			broker = cfg.broker || '192.168.50.50';
			port = cfg.port || 1883;
			username = cfg.username || '';
			hasPassword = cfg.has_password ?? false;
			prefix = cfg.prefix || 'laubter';
			interval = cfg.interval || 30;
			running = cfg.running ?? false;
			if (running) {
				connectionStatus = 'ok';
				connectionMessage = 'Connected';
			}
		} catch (e) {
			console.error('Failed to load MQTT config:', e);
		}
	}

	async function loadTrackedDevices() {
		try {
			const result = await call<{ devices: TrackedDevice[] }>('laubter-mqtt', 'get_tracked_devices', {});
			trackedDevices = result.devices ?? [];
		} catch (e) {
			console.error('Failed to load tracked devices:', e);
		}
	}

	async function loadZoneMappings() {
		try {
			const result = await call<{ zones: ZoneMapping[] }>('laubter-mqtt', 'get_zone_mappings', {});
			zoneMappings = result.zones ?? [];
		} catch (e) {
			console.error('Failed to load zone mappings:', e);
		}
	}

	async function loadMeshNodes() {
		try {
			const result = await call<{ get_cfg_clientlist: MeshNode[] }>('laubter-mesh', 'get_nodes', {});
			meshNodes = result.get_cfg_clientlist ?? [];
		} catch (e) {
			console.error('Failed to load mesh nodes:', e);
		}
	}

	async function loadDhcpHosts() {
		try {
			// Load static leases from UCI
			const staticResult = await call<{ values: Record<string, { name?: string; mac?: string; ip?: string }> }>('uci', 'get', { config: 'dhcp', type: 'host' });
			const vals = staticResult.values ?? staticResult;
			const staticHosts = Object.values(vals as Record<string, Record<string, unknown>>)
				.filter((h) => h.mac || h['.type'] === 'host')
				.map((h) => {
					const mac = Array.isArray(h.mac) ? String(h.mac[0] || '') : String(h.mac || '');
					return {
						name: String(h.name || ''),
						mac: mac.toUpperCase(),
						ip: String(h.ip || '')
					};
				})
				.filter((h) => h.mac);

			// Load active DHCP leases from /tmp/dhcp.leases
			let activeHosts: DhcpHost[] = [];
			try {
				const leaseResult = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
				const data = leaseResult.data || '';
				activeHosts = data.split('\n')
					.filter((line: string) => line.trim())
					.map((line: string) => {
						const parts = line.split(/\s+/);
						// Format: timestamp mac ip hostname clientid
						return {
							name: parts[3] && parts[3] !== '*' ? parts[3] : '',
							mac: (parts[1] || '').toUpperCase(),
							ip: parts[2] || ''
						};
					})
					.filter((h: DhcpHost) => h.mac);
			} catch {}

			// Merge: static leases take priority, then add active leases not already present
			const seen = new Set(staticHosts.map(h => h.mac));
			const merged = [...staticHosts];
			for (const h of activeHosts) {
				if (!seen.has(h.mac)) {
					seen.add(h.mac);
					merged.push(h);
				}
			}
			dhcpHosts = merged.sort((a, b) => (a.name || a.ip).localeCompare(b.name || b.ip));
		} catch (e) {
			console.error('Failed to load DHCP hosts:', e);
		}
	}

	async function loadAll() {
		loading = true;
		await Promise.all([loadConfig(), loadTrackedDevices(), loadZoneMappings(), loadMeshNodes(), loadDhcpHosts()]);
		// Merge mesh nodes into zone mappings for display
		mergeZoneMappings();
		loading = false;
	}

	function mergeZoneMappings() {
		// Ensure every mesh node appears in the zone mapping list
		const existingMacs = new Set(zoneMappings.map((z) => z.ap_mac.toUpperCase()));
		for (const node of meshNodes) {
			const mac = node.mac.toUpperCase();
			if (!existingMacs.has(mac)) {
				zoneMappings.push({ ap_mac: mac, zone: '', ap_name: node.alias || '' });
			} else {
				// Update AP name from mesh data
				const mapping = zoneMappings.find((z) => z.ap_mac.toUpperCase() === mac);
				if (mapping && node.alias) {
					mapping.ap_name = node.alias;
				}
			}
		}
	}

	// --- Save & Test ---
	async function saveAndTest() {
		saving = true;
		testing = true;
		try {
			await call('laubter-mqtt', 'configure', {
				enabled,
				broker,
				port,
				username,
				password: password || undefined,
				prefix,
				interval
			});
			hasPassword = hasPassword || !!password;
			password = '';

			if (enabled) {
				const result = await call<{ status: string; message: string }>('laubter-mqtt', 'test_connection', {});
				if (result.status === 'ok') {
					connectionStatus = 'ok';
					connectionMessage = result.message || 'Connected';
					running = true;
					showToast('Configuration saved, MQTT connected', 'success');
				} else {
					connectionStatus = 'error';
					connectionMessage = result.message || 'Connection failed';
					showToast('Configuration saved but connection failed: ' + (result.message || 'Unknown error'), 'error');
				}
			} else {
				connectionStatus = 'unknown';
				connectionMessage = '';
				running = false;
				showToast('MQTT integration disabled', 'success');
			}
		} catch (e) {
			connectionStatus = 'error';
			connectionMessage = e instanceof Error ? e.message : 'Unknown error';
			showToast('Failed to save: ' + connectionMessage, 'error');
		} finally {
			saving = false;
			testing = false;
		}
	}

	// --- Device management ---
	function openAddDevice() {
		newDeviceName = '';
		newDeviceMac = '';
		newDeviceEntityId = '';
		showAddDevice = true;
	}

	async function addDevice() {
		if (!newDeviceName.trim() || !newDeviceMac.trim()) return;
		addingDevice = true;
		try {
			const entityId = newDeviceEntityId.trim() || autoEntityId;
			await call('laubter-mqtt', 'add_tracked_device', {
				name: newDeviceName.trim(),
				mac: newDeviceMac.trim(),
				entity_id: entityId
			});
			showAddDevice = false;
			showToast('Device added', 'success');
			await loadTrackedDevices();
		} catch (e) {
			showToast('Failed to add device: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
		} finally {
			addingDevice = false;
		}
	}

	async function removeDevice(mac: string) {
		try {
			await call('laubter-mqtt', 'remove_tracked_device', { mac });
			showToast('Device removed', 'success');
			await loadTrackedDevices();
		} catch (e) {
			showToast('Failed to remove device: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
		}
	}

	// --- Zone mapping ---
	async function saveZoneMapping(mapping: ZoneMapping) {
		savingZone = mapping.ap_mac;
		// Resolve friendly area name from haZones
		const areaName = haZones.find(z => z.zone_id === mapping.zone)?.name || mapping.zone;
		try {
			await call('laubter-mqtt', 'set_zone_mapping', {
				ap_mac: mapping.ap_mac,
				zone: mapping.zone,
				zone_name: areaName,
				ap_name: mapping.ap_name
			});
			showToast('Zone mapping saved', 'success');
		} catch (e) {
			showToast('Failed to save zone: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
		} finally {
			savingZone = '';
		}
	}

	// --- Re-publish discovery ---
	async function republishDiscovery() {
		republishing = true;
		try {
			await call('laubter-mqtt', 'publish_discovery', {});
			showToast('Discovery messages re-published', 'success');
		} catch (e) {
			showToast('Failed to re-publish: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
		} finally {
			republishing = false;
		}
	}

	// --- Entity ID sync ---
	$effect(() => {
		if (newDeviceName && !newDeviceEntityId) {
			// Keep auto-generated in sync while user hasn't manually edited
		}
	});

	function handleEntityIdInput(e: Event) {
		newDeviceEntityId = (e.target as HTMLInputElement).value;
	}

	// --- Lifecycle ---
	onMount(() => {
		loadAll();
		loadHaZones();
		pollInterval = setInterval(() => {
			if (enabled) loadTrackedDevices();
		}, 30000);
	});

	onDestroy(() => {
		clearInterval(pollInterval);
		clearTimeout(messageTimeout);
	});
</script>

<div class="page">
	<h1>Home Assistant</h1>
	<p class="subtitle">Publish router data to Home Assistant via MQTT auto-discovery</p>

	{#if loading}
		<div class="loading">Loading MQTT configuration...</div>
	{:else}
		<!-- Section 1: MQTT Connection -->
		<div class="card">
			<div class="card-header">
				<div>
					<h2 class="card-title">MQTT Connection</h2>
				</div>
				<label class="toggle-switch toggle-lg">
					<input type="checkbox" bind:checked={enabled} />
					<span class="toggle-slider"></span>
				</label>
			</div>

			{#if !enabled}
				<div class="disabled-message">
					<p>Enable Home Assistant integration to publish router data via MQTT</p>
				</div>
			{:else}
				<div class="card-form">
					{#if connectionStatus !== 'unknown'}
						<div class="connection-status" class:status-ok={connectionStatus === 'ok'} class:status-error={connectionStatus === 'error'}>
							<span class="conn-dot"></span>
							<span>{connectionStatus === 'ok' ? 'Connected' : connectionMessage || 'Error'}</span>
						</div>
					{/if}

					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Broker Address</label>
							<input type="text" class="form-input mono" bind:value={broker} placeholder="192.168.50.50" />
						</div>
						<div class="form-group form-group-sm">
							<label class="form-label">Port</label>
							<input type="number" class="form-input mono" bind:value={port} placeholder="1883" />
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Username</label>
							<input type="text" class="form-input" bind:value={username} placeholder="mqtt_user" />
						</div>
						<div class="form-group">
							<label class="form-label">Password {#if hasPassword}<span class="saved-badge">(saved)</span>{/if}</label>
							<div class="password-wrapper">
								<input
									type={showPassword ? 'text' : 'password'}
									class="form-input mono"
									bind:value={password}
									placeholder={hasPassword ? 'Leave blank to keep existing' : 'Enter password'}
								/>
								<button class="password-toggle" onclick={() => showPassword = !showPassword} type="button">
									{showPassword ? 'Hide' : 'Show'}
								</button>
							</div>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Topic Prefix</label>
							<input type="text" class="form-input mono" bind:value={prefix} placeholder="laubter" />
						</div>
						<div class="form-group form-group-sm">
							<label class="form-label">Update Interval</label>
							<select class="form-input form-select" bind:value={interval}>
								{#each intervalOptions as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="form-actions">
						<button class="btn btn-primary" onclick={saveAndTest} disabled={saving || !broker.trim()}>
							{#if saving}
								<span class="spinner"></span> Saving...
							{:else}
								Save & Test
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Section 2: Presence Detection -->
		<div class="card">
			<div class="card-header">
				<div>
					<h2 class="card-title">Presence Detection</h2>
					<p class="card-subtitle">Track which room family members are in based on WiFi AP connection</p>
				</div>
			</div>

			<!-- Tracked Devices -->
			<div class="subsection">
				<div class="subsection-header">
					<h3 class="subsection-title">Tracked Devices</h3>
					<button class="btn btn-primary btn-sm" onclick={openAddDevice}>
						Add Device
					</button>
				</div>

				{#if trackedDevices.length > 0}
					<div class="devices-table">
						<div class="table-header">
							<span class="col-name">Name</span>
							<span class="col-mac">MAC Address</span>
							<span class="col-entity">Entity ID</span>
							<span class="col-actions">Actions</span>
						</div>
						{#each trackedDevices as device (device.mac)}
							<div class="table-row">
								<span class="col-name device-name">{device.name}</span>
								<span class="col-mac mono">{device.mac}</span>
								<span class="col-entity mono">{device.entity_id}</span>
								<span class="col-actions">
									<button
										class="btn-icon btn-icon-danger"
										title="Remove device"
										onclick={() => removeDevice(device.mac)}
									>
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
											<path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
										</svg>
									</button>
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p class="empty-text">No devices tracked yet. Add a device to start presence detection.</p>
					</div>
				{/if}
			</div>

			<!-- HA API Token -->
			<div class="subsection">
				<h3 class="subsection-title">Home Assistant Connection</h3>
				<p class="subsection-desc">Provide a Long-Lived Access Token to fetch zones from HA. Create one in HA → Profile → Long-Lived Access Tokens.</p>
				<div class="ha-token-row">
					<input type="password" class="form-input" bind:value={haToken} placeholder={haZones.length > 0 ? 'Token saved ✓' : 'Paste HA Long-Lived Access Token'} />
					<button class="btn btn-primary btn-sm" onclick={saveHaToken} disabled={haTokenSaving || !haToken.trim()}>
						{haTokenSaving ? '...' : 'Save & Load Zones'}
					</button>
				</div>
				{#if haZones.length > 0}
					<p class="ha-zones-count">{haZones.length} areas loaded from Home Assistant</p>
				{/if}
			</div>

			<!-- AP Area Mapping -->
			<div class="subsection">
				<h3 class="subsection-title">AP to Area Mapping</h3>
				<p class="subsection-desc">Map each access point to a Home Assistant area. Unmapped APs default to "home".</p>

				{#if zoneMappings.length > 0}
					<div class="zones-table">
						<div class="table-header zones-header">
							<span class="col-ap-name">AP Name</span>
							<span class="col-ap-mac">AP MAC</span>
							<span class="col-zone">HA Area</span>
							<span class="col-zone-action"></span>
						</div>
						{#each zoneMappings as mapping (mapping.ap_mac)}
							<div class="table-row zones-row">
								<span class="col-ap-name">{mapping.ap_name || '—'}</span>
								<span class="col-ap-mac mono">{mapping.ap_mac}</span>
								<span class="col-zone">
									{#if haZones.length > 0}
										<select class="form-input form-input-inline" bind:value={mapping.zone}>
											<option value="">— not mapped —</option>
											{#each haZones as z}
												<option value={z.zone_id}>{z.name} ({z.zone_id})</option>
											{/each}
										</select>
									{:else}
										<input
											type="text"
											class="form-input form-input-inline mono"
											bind:value={mapping.zone}
											placeholder="home"
										/>
									{/if}
								</span>
								<span class="col-zone-action">
									<button
										class="btn btn-secondary btn-xs"
										onclick={() => saveZoneMapping(mapping)}
										disabled={savingZone === mapping.ap_mac}
									>
										{savingZone === mapping.ap_mac ? '...' : 'Save'}
									</button>
								</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p class="empty-text">No mesh access points detected.</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Section 3: Sensors -->
		<div class="card">
			<div class="card-header">
				<div>
					<h2 class="card-title">Sensor Data</h2>
					<p class="card-subtitle">Published as Home Assistant sensors via MQTT auto-discovery</p>
				</div>
			</div>

			<div class="sensor-list">
				{#each sensorList as sensor}
					<div class="sensor-item">
						<span class="sensor-dot"></span>
						<span class="sensor-name">{sensor}</span>
					</div>
				{/each}
			</div>

			<div class="sensor-footer">
				<span class="sensor-interval">
					Update interval: <strong>{intervalOptions.find((o) => o.value === interval)?.label ?? interval + 's'}</strong>
				</span>
				<button class="btn btn-secondary btn-sm" onclick={republishDiscovery} disabled={republishing}>
					{#if republishing}
						<span class="spinner"></span> Publishing...
					{:else}
						Re-publish Discovery
					{/if}
				</button>
			</div>
		</div>
	{/if}

	<!-- Add Device Panel -->
	<DetailPanel open={showAddDevice} title="Add Tracked Device" onClose={() => showAddDevice = false}>
		<div class="panel-form">
			<div class="form-group">
				<label class="form-label">Name</label>
				<input
					type="text"
					class="form-input"
					bind:value={newDeviceName}
					placeholder="Ariel Phone"
				/>
			</div>

			<div class="form-group">
				<label class="form-label">MAC Address</label>
				<select class="form-input form-select" bind:value={newDeviceMac}>
					<option value="">Select a device...</option>
					{#each dhcpHosts as host}
						<option value={host.mac}>
							{host.name || host.ip || 'Unknown'} ({host.mac})
						</option>
					{/each}
				</select>
				<input
					type="text"
					class="form-input mono form-input-alt"
					bind:value={newDeviceMac}
					placeholder="Or type MAC manually"
				/>
			</div>

			<div class="form-group">
				<label class="form-label">Entity ID</label>
				<input
					type="text"
					class="form-input mono"
					value={newDeviceEntityId || autoEntityId}
					oninput={handleEntityIdInput}
					placeholder="auto_generated_from_name"
				/>
				<span class="form-hint">Auto-generated from name, but editable</span>
			</div>

			<div class="panel-actions">
				<button class="btn btn-secondary" onclick={() => showAddDevice = false}>
					Cancel
				</button>
				<button class="btn btn-primary" onclick={addDevice} disabled={addingDevice || !newDeviceName.trim() || !newDeviceMac.trim()}>
					{#if addingDevice}
						<span class="spinner"></span> Adding...
					{:else}
						Add Device
					{/if}
				</button>
			</div>
		</div>
	</DetailPanel>

	<!-- Toast -->
	{#if message}
		<div class="message-toast {messageType}">
			<span>{message}</span>
			<button class="toast-close" onclick={() => message = ''}>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	{/if}
</div>

<style>
	/* Page layout */
	.page { display: flex; flex-direction: column; gap: 16px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Card */
	.card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: 12px;
		padding: 24px;
	}
	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.card-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 4px;
	}
	.card-subtitle {
		font-size: 13px;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Toggle switch (large) */
	.toggle-switch {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
		cursor: pointer;
	}
	.toggle-lg {
		width: 52px;
		height: 28px;
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
		border-radius: 28px;
		transition: background 0.2s;
	}
	.toggle-slider::before {
		content: '';
		position: absolute;
		left: 3px;
		top: 3px;
		width: 22px;
		height: 22px;
		background: var(--color-text-muted);
		border-radius: 50%;
		transition: all 0.2s;
	}
	.toggle-switch input:checked + .toggle-slider {
		background: #22c55e;
	}
	.toggle-switch input:checked + .toggle-slider::before {
		transform: translateX(24px);
		background: white;
	}

	/* Disabled message */
	.disabled-message {
		text-align: center;
		padding: 24px 0 8px;
	}
	.disabled-message p {
		font-size: 14px;
		color: var(--color-text-secondary);
		margin: 0;
	}

	/* Connection status */
	.connection-status {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 500;
	}
	.connection-status.status-ok {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: #4ade80;
	}
	.connection-status.status-error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
	}
	.conn-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.status-ok .conn-dot {
		background: #22c55e;
		box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
	}
	.status-error .conn-dot {
		background: #ef4444;
		box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
	}

	/* Form */
	.card-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-top: 20px;
		padding-top: 20px;
		border-top: 1px solid var(--color-surface-600);
	}
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.form-group { margin-bottom: 0; }
	.form-group-sm { max-width: 160px; }
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
		box-sizing: border-box;
	}
	.form-input:focus { border-color: var(--color-accent); }
	.form-input-inline {
		padding: 6px 10px;
		font-size: 13px;
		border-radius: 6px;
	}
	.form-input-alt {
		margin-top: 8px;
		font-size: 13px;
	}
	.form-hint {
		display: block;
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: 4px;
	}
	.form-select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
	}
	.mono { font-family: var(--font-mono); font-size: 13px; }

	/* Password */
	.password-wrapper {
		display: flex;
		align-items: center;
		gap: 0;
	}
	.password-wrapper .form-input {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-right: none;
		flex: 1;
	}
	.password-toggle {
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
	.password-toggle:hover { color: var(--color-text-primary); }
	.saved-badge {
		font-size: 11px;
		color: #22c55e;
		font-weight: 400;
	}

	/* Form actions */
	.form-actions {
		display: flex;
		justify-content: flex-end;
	}

	/* Subsections */
	.subsection {
		margin-top: 20px;
		padding-top: 20px;
		border-top: 1px solid var(--color-surface-600);
	}
	.subsection-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.subsection-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.subsection-desc {
		font-size: 12px;
		color: var(--color-text-muted);
		margin: 4px 0 16px;
	}

	.ha-token-row { display: flex; gap: 8px; margin-bottom: 8px; }
	.ha-token-row .form-input { flex: 1; }
	.ha-zones-count { font-size: 12px; color: var(--color-success); margin: 4px 0 0; }

	/* Tables */
	.devices-table, .zones-table { display: flex; flex-direction: column; }
	.table-header, .table-row {
		display: grid;
		align-items: center;
		gap: 8px;
		padding: 10px 4px;
	}
	.devices-table .table-header,
	.devices-table .table-row {
		grid-template-columns: 2fr 2fr 2fr 60px;
	}
	.zones-table .table-header,
	.zones-table .table-row {
		grid-template-columns: 2fr 2fr 2fr 60px;
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
	.device-name { font-weight: 500; }

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 24px 0;
	}
	.empty-text {
		font-size: 14px;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Sensors */
	.sensor-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 8px;
		margin-top: 16px;
	}
	.sensor-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: var(--color-surface-700);
		border-radius: 8px;
	}
	.sensor-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-accent);
		flex-shrink: 0;
	}
	.sensor-name {
		font-size: 13px;
		color: var(--color-text-primary);
	}
	.sensor-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--color-surface-600);
	}
	.sensor-interval {
		font-size: 13px;
		color: var(--color-text-muted);
	}
	.sensor-interval strong {
		color: var(--color-text-primary);
	}

	/* Panel form */
	.panel-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.panel-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
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
	.btn-xs { padding: 4px 10px; font-size: 12px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }

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
		animation: slideUp 0.25s ease;
	}
	.message-toast.success {
		background: var(--color-success-muted, rgba(34, 197, 94, 0.12));
		border: 1px solid var(--color-success, #22c55e);
	}
	.message-toast.error {
		background: var(--color-danger-muted, rgba(239, 68, 68, 0.12));
		border: 1px solid var(--color-danger, #ef4444);
	}
	.toast-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
	}
	.toast-close:hover { color: var(--color-text-primary); }

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	@keyframes slideUp {
		from { transform: translateY(12px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	/* Responsive */
	@media (max-width: 640px) {
		.form-row {
			grid-template-columns: 1fr;
		}
		.form-group-sm { max-width: none; }
		.devices-table .table-header,
		.devices-table .table-row {
			grid-template-columns: 1.5fr 2fr 60px;
		}
		.col-entity { display: none; }
		.zones-table .table-header,
		.zones-table .table-row {
			grid-template-columns: 1.5fr 2fr 60px;
		}
		.col-ap-mac { display: none; }
		.sensor-list {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
