/**
 * OpenWrt native WiFi provider -- uses hostapd + iwinfo for wireless data.
 * No external mesh system required; works with the router's built-in radios.
 */

import { call, declare } from '$api/ubus';
import type { WirelessStatus, HostapdClients } from '$api/types';
import type {
	WirelessNode, WirelessClient, WirelessRadio, WirelessTopology,
	WirelessBand, WirelessConfig, WirelessProvider, RadioConfig, InterfaceConfig
} from './types';

function bandFromConfig(band?: string, freq?: number): WirelessBand {
	if (band === '2g') return '2G';
	if (band === '5g') return '5G';
	if (band === '6g') return '6G';
	// Fallback: derive from frequency
	if (freq) {
		if (freq < 3000) return '2G';
		if (freq < 6000) return '5G';
		return '6G';
	}
	return '2G';
}

function bandLabel(band: WirelessBand): string {
	switch (band) {
		case '2G': return '2.4 GHz';
		case '5G': return '5 GHz';
		case '5G1': return '5 GHz-2';
		case '6G': return '6 GHz';
		case '6G1': return '6 GHz-2';
	}
}

function wifiGenToName(gen?: number): string {
	if (!gen) return '';
	if (gen >= 7) return 'WiFi 7';
	if (gen >= 6) return 'WiFi 6';
	if (gen >= 5) return 'WiFi 5';
	if (gen >= 4) return 'WiFi 4';
	return '';
}

const callWirelessStatus = declare<WirelessStatus>({
	object: 'network.wireless',
	method: 'status'
});

interface LeaseEntry {
	expire: number;
	mac: string;
	ip: string;
	hostname: string;
}

async function fetchDhcpLeases(): Promise<LeaseEntry[]> {
	try {
		const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
		const lines = (result.data || '').trim().split('\n').filter(Boolean);
		return lines.map((line) => {
			const parts = line.split(/\s+/);
			return {
				expire: parseInt(parts[0]) || 0,
				mac: (parts[1] || '').toLowerCase(),
				ip: parts[2] || '',
				hostname: parts[3] === '*' ? '' : (parts[3] || '')
			};
		});
	} catch {
		return [];
	}
}

async function fetchHostapdClients(ifname: string): Promise<HostapdClients | null> {
	try {
		return await declare<HostapdClients>({
			object: `hostapd.${ifname}`,
			method: 'get_clients',
			nobatch: true
		})();
	} catch {
		return null;
	}
}

export const openwrtProvider: WirelessProvider = {
	name: 'openwrt',
	label: 'OpenWrt WiFi',
	capabilities: {
		multiNode: false,
		clientBinding: false,
		nativeConfig: true
	},

	async getTopology(): Promise<WirelessTopology> {
		const [status, leases] = await Promise.all([
			callWirelessStatus(),
			fetchDhcpLeases()
		]);

		// Build lease lookup
		const leaseByMac = new Map<string, LeaseEntry>();
		for (const lease of leases) {
			leaseByMac.set(lease.mac, lease);
		}

		const nodes: WirelessNode[] = [];
		const allClients: WirelessClient[] = [];
		const wirelessMacs = new Set<string>();
		let primarySsid = '';

		for (const [radioName, radio] of Object.entries(status)) {
			if (!radio.up) continue;

			const band = bandFromConfig(radio.config.band);
			const radios: WirelessRadio[] = [];
			let radioClientCount = 0;
			const radioClientMacs: string[] = [];

			for (const iface of radio.interfaces || []) {
				if (!iface.ifname) continue;
				if (!primarySsid && iface.config.ssid) primarySsid = iface.config.ssid;

				const hostapd = await fetchHostapdClients(iface.ifname);
				if (!hostapd) continue;

				const ifaceClients: string[] = [];

				for (const [mac, data] of Object.entries(hostapd.clients || {})) {
					const clientMac = mac.toLowerCase();
					wirelessMacs.add(clientMac);
					ifaceClients.push(clientMac);
					radioClientMacs.push(clientMac);
					radioClientCount++;

					const lease = leaseByMac.get(clientMac);

					allClients.push({
						mac: clientMac,
						name: lease?.hostname || clientMac,
						ip: lease?.ip || '',
						vendor: '',
						isWireless: true,
						isOnline: true,
						band,
						signal: data.signal || undefined,
						txRate: data.rate?.tx ? Math.round(data.rate.tx / 1000) : undefined,
						rxRate: data.rate?.rx ? Math.round(data.rate.rx / 1000) : undefined,
						connectedTo: radioName,
						connectedToName: `${bandLabel(band)} Radio`,
						wifiGeneration: data.wifi_generation
					});
				}

				radios.push({
					band,
					mac: '',
					ssid: iface.config.ssid || '',
					channel: typeof radio.config.channel === 'number' ? radio.config.channel : undefined,
					htmode: radio.config.htmode,
					clientCount: ifaceClients.length,
					clients: ifaceClients
				});
			}

			// Each radio becomes a "node"
			nodes.push({
				id: radioName,
				alias: `${bandLabel(band)} Radio`,
				model: radioName,
				modelId: radioName,
				firmware: '',
				ip: '',
				mac: '',
				online: true,
				isMainNode: nodes.length === 0,
				radios,
				backhaulType: 'wired',
				level: 0,
				wiredMacs: []
			});
		}

		// Add wired clients (DHCP leases not seen in hostapd)
		for (const lease of leases) {
			if (!wirelessMacs.has(lease.mac)) {
				allClients.push({
					mac: lease.mac,
					name: lease.hostname || lease.mac,
					ip: lease.ip,
					vendor: '',
					isWireless: false,
					isOnline: true,
					connectedTo: '',
					connectedToName: 'Wired'
				});
			}
		}

		return {
			nodes,
			clients: allClients,
			ssid: primarySsid,
			provider: 'openwrt'
		};
	},

	async getConfig(): Promise<WirelessConfig> {
		const status = await callWirelessStatus();
		const radios: RadioConfig[] = [];

		for (const [radioName, radio] of Object.entries(status)) {
			const interfaces: InterfaceConfig[] = (radio.interfaces || []).map((iface) => ({
				section: iface.section,
				ssid: iface.config.ssid || '',
				encryption: iface.config.encryption || 'none',
				network: iface.config.network || [],
				disabled: false
			}));

			radios.push({
				name: radioName,
				band: radio.config.band || '',
				channel: radio.config.channel ?? 'auto',
				htmode: radio.config.htmode || '',
				disabled: radio.disabled,
				interfaces
			});
		}

		return {
			provider: 'openwrt',
			radios
		};
	},

	async configure(config: Record<string, string>) {
		await call('laubter-wireless', 'set_config', config);
	}
};
