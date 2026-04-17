<script lang="ts">
	import { page } from '$app/stores';
	import {
		LayoutDashboard, Users, Network, BarChart3, Shield, ShieldCheck, ScrollText,
		Settings, Waypoints, ChevronDown, ArrowDown, ArrowUp,
		Lock, Table
	} from 'lucide-svelte';
	import { formatSpeed } from '$utils/format';
	import { sidebarPinned } from '$stores/preferences';

	interface NavItem {
		icon: typeof LayoutDashboard;
		label: string;
		href: string;
	}

	interface SettingsSubItem {
		label: string;
		href: string;
	}

	const navItems: NavItem[] = [
		{ icon: LayoutDashboard, label: 'Dashboard', href: '/' },
		{ icon: Waypoints, label: 'WiFi Mesh (Asus)', href: '/mesh' },
		{ icon: Users, label: 'Clients', href: '/clients' },
		{ icon: Network, label: 'Interfaces', href: '/ports' },
		{ icon: BarChart3, label: 'Statistics', href: '/statistics' },
		{ icon: Shield, label: 'Firewall', href: '/settings/firewall' },
		{ icon: Lock, label: 'VPN (WireGuard)', href: '/settings/vpn' },
		{ icon: Table, label: 'DHCP', href: '/settings/dhcp' },
		{ icon: ShieldCheck, label: 'AdGuard', href: '/settings/adguard' },
		{ icon: ScrollText, label: 'Log', href: '/log' },
	];

	const settingsItems: SettingsSubItem[] = [
		{ label: 'Mesh WiFi', href: '/settings/wifi' },
		{ label: 'Networks', href: '/settings/networks' },
		{ label: 'Internet', href: '/settings/internet' },
		{ label: 'DNS', href: '/settings/dns' },
		{ label: 'Routing', href: '/settings/routing' },
		{ label: 'Speed Test', href: '/settings/speedtest' },
		{ label: 'Home Assistant', href: '/settings/mqtt' },
		{ label: 'Processes', href: '/settings/processes' },
		{ label: 'System', href: '/settings/system' },
		{ label: 'Packages', href: '/settings/packages' },
	];

	let settingsOpen = $state(false);

	// Always expanded
	$effect(() => { sidebarPinned.set(true); });
	const isSettingsActive = $derived($page.url.pathname.startsWith('/settings'));

	// Auto-expand settings tree when on a settings page
	$effect(() => {
		if (isSettingsActive) settingsOpen = true;
	});

	function isActive(href: string, currentPath: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}

	interface Props {
		rxSpeed?: number;
		txSpeed?: number;
		hostname?: string;
		version?: string;
	}
	let { rxSpeed = 0, txSpeed = 0, hostname = 'router', version = '' }: Props = $props();
</script>

<nav class="sidebar expanded">
	<div class="sidebar-header">
		<span class="logo-text">Laubter</span>
	</div>

	<div class="nav-scroll">
		{#each navItems as item}
			{@const active = isActive(item.href, $page.url.pathname)}
			<a href={item.href} class="nav-item" class:active>
				<span class="nav-icon"><item.icon size={18} strokeWidth={1.75} /></span>
				<span class="nav-label">{item.label}</span>
			</a>
		{/each}

		<div class="nav-separator"></div>

		<button
			class="nav-item settings-toggle"
			class:active={isSettingsActive}
			onclick={() => { settingsOpen = !settingsOpen; }}
		>
			<span class="nav-icon"><Settings size={18} strokeWidth={1.75} /></span>
			<span class="nav-label">Settings</span>
			<span class="tree-chevron" class:open={settingsOpen}>
				<ChevronDown size={14} />
			</span>
		</button>

		{#if settingsOpen}
			<div class="settings-tree">
				{#each settingsItems as sub}
					{@const subActive = $page.url.pathname === sub.href}
					<a href={sub.href} class="tree-item" class:active={subActive}>
						{sub.label}
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<div class="sidebar-footer">
		<div class="throughput">
			<span class="tp-row">
				<ArrowDown size={11} class="text-chart-blue" />
				{formatSpeed(rxSpeed)}
			</span>
			<span class="tp-row">
				<ArrowUp size={11} class="text-chart-cyan" />
				{formatSpeed(txSpeed)}
			</span>
		</div>
		<div class="router-info">{hostname} &middot; {version}</div>
	</div>
</nav>

<style>
	.sidebar {
		position: fixed; left: 0; top: 0; bottom: 0;
		width: var(--sidebar-width-expanded);
		background: linear-gradient(180deg, #161b22 0%, #0e1117 100%);
		border-right: 1px solid var(--color-surface-500);
		display: flex; flex-direction: column;
		z-index: 50; overflow: hidden;
	}

	.sidebar-header {
		height: 48px; display: flex; align-items: center; justify-content: space-between;
		padding: 0 16px; border-bottom: 1px solid var(--color-surface-500); flex-shrink: 0;
	}
	.logo-text { font-size: 18px; font-weight: 700; color: var(--color-accent); letter-spacing: -0.5px; }
	.logo-icon { font-size: 18px; font-weight: 700; color: var(--color-accent); width: 100%; text-align: center; display: block; }
	.pin-btn {
		background: none; border: none; color: var(--color-text-muted); cursor: pointer;
		padding: 4px; border-radius: var(--radius-sm); display: flex; align-items: center;
	}
	.pin-btn:hover { color: var(--color-text-primary); background: var(--color-surface-600); }

	.nav-scroll {
		flex: 1; overflow-y: auto; overflow-x: hidden;
		padding: 8px 0; display: flex; flex-direction: column; gap: 1px;
	}

	.nav-item {
		display: flex; align-items: center;
		gap: 10px; padding: 9px 14px; margin: 0 8px; border-radius: 8px;
		color: var(--color-text-secondary); text-decoration: none; font-size: 13px;
		transition: all 0.15s ease; white-space: nowrap; cursor: pointer;
		background: none; border: none; font-family: inherit; width: calc(100% - 16px);
	}
	.nav-item:hover { background: rgba(255,255,255,0.06); color: var(--color-text-primary); }
	.nav-item.active { background: var(--color-accent); color: #fff; }

	.nav-icon { display: flex; align-items: center; justify-content: center; width: 20px; flex-shrink: 0; }
	.nav-label { flex: 1; text-align: left; }

	.settings-toggle { position: relative; }
	.tree-chevron {
		display: flex; align-items: center; color: var(--color-text-muted);
		transition: transform 0.2s ease;
	}
	.tree-chevron.open { transform: rotate(0deg); }
	.tree-chevron:not(.open) { transform: rotate(-90deg); }

	.settings-tree {
		display: flex; flex-direction: column; gap: 0;
		padding: 2px 0 4px 0; margin-left: 30px;
	}
	.tree-item {
		display: block; padding: 6px 14px; margin: 0 8px 0 0;
		font-size: 12px; color: var(--color-text-muted); text-decoration: none;
		border-radius: 6px; border-left: 2px solid var(--color-surface-500);
		transition: all 0.15s ease;
	}
	.tree-item:hover { color: var(--color-text-primary); background: rgba(255,255,255,0.04); border-left-color: var(--color-text-muted); }
	.tree-item.active { color: var(--color-accent-light); border-left-color: var(--color-accent); background: var(--color-accent-muted); }

	.nav-separator { height: 1px; background: var(--color-surface-500); margin: 6px 16px; }

	.sidebar-footer { padding: 10px 16px; border-top: 1px solid var(--color-surface-500); flex-shrink: 0; }
	.throughput { display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-family: var(--font-mono); }
	.tp-row { display: flex; align-items: center; gap: 6px; color: var(--color-text-secondary); }
	.tp-mini { display: flex; flex-direction: column; align-items: center; gap: 4px; }
	.router-info { font-size: 10px; color: var(--color-text-muted); margin-top: 4px; }

	@media (max-width: 768px) {
		.sidebar { display: none; }
	}
</style>
