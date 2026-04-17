<script lang="ts">
	import { onMount } from 'svelte';
	import { wanInterface } from '$stores/network';
	import { formatUptime } from '$utils/format';
	import * as uci from '$openwrt/uci';

	let loading = $state(true);
	let saving = $state(false);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let applyCountdown = $state(0);
	let showAdvanced = $state(false);

	// Form state
	let proto = $state('dhcp');
	let staticIp = $state('');
	let staticNetmask = $state('255.255.255.0');
	let staticGateway = $state('');
	let staticDns = $state('');
	let pppoeUser = $state('');
	let pppoePass = $state('');
	let mtu = $state('');
	let macClone = $state('');
	let customDns = $state(false);
	let dnsServers = $state(['', '']);

	// Derived status
	const isUp = $derived($wanInterface?.up ?? false);
	const wanIp = $derived($wanInterface?.['ipv4-address']?.[0]?.address ?? '--');
	const wanGateway = $derived(
		$wanInterface?.route?.find((r: { target: string }) => r.target === '0.0.0.0')?.nexthop ?? '--'
	);
	const wanDns = $derived($wanInterface?.['dns-server']?.join(', ') ?? '--');
	const wanUptime = $derived($wanInterface?.uptime ?? 0);

	onMount(async () => {
		try {
			await uci.load('network');
			loadFormFromUci();
		} catch (e) {
			message = 'Failed to load network config: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			loading = false;
		}
	});

	function loadFormFromUci() {
		const wan = uci.get('network', 'wan');
		if (!wan) return;
		proto = (wan.proto as string) ?? 'dhcp';
		staticIp = (wan.ipaddr as string) ?? '';
		staticNetmask = (wan.netmask as string) ?? '255.255.255.0';
		staticGateway = (wan.gateway as string) ?? '';
		staticDns = Array.isArray(wan.dns) ? (wan.dns as string[]).join(' ') : (wan.dns as string) ?? '';
		pppoeUser = (wan.username as string) ?? '';
		pppoePass = (wan.password as string) ?? '';
		mtu = (wan.mtu as string) ?? '';
		macClone = (wan.macaddr as string) ?? '';
		if (wan.peerdns === '0' || wan.peerdns === 0) {
			customDns = true;
			const dnsList = Array.isArray(wan.dns) ? wan.dns as string[] : (wan.dns as string ?? '').split(' ').filter(Boolean);
			dnsServers = [dnsList[0] ?? '', dnsList[1] ?? ''];
		}
	}

	function applyFormToUci() {
		uci.set('network', 'wan', 'proto', proto);
		if (proto === 'static') {
			uci.set('network', 'wan', 'ipaddr', staticIp);
			uci.set('network', 'wan', 'netmask', staticNetmask);
			uci.set('network', 'wan', 'gateway', staticGateway);
		} else {
			uci.set('network', 'wan', 'ipaddr', undefined);
			uci.set('network', 'wan', 'netmask', undefined);
			uci.set('network', 'wan', 'gateway', undefined);
		}
		if (proto === 'pppoe') {
			uci.set('network', 'wan', 'username', pppoeUser);
			uci.set('network', 'wan', 'password', pppoePass);
		} else {
			uci.set('network', 'wan', 'username', undefined);
			uci.set('network', 'wan', 'password', undefined);
		}
		if (mtu) {
			uci.set('network', 'wan', 'mtu', mtu);
		} else {
			uci.set('network', 'wan', 'mtu', undefined);
		}
		if (macClone) {
			uci.set('network', 'wan', 'macaddr', macClone);
		} else {
			uci.set('network', 'wan', 'macaddr', undefined);
		}
		if (customDns) {
			uci.set('network', 'wan', 'peerdns', '0');
			const dnsList = dnsServers.filter(Boolean);
			if (dnsList.length > 0) {
				uci.set('network', 'wan', 'dns', dnsList);
			}
		} else {
			uci.set('network', 'wan', 'peerdns', undefined);
			uci.set('network', 'wan', 'dns', undefined);
		}
	}

	async function handleSave() {
		saving = true;
		message = '';
		try {
			applyFormToUci();
			await uci.save();
			await uci.apply(30);
			setTimeout(async () => {
				try { await uci.confirm(); } catch {}
			}, 5000);
			message = 'Changes applied successfully';
			messageType = 'success';
		} catch (e) {
			message = 'Failed to apply: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			saving = false;
		}
	}

	async function handleDiscard() {
		uci.revert('network');
		await uci.load('network');
		loadFormFromUci();
	}

	const pendingChanges = $derived(uci.hasChanges('network'));
</script>

<div class="page">
	<h1>Internet (WAN)</h1>
	<p class="subtitle">Configure your internet connection</p>

	{#if loading}
		<div class="loading">Loading configuration...</div>
	{:else}
		<!-- Status Card -->
		<div class="status-card" class:up={isUp} class:down={!isUp}>
			<div class="status-header">
				<div class="status-dot" class:online={isUp}></div>
				<span class="status-text">{isUp ? 'Connected' : 'Disconnected'}</span>
			</div>
			<div class="status-details">
				<div class="status-item">
					<span class="status-label">IP Address</span>
					<span class="status-value mono">{wanIp}</span>
				</div>
				<div class="status-item">
					<span class="status-label">Gateway</span>
					<span class="status-value mono">{wanGateway}</span>
				</div>
				<div class="status-item">
					<span class="status-label">DNS</span>
					<span class="status-value mono">{wanDns}</span>
				</div>
				{#if isUp && wanUptime > 0}
					<div class="status-item">
						<span class="status-label">Uptime</span>
						<span class="status-value">{formatUptime(wanUptime)}</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Configuration Form -->
		<div class="form-card">
			<h2 class="card-title">Connection Settings</h2>

			<div class="form-group">
				<label class="form-label" for="proto">Connection Type</label>
				<select id="proto" class="form-input" bind:value={proto}>
					<option value="dhcp">DHCP (Automatic)</option>
					<option value="static">Static IP</option>
					<option value="pppoe">PPPoE</option>
				</select>
			</div>

			{#if proto === 'static'}
				<div class="form-group">
					<label class="form-label" for="static-ip">IP Address</label>
					<input id="static-ip" type="text" class="form-input" bind:value={staticIp} placeholder="192.168.1.100" />
				</div>
				<div class="form-group">
					<label class="form-label" for="static-netmask">Netmask</label>
					<input id="static-netmask" type="text" class="form-input" bind:value={staticNetmask} placeholder="255.255.255.0" />
				</div>
				<div class="form-group">
					<label class="form-label" for="static-gw">Gateway</label>
					<input id="static-gw" type="text" class="form-input" bind:value={staticGateway} placeholder="192.168.1.1" />
				</div>
				<div class="form-group">
					<label class="form-label" for="static-dns">DNS Servers</label>
					<input id="static-dns" type="text" class="form-input" bind:value={staticDns} placeholder="8.8.8.8 8.8.4.4" />
					<span class="form-hint">Space-separated list</span>
				</div>
			{/if}

			{#if proto === 'pppoe'}
				<div class="form-group">
					<label class="form-label" for="pppoe-user">Username</label>
					<input id="pppoe-user" type="text" class="form-input" bind:value={pppoeUser} />
				</div>
				<div class="form-group">
					<label class="form-label" for="pppoe-pass">Password</label>
					<input id="pppoe-pass" type="password" class="form-input" bind:value={pppoePass} />
				</div>
			{/if}

			<!-- Advanced -->
			<button class="advanced-toggle" onclick={() => showAdvanced = !showAdvanced}>
				<span class="chevron" class:open={showAdvanced}>&#9654;</span>
				Advanced Settings
			</button>

			{#if showAdvanced}
				<div class="advanced-section">
					<div class="form-group">
						<label class="form-label" for="mtu">MTU</label>
						<input id="mtu" type="number" class="form-input" bind:value={mtu} placeholder="1500" />
					</div>
					<div class="form-group">
						<label class="form-label" for="mac-clone">MAC Clone</label>
						<input id="mac-clone" type="text" class="form-input" bind:value={macClone} placeholder="AA:BB:CC:DD:EE:FF" />
						<span class="form-hint">Override the WAN MAC address</span>
					</div>
					<div class="form-group">
						<label class="form-label toggle-label">
							<input type="checkbox" class="toggle" bind:checked={customDns} />
							<span>Use Custom DNS Servers</span>
						</label>
					</div>
					{#if customDns}
						<div class="form-group">
							<label class="form-label" for="dns1">Primary DNS</label>
							<input id="dns1" type="text" class="form-input" bind:value={dnsServers[0]} placeholder="1.1.1.1" />
						</div>
						<div class="form-group">
							<label class="form-label" for="dns2">Secondary DNS</label>
							<input id="dns2" type="text" class="form-input" bind:value={dnsServers[1]} placeholder="8.8.8.8" />
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Apply Changes Bar -->
	{#if pendingChanges}
		<div class="apply-bar">
			<span class="apply-text">You have unsaved changes</span>
			<div class="apply-actions">
				<button class="btn btn-secondary" onclick={handleDiscard} disabled={saving}>Discard</button>
				<button class="btn btn-primary" onclick={handleSave} disabled={saving}>
					{#if saving}Applying...{:else}Apply Changes{/if}
				</button>
			</div>
		</div>
	{/if}

	{#if message}
		<div class="message-toast {messageType}">
			<span>{message}</span>
			<button class="toast-close" onclick={() => message = ''}>&#10005;</button>
		</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Status Card */
	.status-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 20px;
	}
	.status-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
	.status-dot {
		width: 10px; height: 10px; border-radius: 50%;
		background: var(--color-danger); flex-shrink: 0;
	}
	.status-dot.online { background: var(--color-success); box-shadow: 0 0 8px var(--color-success); }
	.status-text { font-size: 16px; font-weight: 600; color: var(--color-text-primary); }
	.status-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
	.status-item { display: flex; flex-direction: column; gap: 2px; }
	.status-label { font-size: 12px; color: var(--color-text-muted); }
	.status-value { font-size: 14px; color: var(--color-text-primary); }
	.mono { font-family: var(--font-mono); font-size: 13px; }

	/* Form Card */
	.form-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 24px;
	}
	.card-title { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 20px; }
	.form-group { margin-bottom: 16px; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-input {
		width: 100%; max-width: 400px; padding: 8px 12px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
	}
	.form-input:focus { border-color: var(--color-accent); }
	select.form-input { cursor: pointer; appearance: auto; }
	.form-hint { display: block; font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }

	/* Toggle */
	.toggle-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
	.toggle {
		width: 40px; height: 22px; appearance: none; background: var(--color-surface-500);
		border-radius: var(--radius-full); position: relative; cursor: pointer;
		transition: background 0.2s;
	}
	.toggle::after {
		content: ''; position: absolute; top: 3px; left: 3px;
		width: 16px; height: 16px; border-radius: 50%; background: white;
		transition: transform 0.2s;
	}
	.toggle:checked { background: var(--color-accent); }
	.toggle:checked::after { transform: translateX(18px); }

	/* Advanced */
	.advanced-toggle {
		display: flex; align-items: center; gap: 8px;
		background: none; border: none; color: var(--color-text-secondary);
		font-size: 13px; cursor: pointer; padding: 8px 0; margin-top: 8px;
	}
	.advanced-toggle:hover { color: var(--color-text-primary); }
	.chevron { display: inline-block; font-size: 10px; transition: transform 0.2s; }
	.chevron.open { transform: rotate(90deg); }
	.advanced-section { padding-top: 16px; border-top: 1px solid var(--color-surface-600); margin-top: 8px; }

	/* Apply Bar */
	.apply-bar {
		position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
		background: var(--color-surface-800); border-top: 1px solid var(--color-surface-500);
		padding: 12px 24px; display: flex; align-items: center; justify-content: space-between;
	}
	.apply-text { font-size: 14px; color: var(--color-text-secondary); }
	.apply-actions { display: flex; gap: 8px; }

	/* Buttons */
	.btn {
		padding: 8px 20px; border-radius: var(--radius-sm); font-size: 14px;
		font-weight: 500; cursor: pointer; border: none; transition: background 0.15s;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }

	/* Message toast */
	.message-toast {
		position: fixed; bottom: 72px; right: 24px; z-index: 101;
		padding: 12px 20px; border-radius: var(--radius-md); font-size: 13px;
		display: flex; align-items: center; gap: 12px;
		color: var(--color-text-primary);
	}
	.message-toast.success {
		background: var(--color-success-muted); border: 1px solid var(--color-success);
	}
	.message-toast.error {
		background: var(--color-danger-muted); border: 1px solid var(--color-danger);
	}
	.toast-close {
		background: none; border: none; color: var(--color-text-muted);
		cursor: pointer; font-size: 14px; padding: 0;
	}
</style>
