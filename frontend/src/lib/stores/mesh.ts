/**
 * Mesh store — provides reactive mesh topology data from the active mesh provider.
 * Updates existing client data with wireless/wired status from the mesh system.
 */

import { writable, derived, get } from 'svelte/store';
import type { MeshTopology, MeshNode, MeshClient, MeshConfig } from '$lib/mesh/types';
import { asusProvider } from '$lib/mesh/asus';
import { dhcpLeaseList } from '$stores/wireless';

const provider = asusProvider;

export const meshTopology = writable<MeshTopology | null>(null);
export const meshConfig = writable<MeshConfig | null>(null);
export const meshError = writable<string | null>(null);
export const meshLoading = writable(false);

// Derived: mesh nodes
export const meshNodes = derived(meshTopology, ($t) => $t?.nodes ?? []);

// Derived: mesh clients
export const meshClients = derived(meshTopology, ($t) => $t?.clients ?? []);

// Derived: SSID
export const meshSsid = derived(meshTopology, ($t) => $t?.ssid ?? '');

// Derived: client MAC → mesh client lookup (for enriching DHCP data)
export const meshClientMap = derived(meshTopology, ($t) => {
	const map = new Map<string, MeshClient>();
	for (const client of $t?.clients ?? []) {
		map.set(client.mac.toLowerCase(), client);
	}
	return map;
});

// Derived: node MAC → node lookup
export const meshNodeMap = derived(meshTopology, ($t) => {
	const map = new Map<string, MeshNode>();
	for (const node of $t?.nodes ?? []) {
		map.set(node.mac.toLowerCase(), node);
	}
	return map;
});

// Derived: wireless client count
export const wirelessClientCount = derived(meshClients, ($clients) =>
	$clients.filter((c) => c.isWireless && c.isOnline).length
);

// Derived: wired client count
export const wiredClientCount = derived(meshClients, ($clients) =>
	$clients.filter((c) => !c.isWireless && c.isOnline).length
);

// Derived: online client count
export const onlineClientCount = derived(meshClients, ($clients) =>
	$clients.filter((c) => c.isOnline).length
);

export async function fetchMeshTopology(): Promise<void> {
	try {
		meshLoading.set(true);
		meshError.set(null);
		const topology = await provider.getTopology();

		// Prefer DHCP hostnames from OpenWrt over ASUS names
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

		meshTopology.set(topology);
	} catch (e) {
		meshError.set(e instanceof Error ? e.message : 'Failed to fetch mesh data');
	} finally {
		meshLoading.set(false);
	}
}

export async function fetchMeshConfig(): Promise<void> {
	try {
		const config = await provider.getConfig();
		meshConfig.set(config);
	} catch {
		// Config not available yet
	}
}

export async function testMeshConnection(): Promise<{ status: string; message?: string }> {
	return await provider.testConnection();
}

export async function configureMesh(config: Record<string, string>): Promise<void> {
	await provider.configure(config);
	await fetchMeshConfig();
}
