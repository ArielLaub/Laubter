import { writable } from 'svelte/store';
import { call, declare } from '$api/ubus';
import type { WirelessStatus, HostapdClients } from '$api/types';

const callWirelessStatus = declare<WirelessStatus>({
	object: 'network.wireless',
	method: 'status'
});

export interface LeaseEntry {
	expire: number;
	mac: string;
	ip: string;
	hostname: string;
}

export const wirelessStatus = writable<WirelessStatus>({});
export const dhcpLeaseList = writable<LeaseEntry[]>([]);

// Aggregated client data from all hostapd interfaces
export const wifiClients = writable<
	Map<
		string,
		{
			mac: string;
			signal: number;
			rxBytes: number;
			txBytes: number;
			rxRate: number;
			txRate: number;
			wifiGeneration?: number;
			ifname: string;
			freq: number;
		}
	>
>(new Map());

export async function fetchWirelessStatus(): Promise<void> {
	const status = await callWirelessStatus();
	wirelessStatus.set(status);

	// Only try hostapd if there are active wireless interfaces
	const clientMap = new Map<string, {
		mac: string; signal: number; rxBytes: number; txBytes: number;
		rxRate: number; txRate: number; wifiGeneration?: number; ifname: string; freq: number;
	}>();

	for (const radio of Object.values(status)) {
		if (!radio.up) continue;
		for (const iface of radio.interfaces || []) {
			if (!iface.ifname) continue;
			try {
				const clients = await declare<HostapdClients>({
					object: `hostapd.${iface.ifname}`,
					method: 'get_clients',
					nobatch: true
				})();

				for (const [mac, data] of Object.entries(clients.clients || {})) {
					clientMap.set(mac.toLowerCase(), {
						mac: mac.toLowerCase(),
						signal: data.signal,
						rxBytes: data.bytes?.rx ?? 0,
						txBytes: data.bytes?.tx ?? 0,
						rxRate: data.rate?.rx ?? 0,
						txRate: data.rate?.tx ?? 0,
						wifiGeneration: data.wifi_generation,
						ifname: iface.ifname,
						freq: clients.freq
					});
				}
			} catch {
				// hostapd interface may not exist or be down — this is expected
			}
		}
	}

	wifiClients.set(clientMap);
}

export async function fetchDhcpLeases(): Promise<void> {
	try {
		// Read /tmp/dhcp.leases via file.read (dhcp.ipv4leases doesn't exist on all versions)
		const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
		const lines = (result.data || '').trim().split('\n').filter(Boolean);
		const leases: LeaseEntry[] = lines.map((line) => {
			const parts = line.split(/\s+/);
			return {
				expire: parseInt(parts[0]) || 0,
				mac: (parts[1] || '').toLowerCase(),
				ip: parts[2] || '',
				hostname: parts[3] === '*' ? '' : (parts[3] || '')
			};
		});
		dhcpLeaseList.set(leases);
	} catch {
		dhcpLeaseList.set([]);
	}
}
