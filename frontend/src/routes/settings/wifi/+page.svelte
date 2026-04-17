<script lang="ts">
	import { meshConfig, fetchMeshConfig, testMeshConnection, configureMesh } from '$stores/mesh';
	import { Wifi, CheckCircle, XCircle, Loader2, Save } from 'lucide-svelte';

	let host = $state('');
	let port = $state('');
	let username = $state('');
	let password = $state('');
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state<{ status: string; message?: string } | null>(null);
	let saveMessage = $state('');

	// Initialize form from config
	$effect(() => {
		if ($meshConfig) {
			host = $meshConfig.host || '';
			port = $meshConfig.port || '';
			username = $meshConfig.username || '';
		}
	});

	const isConnected = $derived(testResult?.status === 'ok');

	async function handleTest() {
		testing = true;
		testResult = null;
		try {
			testResult = await testMeshConnection();
		} catch (e) {
			testResult = { status: 'error', message: e instanceof Error ? e.message : 'Connection test failed' };
		} finally {
			testing = false;
		}
	}

	async function handleSave() {
		saving = true;
		saveMessage = '';
		try {
			await configureMesh({ host, port, username, password });
			await fetchMeshConfig();
			saveMessage = 'Saved! Now click Test Connection to verify.';
			// Don't clear password — user needs to see it was entered
		} catch (e) {
			saveMessage = 'Error: ' + (e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}
</script>

<div class="page">
	<div class="page-header">
		<div class="header-icon">
			<Wifi size={20} strokeWidth={1.75} />
		</div>
		<div>
			<h1>Mesh WiFi Integration</h1>
			<p class="subtitle">WiFi is managed by your external mesh system. Configure the connection to your mesh AP below.</p>
		</div>
	</div>

	<!-- Current status -->
	<div class="status-card">
		<div class="status-header">
			<h3>Connection Status</h3>
			{#if $meshConfig}
				<span class="status-badge connected">
					<CheckCircle size={14} strokeWidth={2} />
					Configured
				</span>
			{:else}
				<span class="status-badge disconnected">
					<XCircle size={14} strokeWidth={2} />
					Not Configured
				</span>
			{/if}
		</div>
		{#if $meshConfig}
			<div class="status-details">
				<div class="status-row">
					<span class="status-label">Provider</span>
					<span class="status-value">{$meshConfig.provider}</span>
				</div>
				<div class="status-row">
					<span class="status-label">Host</span>
					<span class="status-value mono">{$meshConfig.host}:{$meshConfig.port}</span>
				</div>
				<div class="status-row">
					<span class="status-label">Protocol</span>
					<span class="status-value">{$meshConfig.proto}</span>
				</div>
				<div class="status-row">
					<span class="status-label">Username</span>
					<span class="status-value">{$meshConfig.username}</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Configuration form -->
	<div class="config-card">
		<h3>Configuration</h3>
		<form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
			<div class="form-grid">
				<div class="form-group">
					<label for="mesh-host">Host IP</label>
					<input
						id="mesh-host"
						type="text"
						class="form-input"
						placeholder="192.168.50.1"
						bind:value={host}
					/>
				</div>
				<div class="form-group">
					<label for="mesh-port">Port</label>
					<input
						id="mesh-port"
						type="text"
						class="form-input"
						placeholder="443"
						bind:value={port}
					/>
				</div>
				<div class="form-group">
					<label for="mesh-user">Username</label>
					<input
						id="mesh-user"
						type="text"
						class="form-input"
						placeholder="admin"
						bind:value={username}
					/>
				</div>
				<div class="form-group">
					<label for="mesh-pass">Password</label>
					<input
						id="mesh-pass"
						type="password"
						class="form-input"
						placeholder={$meshConfig?.hasPassword ? '(unchanged)' : 'Enter password'}
						bind:value={password}
					/>
				</div>
			</div>

			<div class="form-actions">
				<button type="button" class="btn btn-secondary" onclick={handleTest} disabled={testing || !host}>
					{#if testing}
						<Loader2 size={16} strokeWidth={2} class="spin" />
						Testing...
					{:else}
						Test Connection
					{/if}
				</button>
				<button type="submit" class="btn btn-primary" disabled={saving || !host}>
					{#if saving}
						<Loader2 size={16} strokeWidth={2} class="spin" />
						Saving...
					{:else}
						<Save size={16} strokeWidth={2} />
						Save Configuration
					{/if}
				</button>
			</div>

			{#if testResult}
				<div class="test-result" class:success={testResult.status === 'ok'} class:error={testResult.status !== 'ok'}>
					{#if testResult.status === 'ok'}
						<CheckCircle size={16} strokeWidth={2} />
						Connection successful
					{:else}
						<XCircle size={16} strokeWidth={2} />
						{testResult.message || 'Connection failed'}
					{/if}
				</div>
			{/if}

			{#if saveMessage}
				<div class="save-message">
					{saveMessage}
				</div>
			{/if}
		</form>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-width: 640px;
	}

	.page-header {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.header-icon {
		color: var(--color-accent-light);
		margin-top: 2px;
	}
	h1 {
		font-size: 24px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 4px;
	}
	.subtitle {
		font-size: 14px;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.4;
	}

	/* Status card */
	.status-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 20px;
	}
	.status-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.status-header h3 {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 500;
		padding: 4px 12px;
		border-radius: var(--radius-full);
	}
	.status-badge.connected {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}
	.status-badge.disconnected {
		background: rgba(156, 163, 175, 0.15);
		color: var(--color-text-muted);
	}
	.status-details {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 0;
		border-bottom: 1px solid var(--color-surface-700);
	}
	.status-row:last-child {
		border-bottom: none;
	}
	.status-label {
		font-size: 13px;
		color: var(--color-text-muted);
	}
	.status-value {
		font-size: 14px;
		color: var(--color-text-primary);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 13px;
	}

	/* Config card */
	.config-card {
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		padding: 20px;
	}
	.config-card h3 {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 16px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 20px;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.form-group label {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}
	.form-input {
		padding: 8px 12px;
		background: var(--color-surface-900, #0e1117);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 14px;
		outline: none;
		transition: border-color 0.2s ease;
	}
	.form-input::placeholder {
		color: var(--color-text-muted);
	}
	.form-input:focus {
		border-color: var(--color-accent);
	}

	.form-actions {
		display: flex;
		gap: 12px;
		margin-bottom: 16px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
		border: none;
		border-radius: var(--radius-md);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary {
		background: var(--color-accent);
		color: #ffffff;
	}
	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.btn-secondary {
		background: var(--color-surface-700);
		color: var(--color-text-primary);
		border: 1px solid var(--color-surface-500);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-600);
	}

	.test-result {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		border-radius: var(--radius-md);
		font-size: 14px;
		margin-bottom: 8px;
	}
	.test-result.success {
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
		border: 1px solid rgba(34, 197, 94, 0.25);
	}
	.test-result.error {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.25);
	}

	.save-message {
		font-size: 13px;
		color: var(--color-text-secondary);
		padding: 8px 0;
	}

	@media (max-width: 480px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
		.form-actions {
			flex-direction: column;
		}
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
