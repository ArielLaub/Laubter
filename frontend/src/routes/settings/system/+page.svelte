<script lang="ts">
	import { onMount } from 'svelte';
	import * as uci from '$openwrt/uci';
	import { call } from '$api/ubus';

	let loading = $state(true);
	let saving = $state(false);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');
	let showRebootConfirm = $state(false);
	let rebooting = $state(false);

	// Form state
	let hostname = $state('');
	let description = $state('');
	let zonename = $state('UTC');
	let timezone = $state('UTC0');
	let logSize = $state('64');
	let ntpServers = $state<string[]>([]);
	let ntpEnabled = $state(true);

	const timezones: { label: string; zonename: string; tz: string }[] = [
		{ label: 'UTC', zonename: 'UTC', tz: 'UTC0' },
		{ label: 'GMT (London)', zonename: 'Europe/London', tz: 'GMT0BST,M3.5.0/1,M10.5.0' },
		{ label: 'CET (Berlin, Paris)', zonename: 'Europe/Berlin', tz: 'CET-1CEST,M3.5.0,M10.5.0/3' },
		{ label: 'EET (Helsinki, Athens)', zonename: 'Europe/Helsinki', tz: 'EET-2EEST,M3.5.0/3,M10.5.0/4' },
		{ label: 'IST (Jerusalem)', zonename: 'Asia/Jerusalem', tz: 'IST-2IDT,M3.4.4/26,M10.5.0' },
		{ label: 'MSK (Moscow)', zonename: 'Europe/Moscow', tz: 'MSK-3' },
		{ label: 'EST (New York)', zonename: 'America/New_York', tz: 'EST5EDT,M3.2.0,M11.1.0' },
		{ label: 'CST (Chicago)', zonename: 'America/Chicago', tz: 'CST6CDT,M3.2.0,M11.1.0' },
		{ label: 'MST (Denver)', zonename: 'America/Denver', tz: 'MST7MDT,M3.2.0,M11.1.0' },
		{ label: 'PST (Los Angeles)', zonename: 'America/Los_Angeles', tz: 'PST8PDT,M3.2.0,M11.1.0' },
		{ label: 'AKST (Anchorage)', zonename: 'America/Anchorage', tz: 'AKST9AKDT,M3.2.0,M11.1.0' },
		{ label: 'HST (Honolulu)', zonename: 'Pacific/Honolulu', tz: 'HST10' },
		{ label: 'JST (Tokyo)', zonename: 'Asia/Tokyo', tz: 'JST-9' },
		{ label: 'CST (Shanghai)', zonename: 'Asia/Shanghai', tz: 'CST-8' },
		{ label: 'IST (Kolkata)', zonename: 'Asia/Kolkata', tz: 'IST-5:30' },
		{ label: 'AEST (Sydney)', zonename: 'Australia/Sydney', tz: 'AEST-10AEDT,M10.1.0,M4.1.0/3' },
		{ label: 'NZST (Auckland)', zonename: 'Pacific/Auckland', tz: 'NZST-12NZDT,M9.5.0,M4.1.0/3' },
	];

	onMount(async () => {
		try {
			await uci.load('system');
			loadFormFromUci();
		} catch (e) {
			message = 'Failed to load system config: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			loading = false;
		}
	});

	function loadFormFromUci() {
		const sys = uci.getFirst('system', 'system') as Record<string, unknown> | undefined;
		if (!sys) return;

		hostname = (sys.hostname as string) ?? '';
		description = (sys.description as string) ?? '';
		zonename = (sys.zonename as string) ?? 'UTC';
		timezone = (sys.timezone as string) ?? 'UTC0';
		logSize = String(sys.log_size ?? '64');

		// NTP
		const ntp = uci.getFirst('system', 'timeserver') as Record<string, unknown> | undefined;
		if (ntp) {
			ntpEnabled = ntp.enabled !== '0' && ntp.enabled !== 0;
			const servers = ntp.server;
			if (Array.isArray(servers)) {
				ntpServers = [...servers as string[]];
			} else if (typeof servers === 'string') {
				ntpServers = [servers];
			}
		}
	}

	function applyFormToUci() {
		const sysSections = uci.sections('system', 'system');
		if (sysSections.length === 0) return;
		const secName = sysSections[0]['.name'] as string;

		uci.set('system', secName, 'hostname', hostname);
		if (description) {
			uci.set('system', secName, 'description', description);
		} else {
			uci.set('system', secName, 'description', undefined);
		}
		uci.set('system', secName, 'zonename', zonename);
		uci.set('system', secName, 'timezone', timezone);
		uci.set('system', secName, 'log_size', logSize);

		// NTP
		const ntpSections = uci.sections('system', 'timeserver');
		if (ntpSections.length > 0) {
			const ntpSec = ntpSections[0]['.name'] as string;
			uci.set('system', ntpSec, 'enabled', ntpEnabled ? '1' : '0');
			uci.set('system', ntpSec, 'server', ntpServers.filter(Boolean));
		}
	}

	function handleTimezoneChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		const selected = timezones.find(tz => tz.zonename === select.value);
		if (selected) {
			zonename = selected.zonename;
			timezone = selected.tz;
		}
	}

	function addNtpServer() {
		ntpServers = [...ntpServers, ''];
	}

	function removeNtpServer(index: number) {
		ntpServers = ntpServers.filter((_, i) => i !== index);
	}

	async function handleApply() {
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
		uci.revert('system');
		await uci.load('system');
		loadFormFromUci();
	}

	async function handleReboot() {
		rebooting = true;
		showRebootConfirm = false;
		try {
			await call('system', 'reboot', {});
		} catch { /* expected - connection drops */ }
	}

	async function handleBackup() {
		try {
			const resp = await fetch('/cgi-bin/cgi-backup', { method: 'GET' });
			if (resp.ok) {
				const blob = await resp.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `backup-${hostname}-${new Date().toISOString().slice(0, 10)}.tar.gz`;
				a.click();
				URL.revokeObjectURL(url);
			}
		} catch (e) {
			console.error('Backup download failed:', e);
		}
	}

	const pendingChanges = $derived(uci.hasChanges('system'));
</script>

<div class="page">
	<h1>System Settings</h1>
	<p class="subtitle">General system configuration</p>

	{#if loading}
		<div class="loading">Loading configuration...</div>
	{:else}
		<div class="form-card">
			<h2 class="card-title">General</h2>

			<div class="form-group">
				<label class="form-label" for="hostname">Hostname</label>
				<input id="hostname" type="text" class="form-input" bind:value={hostname} placeholder="OpenWrt" />
			</div>

			<div class="form-group">
				<label class="form-label" for="description">Description</label>
				<input id="description" type="text" class="form-input" bind:value={description} placeholder="My Router" />
			</div>

			<div class="form-group">
				<label class="form-label" for="timezone">Timezone</label>
				<select id="timezone" class="form-input" value={zonename} onchange={handleTimezoneChange}>
					{#each timezones as tz}
						<option value={tz.zonename}>{tz.label}</option>
					{/each}
				</select>
			</div>

			<div class="form-group">
				<label class="form-label" for="log-size">System Log Buffer Size (KB)</label>
				<input id="log-size" type="number" class="form-input" bind:value={logSize} placeholder="64" />
			</div>
		</div>

		<div class="form-card">
			<h2 class="card-title">NTP Time Synchronization</h2>

			<div class="form-group">
				<label class="form-label toggle-label">
					<input type="checkbox" class="toggle" bind:checked={ntpEnabled} />
					<span>Enable NTP Client</span>
				</label>
			</div>

			{#if ntpEnabled}
				<div class="ntp-servers">
					{#each ntpServers as server, i}
						<div class="ntp-row">
							<input
								type="text"
								class="form-input"
								value={server}
								oninput={(e) => { ntpServers[i] = (e.target as HTMLInputElement).value; }}
								placeholder="pool.ntp.org"
							/>
							<button class="btn-icon" onclick={() => removeNtpServer(i)} title="Remove">&#10005;</button>
						</div>
					{/each}
					<button class="btn btn-secondary btn-sm" onclick={addNtpServer}>Add NTP Server</button>
				</div>
			{/if}
		</div>

		<div class="form-card">
			<h2 class="card-title">Maintenance</h2>

			<div class="maintenance-actions">
				<div class="action-item">
					<div>
						<span class="action-label">Backup Configuration</span>
						<span class="action-desc">Download a backup of all system configuration</span>
					</div>
					<button class="btn btn-secondary" onclick={handleBackup}>Download Backup</button>
				</div>

				<div class="action-item">
					<div>
						<span class="action-label">Reboot Device</span>
						<span class="action-desc">Restart the router (network will be temporarily unavailable)</span>
					</div>
					{#if showRebootConfirm}
						<div class="confirm-actions">
							<button class="btn btn-secondary btn-sm" onclick={() => showRebootConfirm = false}>Cancel</button>
							<button class="btn btn-danger btn-sm" onclick={handleReboot}>Confirm Reboot</button>
						</div>
					{:else}
						<button class="btn btn-danger" onclick={() => showRebootConfirm = true} disabled={rebooting}>
							{#if rebooting}Rebooting...{:else}Reboot{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if rebooting}
		<div class="reboot-overlay">
			<div class="reboot-message">
				<h2>Rebooting...</h2>
				<p>The router is restarting. This page will reload automatically when the router is back online.</p>
				<div class="spinner"></div>
			</div>
		</div>
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

	.form-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); padding: 24px;
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

	/* NTP */
	.ntp-servers { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
	.ntp-row { display: flex; align-items: center; gap: 8px; }
	.ntp-row .form-input { max-width: 360px; }
	.btn-icon {
		width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		background: var(--color-surface-600); border: none; border-radius: var(--radius-sm);
		color: var(--color-text-muted); cursor: pointer; font-size: 14px; flex-shrink: 0;
	}
	.btn-icon:hover { background: var(--color-danger-muted); color: var(--color-danger); }

	/* Maintenance */
	.maintenance-actions { display: flex; flex-direction: column; gap: 16px; }
	.action-item {
		display: flex; align-items: center; justify-content: space-between; gap: 16px;
		padding: 16px; background: var(--color-surface-700); border-radius: var(--radius-sm);
	}
	.action-label { display: block; font-size: 14px; font-weight: 500; color: var(--color-text-primary); }
	.action-desc { display: block; font-size: 12px; color: var(--color-text-muted); margin-top: 2px; }
	.confirm-actions { display: flex; gap: 8px; }

	/* Buttons */
	.btn {
		padding: 8px 20px; border-radius: var(--radius-sm); font-size: 14px;
		font-weight: 500; cursor: pointer; border: none; transition: background 0.15s;
		white-space: nowrap;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-sm { padding: 6px 14px; font-size: 13px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }
	.btn-danger { background: var(--color-danger); color: white; }
	.btn-danger:hover:not(:disabled) { background: #dc2626; }

	/* Reboot overlay */
	.reboot-overlay {
		position: fixed; inset: 0; z-index: 200;
		background: rgba(0, 0, 0, 0.75);
		display: flex; align-items: center; justify-content: center;
	}
	.reboot-message {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-lg); padding: 40px; text-align: center; max-width: 400px;
	}
	.reboot-message h2 { font-size: 20px; color: var(--color-text-primary); margin: 0 0 12px; }
	.reboot-message p { font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px; }
	.spinner {
		width: 32px; height: 32px; border: 3px solid var(--color-surface-500);
		border-top-color: var(--color-accent); border-radius: 50%;
		animation: spin 1s linear infinite; margin: 0 auto;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* Apply Bar */
	.apply-bar {
		position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
		background: var(--color-surface-800); border-top: 1px solid var(--color-surface-500);
		padding: 12px 24px; display: flex; align-items: center; justify-content: space-between;
	}
	.apply-text { font-size: 14px; color: var(--color-text-secondary); }
	.apply-actions { display: flex; gap: 8px; }

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
