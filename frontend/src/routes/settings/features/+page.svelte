<script lang="ts">
	import { features, fetchFeatures, enableFeature, disableFeature, type Feature } from '$stores/features';

	let busy = $state<string | null>(null);
	let error = $state('');
	let message = $state('');

	async function handleToggle(feat: Feature) {
		busy = feat.id;
		error = '';
		message = '';

		if (feat.enabled) {
			const err = await disableFeature(feat.id);
			if (err) {
				error = `Failed to disable ${feat.label}: ${err}`;
			} else {
				message = `${feat.label} disabled`;
			}
		} else {
			const err = await enableFeature(feat.id);
			if (err) {
				error = `Failed to enable ${feat.label}: ${err}`;
			} else {
				message = `${feat.label} enabled`;
			}
		}

		busy = null;
	}
</script>

<div class="page">
	<h1>Features</h1>
	<p class="subtitle">Enable or disable optional features. Enabling installs required packages; disabling removes them.</p>

	{#if $features.length === 0}
		<div class="loading">Loading features...</div>
	{:else}
		<div class="feature-list">
			{#each $features as feat}
				{@const isBusy = busy === feat.id}
				<div class="feature-card">
					<div class="feature-info">
						<span class="feature-label">{feat.label}</span>
						<span class="feature-desc">{feat.description}</span>
						<span class="feature-packages">Packages: {feat.packages}</span>
					</div>
					<button
						class="toggle-btn"
						class:active={feat.enabled}
						disabled={isBusy}
						onclick={() => handleToggle(feat)}
					>
						{#if isBusy}
							<span class="spinner-sm"></span>
						{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if error}
		<div class="message-toast error">
			<span>{error}</span>
			<button class="toast-close" onclick={() => error = ''}>&#10005;</button>
		</div>
	{/if}

	{#if message}
		<div class="message-toast success">
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

	.feature-list { display: flex; flex-direction: column; gap: 8px; }

	.feature-card {
		display: flex; align-items: center; justify-content: space-between; gap: 16px;
		padding: 16px 20px;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
	}

	.feature-info { display: flex; flex-direction: column; gap: 2px; }
	.feature-label { font-size: 14px; font-weight: 500; color: var(--color-text-primary); }
	.feature-desc { font-size: 12px; color: var(--color-text-secondary); }
	.feature-packages { font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); margin-top: 2px; }

	.toggle-btn {
		width: 44px; height: 24px; border-radius: var(--radius-full);
		background: var(--color-surface-500); border: none; cursor: pointer;
		position: relative; transition: background 0.2s; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
	}
	.toggle-btn::after {
		content: ''; position: absolute; top: 3px; left: 3px;
		width: 18px; height: 18px; border-radius: 50%; background: white;
		transition: transform 0.2s;
	}
	.toggle-btn.active { background: var(--color-accent); }
	.toggle-btn.active::after { transform: translateX(20px); }
	.toggle-btn:disabled { opacity: 0.6; cursor: wait; }

	.spinner-sm {
		width: 14px; height: 14px;
		border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
		border-radius: 50%; animation: spin 0.6s linear infinite;
		z-index: 1;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.message-toast {
		position: fixed; bottom: 24px; right: 24px; z-index: 101;
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
