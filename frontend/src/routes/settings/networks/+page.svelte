<script lang="ts">
	import { onMount } from 'svelte';
	import * as uci from '$openwrt/uci';
	import { call } from '$api/ubus';

	let loading = $state(true);
	let saving = $state(false);
	let applyCountdown = $state(0);
	let editingNetwork = $state<string | null>(null);

	interface NetworkConfig {
		name: string;
		ipaddr: string;
		netmask: string;
		proto: string;
		device: string;
		dhcpEnabled: boolean;
		dhcpStart: string;
		dhcpLimit: string;
		dhcpLeasetime: string;
		ipv6: string;
		igmpSnooping: boolean;
		stp: boolean;
	}

	let networks = $state<NetworkConfig[]>([]);
	let editForm = $state<NetworkConfig | null>(null);
	let clientCount = $state(0);

	onMount(async () => {
		try {
			await uci.load(['network', 'dhcp']);
			loadNetworks();
		} catch (e) {
			console.error('Failed to load network config:', e);
		}
		// Count clients from DHCP lease file
		try {
			const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
			clientCount = (result.data || '').trim().split('\n').filter(Boolean).length;
		} catch { /* ignore */ }
		loading = false;
	});

	function loadNetworks() {
		const ifaces = uci.sections('network', 'interface');
		const nets: NetworkConfig[] = [];

		for (const iface of ifaces) {
			const name = iface['.name'] as string;
			if (name === 'loopback' || name === 'wan' || name === 'wan6') continue;

			const dhcpSec = uci.get('dhcp', name);
			const dhcpEnabled = dhcpSec ? !dhcpSec.ignore || dhcpSec.ignore === '0' : false;

			nets.push({
				name,
				ipaddr: (iface.ipaddr as string) ?? '',
				netmask: (iface.netmask as string) ?? '255.255.255.0',
				proto: (iface.proto as string) ?? 'static',
				device: (iface.device as string) ?? '',
				dhcpEnabled: !!dhcpEnabled,
				dhcpStart: String(dhcpSec?.start ?? '100'),
				dhcpLimit: String(dhcpSec?.limit ?? '150'),
				dhcpLeasetime: (dhcpSec?.leasetime as string) ?? '12h',
				ipv6: (iface.ip6assign as string) ?? '',
				igmpSnooping: String(iface.igmp_snooping) === '1',
				stp: String(iface.stp) === '1'
			});
		}
		networks = nets;
	}

	function startEdit(net: NetworkConfig) {
		editingNetwork = net.name;
		editForm = { ...net };
	}

	function cancelEdit() {
		editingNetwork = null;
		editForm = null;
	}

	function saveEdit() {
		if (!editForm) return;
		const name = editForm.name;

		uci.set('network', name, 'ipaddr', editForm.ipaddr);
		uci.set('network', name, 'netmask', editForm.netmask);

		if (editForm.ipv6) {
			uci.set('network', name, 'ip6assign', editForm.ipv6);
		} else {
			uci.set('network', name, 'ip6assign', undefined);
		}
		uci.set('network', name, 'igmp_snooping', editForm.igmpSnooping ? '1' : '0');
		uci.set('network', name, 'stp', editForm.stp ? '1' : '0');

		const dhcpSec = uci.get('dhcp', name);
		if (dhcpSec) {
			if (editForm.dhcpEnabled) {
				uci.set('dhcp', name, 'ignore', undefined);
				uci.set('dhcp', name, 'start', editForm.dhcpStart);
				uci.set('dhcp', name, 'limit', editForm.dhcpLimit);
				uci.set('dhcp', name, 'leasetime', editForm.dhcpLeasetime);
			} else {
				uci.set('dhcp', name, 'ignore', '1');
			}
		}

		loadNetworks();
		editingNetwork = null;
		editForm = null;
	}

	function computeDhcpRange(ipaddr: unknown, start: unknown, limit: unknown): string {
		const ipStr = String(ipaddr || '');
		if (!ipStr) return '--';
		// Handle CIDR notation (e.g., "192.168.50.1/24")
		const ip = ipStr.split('/')[0];
		const parts = ip.split('.');
		if (parts.length !== 4) return '--';
		const startNum = parseInt(String(start)) || 100;
		const limitNum = parseInt(String(limit)) || 150;
		return `${parts[0]}.${parts[1]}.${parts[2]}.${startNum} - .${startNum + limitNum - 1}`;
	}

	async function handleApply() {
		saving = true;
		try {
			await uci.save();
			await uci.apply(30);
			applyCountdown = 30;
			const timer = setInterval(() => {
				applyCountdown--;
				if (applyCountdown <= 0) clearInterval(timer);
			}, 1000);
			setTimeout(async () => {
				try { await uci.confirm(); } catch {}
			}, 5000);
		} catch (e) {
			console.error('Failed to apply network settings:', e);
		} finally {
			saving = false;
		}
	}

	async function handleDiscard() {
		uci.revert('network');
		uci.revert('dhcp');
		await uci.load(['network', 'dhcp']);
		loadNetworks();
		editingNetwork = null;
		editForm = null;
	}

	const pendingChanges = $derived(uci.hasChanges('network') || uci.hasChanges('dhcp'));
</script>

<div class="page">
	<h1>Networks</h1>
	<p class="subtitle">Manage your local networks and DHCP settings</p>

	{#if loading}
		<div class="loading">Loading configuration...</div>
	{:else}
		{#each networks as net (net.name)}
			<div class="network-card">
				{#if editingNetwork === net.name && editForm}
					<div class="card-header">
						<h2 class="network-name">{net.name.toUpperCase()}</h2>
						<div class="card-actions">
							<button class="btn btn-secondary btn-sm" onclick={cancelEdit}>Cancel</button>
							<button class="btn btn-primary btn-sm" onclick={saveEdit}>Done</button>
						</div>
					</div>

					<div class="edit-form">
						<div class="form-row">
							<div class="form-group">
								<label class="form-label">IP Address</label>
								<input type="text" class="form-input" bind:value={editForm.ipaddr} />
							</div>
							<div class="form-group">
								<label class="form-label">Netmask</label>
								<input type="text" class="form-input" bind:value={editForm.netmask} />
							</div>
						</div>

						<h3 class="section-title">DHCP Server</h3>
						<div class="form-group">
							<label class="form-label toggle-label">
								<input type="checkbox" class="toggle" bind:checked={editForm.dhcpEnabled} />
								<span>Enable DHCP Server</span>
							</label>
						</div>

						{#if editForm.dhcpEnabled}
							<div class="form-row">
								<div class="form-group">
									<label class="form-label">Start Offset</label>
									<input type="number" class="form-input" bind:value={editForm.dhcpStart} />
								</div>
								<div class="form-group">
									<label class="form-label">Address Limit</label>
									<input type="number" class="form-input" bind:value={editForm.dhcpLimit} />
								</div>
								<div class="form-group">
									<label class="form-label">Lease Time</label>
									<input type="text" class="form-input" bind:value={editForm.dhcpLeasetime} placeholder="12h" />
								</div>
							</div>
						{/if}

						<h3 class="section-title">Advanced</h3>
						<div class="form-group">
							<label class="form-label">IPv6 Prefix Length</label>
							<input type="text" class="form-input" bind:value={editForm.ipv6} placeholder="60" style="max-width: 200px;" />
						</div>
						<div class="form-group">
							<label class="form-label toggle-label">
								<input type="checkbox" class="toggle" bind:checked={editForm.igmpSnooping} />
								<span>IGMP Snooping</span>
							</label>
						</div>
						<div class="form-group">
							<label class="form-label toggle-label">
								<input type="checkbox" class="toggle" bind:checked={editForm.stp} />
								<span>Spanning Tree Protocol (STP)</span>
							</label>
						</div>
					</div>
				{:else}
					<div class="card-header">
						<div class="network-info">
							<h2 class="network-name">{net.name.toUpperCase()}</h2>
							<span class="network-device">{net.device}</span>
						</div>
						<button class="btn btn-secondary btn-sm" onclick={() => startEdit(net)}>Edit</button>
					</div>

					<div class="network-details">
						<div class="detail-row">
							<span class="detail-label">Subnet</span>
							<span class="detail-value mono">{net.ipaddr}</span>
						</div>
						<div class="detail-row">
							<span class="detail-label">DHCP</span>
							<span class="detail-value">{net.dhcpEnabled ? 'Enabled' : 'Disabled'}</span>
						</div>
						{#if net.dhcpEnabled}
							<div class="detail-row">
								<span class="detail-label">DHCP Range</span>
								<span class="detail-value mono">{computeDhcpRange(net.ipaddr, net.dhcpStart, net.dhcpLimit)}</span>
							</div>
							<div class="detail-row">
								<span class="detail-label">Lease Time</span>
								<span class="detail-value">{net.dhcpLeasetime}</span>
							</div>
						{/if}
						<div class="detail-row">
							<span class="detail-label">Clients</span>
							<span class="detail-value">{clientCount}</span>
						</div>
					</div>
				{/if}
			</div>
		{/each}

		{#if networks.length === 0}
			<div class="empty-state">No networks configured.</div>
		{/if}
	{/if}

	{#if pendingChanges}
		<div class="apply-bar">
			<span class="apply-text">You have unsaved changes</span>
			<div class="apply-actions">
				<button class="btn btn-secondary" onclick={handleDiscard} disabled={saving}>Discard</button>
				<button class="btn btn-primary" onclick={handleApply} disabled={saving}>
					{#if saving}Applying...{:else}Apply Changes{/if}
				</button>
			</div>
		</div>
	{/if}

	{#if applyCountdown > 0}
		<div class="countdown-toast">Changes applied. Auto-confirming in {applyCountdown}s...</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }
	.empty-state { color: var(--color-text-muted); text-align: center; padding: 40px; }

	.network-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); padding: 20px;
	}
	.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
	.network-info { display: flex; align-items: center; gap: 12px; }
	.network-name { font-size: 18px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.network-device { font-size: 13px; color: var(--color-text-muted); font-family: var(--font-mono); }
	.card-actions { display: flex; gap: 8px; }

	.network-details { display: flex; flex-direction: column; gap: 8px; }
	.detail-row { display: flex; justify-content: space-between; font-size: 13px; }
	.detail-label { color: var(--color-text-secondary); }
	.detail-value { color: var(--color-text-primary); }
	.mono { font-family: var(--font-mono); font-size: 12px; }

	.edit-form { display: flex; flex-direction: column; gap: 4px; }
	.form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
	.section-title { font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin: 16px 0 8px; }
	.form-group { margin-bottom: 12px; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-input {
		width: 100%; padding: 8px 12px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
	}
	.form-input:focus { border-color: var(--color-accent); }

	.toggle-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
	.toggle {
		width: 40px; height: 22px; appearance: none; background: var(--color-surface-500);
		border-radius: var(--radius-full); position: relative; cursor: pointer; transition: background 0.2s;
	}
	.toggle::after {
		content: ''; position: absolute; top: 3px; left: 3px;
		width: 16px; height: 16px; border-radius: 50%; background: white; transition: transform 0.2s;
	}
	.toggle:checked { background: var(--color-accent); }
	.toggle:checked::after { transform: translateX(18px); }

	.btn {
		padding: 8px 20px; border-radius: var(--radius-sm); font-size: 14px;
		font-weight: 500; cursor: pointer; border: none; transition: background 0.15s;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-sm { padding: 6px 14px; font-size: 13px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }

	.apply-bar {
		position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
		background: var(--color-surface-800); border-top: 1px solid var(--color-surface-500);
		padding: 12px 24px; display: flex; align-items: center; justify-content: space-between;
	}
	.apply-text { font-size: 14px; color: var(--color-text-secondary); }
	.apply-actions { display: flex; gap: 8px; }

	.countdown-toast {
		position: fixed; bottom: 72px; right: 24px; z-index: 101;
		background: var(--color-info-muted); border: 1px solid var(--color-info);
		color: var(--color-text-primary); padding: 12px 20px;
		border-radius: var(--radius-md); font-size: 13px;
	}
</style>
