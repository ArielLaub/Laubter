<script lang="ts">
	import { login, session } from '$stores/session';
	import { goto } from '$app/navigation';

	let username = $state('root');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;

		try {
			await login(username, password);
			goto('/');
		} catch (err) {
			error = 'Invalid username or password';
		} finally {
			loading = false;
		}
	}

	// Redirect if already authenticated
	$effect(() => {
		if ($session.authenticated) {
			goto('/');
		}
	});
</script>

<div class="login-page">
	<div class="login-card">
		<div class="login-header">
			<h1 class="login-logo">Laubter</h1>
			<p class="login-subtitle">Router Management</p>
		</div>

		<form onsubmit={handleSubmit}>
			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					type="text"
					bind:value={username}
					autocomplete="username"
					disabled={loading}
				/>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					autocomplete="current-password"
					autofocus
					disabled={loading}
				/>
			</div>

			{#if error}
				<div class="error">{error}</div>
			{/if}

			<button type="submit" class="login-btn" disabled={loading}>
				{loading ? 'Signing in...' : 'Sign In'}
			</button>
		</form>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-900);
	}

	.login-card {
		width: 100%;
		max-width: 380px;
		padding: 40px;
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-lg);
	}

	.login-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.login-logo {
		font-size: 28px;
		font-weight: 700;
		color: var(--color-accent);
		margin: 0;
		letter-spacing: -1px;
	}

	.login-subtitle {
		color: var(--color-text-muted);
		font-size: 14px;
		margin: 4px 0 0;
	}

	.field {
		margin-bottom: 16px;
	}

	label {
		display: block;
		font-size: 13px;
		color: var(--color-text-secondary);
		margin-bottom: 6px;
	}

	input {
		width: 100%;
		padding: 10px 12px;
		background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 14px;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}
	input:focus {
		border-color: var(--color-accent);
	}
	input:disabled {
		opacity: 0.5;
	}

	.error {
		padding: 8px 12px;
		background: var(--color-danger-muted);
		color: var(--color-danger);
		border-radius: var(--radius-md);
		font-size: 13px;
		margin-bottom: 16px;
	}

	.login-btn {
		width: 100%;
		padding: 10px;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s ease;
		font-family: inherit;
	}
	.login-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
	.login-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
