<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { session, validateSession } from '$stores/session';
	import { systemBoard, fetchSystemData } from '$stores/system';
	import { call } from '$api/ubus';
	import { fetchInterfaces } from '$stores/network';
	import { fetchWirelessStatus, fetchDhcpLeases } from '$stores/wireless';
	import { fetchMeshTopology, fetchMeshConfig, initWirelessProvider } from '$stores/mesh';
	import { register, unregisterAll } from '$stores/polling';
	import { fetchFeatures } from '$stores/features';
	import Sidebar from '$components/layout/Sidebar.svelte';
	import TopBar from '$components/layout/TopBar.svelte';
	import { sidebarPinned } from '$stores/preferences';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const isLoginPage = $derived($page.url.pathname === '/login');
	const isAuthenticated = $derived($session.authenticated);

	let rxSpeed = $state(0);
	let txSpeed = $state(0);

	async function fetchCurrentSpeed() {
		try {
			const data = await call<{ rx_rate: number; tx_rate: number }>('laubter-stats', 'get_current', {});
			rxSpeed = data.rx_rate || 0;
			txSpeed = data.tx_rate || 0;
		} catch {}
	}

	// On initial load with saved session, validate it
	let validated = $state(false);
	$effect(() => {
		if (isAuthenticated && !validated && !isLoginPage) {
			validated = true;
			validateSession().then((valid) => {
				if (!valid) {
					session.set({ authenticated: false, username: '', timeout: 0 });
					localStorage.removeItem('owrt_session');
					goto('/login');
				}
			});
		}
	});

	// Start polling when authenticated
	$effect(() => {
		if (isAuthenticated && !isLoginPage) {
			fetchSystemData();
			fetchFeatures();
			fetchInterfaces();
			fetchWirelessStatus();
			fetchDhcpLeases();
			initWirelessProvider().then(() => {
				fetchMeshTopology();
				fetchMeshConfig();
			});

			register('system', fetchSystemData, 5000);
			register('interfaces', fetchInterfaces, 5000);
			register('wireless', fetchWirelessStatus, 10000);
			register('dhcp', fetchDhcpLeases, 10000);
			register('mesh', fetchMeshTopology, 10000);
			register('speed', fetchCurrentSpeed, 2000);

			return () => {
				unregisterAll();
			};
		}
	});

	// Redirect to login if not authenticated (use goto, not window.location)
	$effect(() => {
		if (!isAuthenticated && !isLoginPage && typeof window !== 'undefined') {
			goto('/login');
		}
	});
</script>

{#if isLoginPage}
	{@render children()}
{:else if isAuthenticated}
	<div class="app-layout">
		<Sidebar
			hostname={$systemBoard?.hostname ?? 'router'}
			version={$systemBoard?.release?.version ?? ''}
			{rxSpeed}
			{txSpeed}
		/>
		<div class="main-area" class:sidebar-pinned={$sidebarPinned}>
			<TopBar />
			<main class="content">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<style>
	.app-layout {
		display: flex;
		min-height: 100vh;
	}

	.main-area {
		flex: 1;
		margin-left: var(--sidebar-width-expanded);
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.content {
		flex: 1;
		padding: 24px;
		overflow-y: auto;
	}

	@media (max-width: 768px) {
		.main-area {
			margin-left: 0;
		}
	}
</style>
