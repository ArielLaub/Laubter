<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		onClose: () => void;
		children: Snippet;
	}

	let { open, title, onClose, children }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			onClose();
		}
	}

	function handleBackdropClick() {
		onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" onclick={handleBackdropClick} role="presentation"></div>
	<div class="panel" class:open>
		<div class="panel-header">
			<h2>{title}</h2>
			<button class="close-btn" onclick={onClose} aria-label="Close panel">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
		<div class="panel-divider"></div>
		<div class="panel-content">
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 998;
		animation: fadeIn 200ms ease;
	}

	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 400px;
		max-width: 90vw;
		background: var(--color-surface-900, #1a1a2e);
		border-left: 1px solid var(--color-surface-500);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
		z-index: 999;
		display: flex;
		flex-direction: column;
		animation: slideIn 250ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		flex-shrink: 0;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.panel-divider {
		height: 1px;
		background: var(--color-surface-500);
		margin: 0 20px;
		flex-shrink: 0;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-sm, 4px);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-surface-700);
	}

	.panel-content {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
</style>
