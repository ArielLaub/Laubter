/**
 * Wireless provider store -- provides reactive wireless topology data from the active provider.
 * Replaces the old mesh store with provider-aware logic.
 */

import { writable, derived, get } from 'svelte/store';
import type { WirelessTopology, WirelessNode, WirelessClient, WirelessConfig, WirelessProvider, WirelessCapabilities } from '$lib/wireless/types';
import { getProvider, getProviderList } from '$lib/wireless/providers';
import { call } from '$api/ubus';
import { dhcpLeaseList } from '$stores/wireless';

// Active provider instance
let activeProvider: WirelessProvider = getProvider('openwrt');

export const wirelessTopology = writable<WirelessTopology | null>(null);
export const wirelessConfig = writable<WirelessConfig | null>(null);
export const wirelessError = writable<string | null>(null);
export const wirelessLoading = writable(false);
export const activeProviderName = writable<string>('openwrt');
export const activeProviderLabel = derived(activeProviderName, ($name) => {
	const list = getProviderList();
	return list.find((p) => p.name === $name)?.label ?? $name;
});
export const activeCapabilities = writable<WirelessCapabilities>({
	multiNode: false,
	clientBinding: false,
	nativeConfig: true
});

// Derived: nodes
export const wirelessNodes = derived(wirelessTopology, ($t) => $t?.nodes ?? []);

// Derived: clients
export const wirelessClients = derived(wirelessTopology, ($t) => $t?.clients ?? []);

// Derived: SSID
export const wirelessSsid = derived(wirelessTopology, ($t) => $t?.ssid ?? '');

// Derived: client MAC → wireless client lookup (for enriching DHCP data in clients page)
export const wirelessClientMap = derived(wirelessTopology, ($t) => {
	const map = new Map<string, WirelessClient>();
	for (const client of $t?.clients ?? []) {
		map.set(client.mac.toLowerCase(), client);
	}
	return map;
});

// Derived: node lookup
export const wirelessNodeMap = derived(wirelessTopology, ($t) => {
	const map = new Map<string, WirelessNode>();
	for (const node of $t?.nodes ?? []) {
		map.set(node.id, node);
	}
	return map;
});

// Derived: wireless client count
export const wirelessClientCount = derived(wirelessClients, ($clients) =>
	$clients.filter((c) => c.isWireless && c.isOnline).length
);

// Derived: wired client count
export const wiredClientCount = derived(wirelessClients, ($clients) =>
	$clients.filter((c) => !c.isWireless && c.isOnline).length
);

// Derived: online client count
export const onlineClientCount = derived(wirelessClients, ($clients) =>
	$clients.filter((c) => c.isOnline).length
);

function setActiveProvider(name: string): void {
	activeProvider = getProvider(name);
	activeProviderName.set(activeProvider.name);
	activeCapabilities.set(activeProvider.capabilities);
}

export async function initWirelessProvider(): Promise<void> {
	try {
		// Read provider from UCI config
		const result = await call<{ provider?: string }>('laubter-mesh', 'get_config', {});
		const providerName = result.provider || 'openwrt';
		setActiveProvider(providerName);
	} catch {
		// If laubter-mesh not configured, default to openwrt
		setActiveProvider('openwrt');
	}
}

export async function switchProvider(name: string): Promise<void> {
	setActiveProvider(name);
	// Persist to UCI
	try {
		await call('laubter-mesh', 'configure', { provider: name });
	} catch {
		// May fail if laubter-mesh not available, that's ok
	}
	// Clear old data and refetch
	wirelessTopology.set(null);
	wirelessConfig.set(null);
	wirelessError.set(null);
	await Promise.all([fetchWirelessTopology(), fetchWirelessConfig()]);
}

export async function fetchWirelessTopology(): Promise<void> {
	try {
		wirelessLoading.set(true);
		wirelessError.set(null);
		const topology = await activeProvider.getTopology();

		// Prefer DHCP hostnames from OpenWrt over provider names
		const leases = get(dhcpLeaseList);
		if (leases.length > 0) {
			const dhcpNameMap = new Map<string, string>();
			for (const lease of leases) {
				if (lease.hostname) {
					dhcpNameMap.set(lease.mac.toLowerCase(), lease.hostname);
				}
			}
			for (const client of topology.clients) {
				const dhcpName = dhcpNameMap.get(client.mac.toLowerCase());
				if (dhcpName) {
					client.name = dhcpName;
				}
			}
		}

		wirelessTopology.set(topology);
	} catch (e) {
		wirelessError.set(e instanceof Error ? e.message : 'Failed to fetch wireless data');
	} finally {
		wirelessLoading.set(false);
	}
}

export async function fetchWirelessConfig(): Promise<void> {
	try {
		const config = await activeProvider.getConfig();
		wirelessConfig.set(config);
	} catch {
		// Config not available yet
	}
}

export async function testWirelessConnection(): Promise<{ status: string; message?: string }> {
	if (!activeProvider.testConnection) {
		return { status: 'error', message: 'Provider does not support connection testing' };
	}
	return await activeProvider.testConnection();
}

export async function configureWireless(config: Record<string, string>): Promise<void> {
	await activeProvider.configure(config);
	await fetchWirelessConfig();
}

export async function bindClient(clientMac: string, targetMac: string, band?: string): Promise<void> {
	if (!activeProvider.bindClient) {
		throw new Error('Provider does not support client binding');
	}
	await activeProvider.bindClient(clientMac, targetMac, band);
}

