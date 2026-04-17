import { writable, derived } from 'svelte/store';
import { declare } from '$api/ubus';
import type { NetworkInterfaceDump, NetworkInterface, NetworkDeviceStatus } from '$api/types';

const callInterfaceDump = declare<NetworkInterfaceDump>({
	object: 'network.interface',
	method: 'dump'
});

export const interfaces = writable<NetworkInterface[]>([]);
export const deviceStats = writable<Map<string, NetworkDeviceStatus>>(new Map());

// Derived stores for common lookups
export const wanInterface = derived(interfaces, ($ifaces) =>
	$ifaces.find(
		(i) =>
			i.interface === 'wan' ||
			i.route?.some((r) => r.target === '0.0.0.0' && r.mask === 0)
	)
);

export const lanInterface = derived(interfaces, ($ifaces) =>
	$ifaces.find((i) => i.interface === 'lan')
);

export async function fetchInterfaces(): Promise<void> {
	const dump = await callInterfaceDump();
	interfaces.set(dump.interface || []);
}

export async function fetchDeviceStats(devices: string[]): Promise<void> {
	const results = await Promise.all(
		devices.map((name) =>
			declare<NetworkDeviceStatus>({
				object: 'network.device',
				method: 'status',
				params: ['name']
			})(name).then((status) => [name, status] as const)
		)
	);
	deviceStats.set(new Map(results));
}
