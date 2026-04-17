<script lang="ts">
	import { page } from '$app/stores';
	import { Search, Bell, Sun, Moon, Power, Menu } from 'lucide-svelte';
	import { logout } from '$stores/session';

	interface Props {
		onToggleSidebar?: () => void;
	}
	let { onToggleSidebar }: Props = $props();

	let darkMode = $state(true);
	let showUserMenu = $state(false);

	function toggleTheme() {
		darkMode = !darkMode;
		// Future: toggle light theme CSS variables
	}

	// Friendly names for routes
	const routeNames: Record<string, string> = {
		'mesh': 'WiFi Mesh',
		'clients': 'Clients',
		'ports': 'Interfaces',
		'statistics': 'Statistics',
		'log': 'Log',
		'firewall': 'Firewall',
		'vpn': 'VPN (WireGuard)',
		'dhcp': 'DHCP',
		'adguard': 'AdGuard',
		'wifi': 'Mesh WiFi',
		'networks': 'Networks',
		'internet': 'Internet',
		'dns': 'DNS',
		'routing': 'Routing',
		'system': 'System',
		'packages': 'Packages',
		'speedtest': 'Speed Test',
	};

	// Top-level pages that shouldn't show "Settings" prefix
	const topLevelPages = new Set(['firewall', 'vpn', 'dhcp', 'adguard']);

	function getBreadcrumb(pathname: string): string[] {
		if (pathname === '/') return ['Dashboard'];
		const parts = pathname.split('/').filter(Boolean);
		// Skip "settings" prefix for pages promoted to top-level
		const lastPart = parts[parts.length - 1];
		if (parts[0] === 'settings' && topLevelPages.has(lastPart)) {
			return [routeNames[lastPart] || lastPart.charAt(0).toUpperCase() + lastPart.slice(1)];
		}
		// For other settings pages, show "Settings / Page"
		if (parts[0] === 'settings' && parts.length > 1) {
			return ['Settings', routeNames[parts[1]] || parts[1].charAt(0).toUpperCase() + parts[1].slice(1)];
		}
		return parts.map((p) => routeNames[p] || p.charAt(0).toUpperCase() + p.slice(1));
	}

	async function handleLogout() {
		await logout();
		window.location.href = '/login';
	}
</script>

<header class="topbar">
	<!-- Mobile hamburger -->
	<button class="hamburger" onclick={onToggleSidebar}>
		<Menu size={20} />
	</button>

	<!-- Breadcrumb -->
	<nav class="breadcrumb">
		{#each getBreadcrumb($page.url.pathname) as crumb, i}
			{#if i > 0}
				<span class="breadcrumb-sep">/</span>
			{/if}
			<span class="breadcrumb-item" class:active={i === getBreadcrumb($page.url.pathname).length - 1}>
				{crumb}
			</span>
		{/each}
	</nav>

	<div class="spacer"></div>

	<!-- Search trigger -->
	<button class="search-bar" title="Search (Cmd+K)">
		<Search size={16} strokeWidth={1.75} />
		<span class="search-placeholder">Search...</span>
		<kbd class="search-kbd">&#8984;K</kbd>
	</button>

	<!-- Notifications -->
	<button class="topbar-btn icon-only" title="Notifications">
		<Bell size={18} strokeWidth={1.75} />
	</button>

	<!-- Theme toggle -->
	<button class="topbar-btn icon-only" onclick={toggleTheme} title="Toggle theme">
		{#if darkMode}
			<Sun size={18} strokeWidth={1.75} />
		{:else}
			<Moon size={18} strokeWidth={1.75} />
		{/if}
	</button>

	<!-- User / System menu -->
	<div class="user-menu-container">
		<button
			class="topbar-btn icon-only"
			onclick={() => { showUserMenu = !showUserMenu; }}
			title="System"
		>
			<Power size={18} strokeWidth={1.75} />
		</button>

		{#if showUserMenu}
			<div class="user-menu" role="menu">
				<button class="menu-item" onclick={() => { window.location.href = '/settings/system'; }}>
					System Settings
				</button>
				<button class="menu-item" onclick={() => { /* TODO: reboot confirm */ }}>
					Reboot Router
				</button>
				<div class="menu-sep"></div>
				<button class="menu-item danger" onclick={handleLogout}>
					Logout
				</button>
			</div>
			<!-- Backdrop to close menu -->
			<button class="menu-backdrop" onclick={() => { showUserMenu = false; }}></button>
		{/if}
	</div>
</header>

<style>
	.topbar {
		height: 48px;
		background: var(--color-surface-800);
		border-bottom: 1px solid var(--color-surface-500);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
		display: flex;
		align-items: center;
		padding: 0 16px;
		gap: 8px;
	}

	.hamburger {
		display: none;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		padding: 8px;
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.hamburger {
			display: flex;
		}
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
	}

	.breadcrumb-item {
		color: var(--color-text-muted);
	}
	.breadcrumb-item.active {
		color: var(--color-text-primary);
		font-weight: 500;
	}
	.breadcrumb-sep {
		color: var(--color-surface-500);
	}

	.spacer {
		flex: 1;
	}

	/* Search bar - wider, looks like a real input */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 14px;
		min-width: 240px;
		background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500);
		border-radius: 8px;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 13px;
		transition: all 0.2s ease;
	}

	.search-bar:hover {
		background: var(--color-surface-600);
		border-color: var(--color-text-muted);
	}

	.search-placeholder {
		flex: 1;
		text-align: left;
		color: var(--color-text-muted);
	}

	.search-kbd {
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		background: var(--color-surface-600);
		border: 1px solid var(--color-surface-500);
		border-radius: 6px;
		color: var(--color-text-muted);
		font-family: var(--font-sans);
		line-height: 1.4;
	}

	.topbar-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		transition: all 0.2s ease;
	}
	.topbar-btn:hover {
		background: var(--color-surface-600);
		color: var(--color-text-primary);
	}
	.topbar-btn.icon-only {
		padding: 6px;
	}

	@media (max-width: 768px) {
		.search-bar {
			min-width: auto;
		}
		.search-placeholder, .search-kbd {
			display: none;
		}
	}

	.user-menu-container {
		position: relative;
	}

	.user-menu {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		min-width: 180px;
		padding: 4px;
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 8px 12px;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.menu-item:hover {
		background: var(--color-surface-600);
		color: var(--color-text-primary);
	}
	.menu-item.danger {
		color: var(--color-danger);
	}
	.menu-item.danger:hover {
		background: var(--color-danger-muted);
	}

	.menu-sep {
		height: 1px;
		background: var(--color-surface-500);
		margin: 4px 0;
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		z-index: 99;
		cursor: default;
	}
</style>
