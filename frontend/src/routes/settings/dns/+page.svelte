<script lang="ts">
	import { onMount } from 'svelte';
	import * as uci from '$openwrt/uci';

	let loading = $state(true);
	let saving = $state(false);
	let message = $state('');
	let messageType = $state<'success' | 'error'>('success');

	let domain = $state('');
	let cacheSize = $state('150');
	let rebindProtection = $state(true);
	let localService = $state(true);
	let logQueries = $state(false);
	let upstreamDns = $state(['', '']);

	onMount(async () => {
		try {
			await uci.load('dhcp');
			loadFormFromUci();
		} catch (e) {
			message = 'Failed to load DNS config: ' + (e instanceof Error ? e.message : 'unknown error');
			messageType = 'error';
		} finally {
			loading = false;
		}
	});

	function loadFormFromUci() {
		const dnsmasq = uci.getFirst('dhcp', 'dnsmasq') as Record<string, unknown> | undefined;
		if (!dnsmasq) return;

		domain = (dnsmasq.domain as string) ?? 'local';
		cacheSize = String(dnsmasq.cachesize ?? '150');
		rebindProtection = dnsmasq.rebind_protection !== '0' && dnsmasq.rebind_protection !== 0;
		localService = dnsmasq.localservice !== '0' && dnsmasq.localservice !== 0;
		logQueries = dnsmasq.logqueries === '1' || dnsmasq.logqueries === 1;

		const servers = dnsmasq.server;
		if (Array.isArray(servers)) {
			upstreamDns = [servers[0] ?? '', servers[1] ?? ''];
		} else if (typeof servers === 'string') {
			upstreamDns = [servers, ''];
		}
	}

	function applyFormToUci() {
		const dnsmasqSections = uci.sections('dhcp', 'dnsmasq');
		if (dnsmasqSections.length === 0) return;
		const secName = dnsmasqSections[0]['.name'] as string;

		uci.set('dhcp', secName, 'domain', domain);
		uci.set('dhcp', secName, 'cachesize', cacheSize);
		uci.set('dhcp', secName, 'rebind_protection', rebindProtection ? '1' : '0');
		uci.set('dhcp', secName, 'localservice', localService ? '1' : '0');
		uci.set('dhcp', secName, 'logqueries', logQueries ? '1' : '0');

		const dnsList = upstreamDns.filter(Boolean);
		if (dnsList.length > 0) {
			uci.set('dhcp', secName, 'server', dnsList);
		} else {
			uci.set('dhcp', secName, 'server', undefined);
		}
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
		uci.revert('dhcp');
		await uci.load('dhcp');
		loadFormFromUci();
	}

	const pendingChanges = $derived(uci.hasChanges('dhcp'));
</script>

<div class="page">
	<h1>DNS Settings</h1>
	<p class="subtitle">Configure DNS resolution and caching</p>

	{#if loading}
		<div class="loading">Loading configuration...</div>
	{:else}
		<div class="form-card">
			<h2 class="card-title">General</h2>

			<div class="form-group">
				<label class="form-label" for="domain">Local Domain</label>
				<input id="domain" type="text" class="form-input" bind:value={domain} placeholder="local" />
				<span class="form-hint">Domain suffix for local hosts (e.g., myhost.local)</span>
			</div>

			<div class="form-group">
				<label class="form-label" for="cache-size">Cache Size</label>
				<input id="cache-size" type="number" class="form-input" bind:value={cacheSize} placeholder="150" />
				<span class="form-hint">Number of DNS entries to cache (0 to disable)</span>
			</div>
		</div>

		<div class="form-card">
			<h2 class="card-title">Security</h2>

			<div class="form-group">
				<label class="form-label toggle-label">
					<input type="checkbox" class="toggle" bind:checked={rebindProtection} />
					<span>DNS Rebinding Protection</span>
				</label>
				<span class="form-hint">Discard upstream responses containing RFC1918 addresses to prevent DNS rebinding attacks</span>
			</div>

			<div class="form-group">
				<label class="form-label toggle-label">
					<input type="checkbox" class="toggle" bind:checked={localService} />
					<span>Local Service Only</span>
				</label>
				<span class="form-hint">Only accept DNS queries from local subnets</span>
			</div>
		</div>

		<div class="form-card">
			<h2 class="card-title">Upstream DNS Servers</h2>
			<span class="form-hint card-hint">Override upstream DNS servers (leave empty to use ISP-provided servers)</span>

			<div class="form-group">
				<label class="form-label" for="dns1">Primary DNS Server</label>
				<input id="dns1" type="text" class="form-input" bind:value={upstreamDns[0]} placeholder="1.1.1.1" />
			</div>
			<div class="form-group">
				<label class="form-label" for="dns2">Secondary DNS Server</label>
				<input id="dns2" type="text" class="form-input" bind:value={upstreamDns[1]} placeholder="8.8.8.8" />
			</div>
		</div>

		<div class="form-card">
			<h2 class="card-title">Diagnostics</h2>

			<div class="form-group">
				<label class="form-label toggle-label">
					<input type="checkbox" class="toggle" bind:checked={logQueries} />
					<span>Log DNS Queries</span>
				</label>
				<span class="form-hint">Log all DNS queries to the system log (may impact performance)</span>
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
	.card-hint { display: block; margin-bottom: 16px; }
	.form-group { margin-bottom: 16px; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-input {
		width: 100%; max-width: 400px; padding: 8px 12px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
	}
	.form-input:focus { border-color: var(--color-accent); }
	.form-hint { display: block; font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }

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
