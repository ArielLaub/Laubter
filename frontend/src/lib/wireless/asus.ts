/**
 * ASUS AiMesh provider -- transforms raw ASUS API data into generic WirelessTopology.
 * All data comes through the laubter-mesh rpcd proxy plugin.
 */

import { call } from '$api/ubus';
import type { WirelessNode, WirelessClient, WirelessRadio, WirelessTopology, WirelessBand, WirelessConfig, WirelessProvider } from './types';

// --- Raw ASUS API response types ---

interface AsusNodeRaw {
	alias: string;
	model_name: string;
	ui_model_name: string;
	fwver: string;
	ip: string;
	mac: string;
	online: string;
	ap2g: string;
	ap5g: string;
	ap5g1: string;
	ap6g: string;
	ap6g1: string;
	level: string;
	re_path: string;
	band_num: string;
	wired_mac: string[];
	wired_port: Record<string, unknown>;
	ap2g_ssid: string;
	ap5g_ssid: string;
	ap5g1_ssid: string;
	ap6g_ssid: string;
	[key: string]: unknown;
}

interface AsusClientRaw {
	mac: string;
	name: string;
	nickName: string;
	ip: string;
	vendor: string;
	isWL: string;
	isOnline: string;
	rssi: string;
	curTx: string;
	curRx: string;
	wlConnectTime: string;
	amesh_papMac: string;
	amesh_isReClient: string;
	ipMethod: string;
	amesh_bind_mac?: string;
	[key: string]: unknown;
}

interface AsusAllClientEntry {
	ip: string;
	rssi: string;
}

// --- Provider implementation ---

async function fetchNodes(): Promise<AsusNodeRaw[]> {
	try {
		const raw = await call<{ get_cfg_clientlist: AsusNodeRaw[] }>('laubter-mesh', 'get_nodes', {});
		return raw.get_cfg_clientlist || [];
	} catch {
		return [];
	}
}

async function fetchClients(): Promise<Record<string, AsusClientRaw>> {
	try {
		const raw = await call<{ get_clientlist: Record<string, AsusClientRaw> }>('laubter-mesh', 'get_clients', {});
		return raw.get_clientlist || {};
	} catch {
		return {};
	}
}

async function fetchTopologyRaw(): Promise<Record<string, Record<string, Record<string, AsusAllClientEntry>>>> {
	try {
		const raw = await call<{ get_allclientlist: Record<string, Record<string, Record<string, AsusAllClientEntry>>> }>(
			'laubter-mesh', 'get_topology', {}
		);
		return raw.get_allclientlist || {};
	} catch {
		return {};
	}
}

async function fetchInfo(): Promise<Record<string, string>> {
	try {
		return await call<Record<string, string>>('laubter-mesh', 'get_info', {});
	} catch {
		return {};
	}
}

function bandFromKey(key: string): WirelessBand {
	switch (key) {
		case '2G': return '2G';
		case '5G': return '5G';
		case '5G1': return '5G1';
		case '6G': return '6G';
		case '6G1': return '6G1';
		default: return '2G';
	}
}

function resolveName(client: AsusClientRaw): string {
	return client.nickName || client.name || client.vendor || client.mac;
}

function buildClientNodeMap(
	allClients: Record<string, Record<string, Record<string, AsusAllClientEntry>>>
): Map<string, { nodeMac: string; band: WirelessBand; rssi: number }> {
	const map = new Map<string, { nodeMac: string; band: WirelessBand; rssi: number }>();

	for (const [nodeMac, bands] of Object.entries(allClients)) {
		for (const [bandKey, clients] of Object.entries(bands)) {
			if (bandKey === 'wired_mac') {
				for (const [clientMac] of Object.entries(clients)) {
					map.set(clientMac.toLowerCase(), { nodeMac, band: '2G', rssi: 0 });
				}
				continue;
			}
			const band = bandFromKey(bandKey);
			for (const [clientMac, data] of Object.entries(clients)) {
				map.set(clientMac.toLowerCase(), {
					nodeMac,
					band,
					rssi: parseInt(data.rssi) || 0
				});
			}
		}
	}

	return map;
}

export const asusProvider: WirelessProvider = {
	name: 'asus',
	label: 'ASUS AiMesh',
	capabilities: {
		multiNode: true,
		clientBinding: true,
		nativeConfig: false
	},

	async getTopology(): Promise<WirelessTopology> {
		const [nodesRaw, clientsRaw, topologyRaw, info] = await Promise.all([
			fetchNodes(),
			fetchClients(),
			fetchTopologyRaw(),
			fetchInfo()
		]);

		const clientNodeMap = buildClientNodeMap(topologyRaw);

		const nodeAliasMap = new Map<string, string>();
		for (const node of nodesRaw) {
			nodeAliasMap.set(node.mac.toLowerCase(), node.alias || node.ui_model_name || node.model_name);
		}

		const nodes: WirelessNode[] = nodesRaw.map((raw) => {
			const radios: WirelessRadio[] = [];
			const mac = raw.mac.toLowerCase();
			const nodeTopology = topologyRaw[raw.mac] || {};

			const addRadio = (band: WirelessBand, radioMac: string, ssid: string) => {
				if (!radioMac) return;
				const bandClients = nodeTopology[band] || {};
				radios.push({
					band,
					mac: radioMac.toLowerCase(),
					ssid: ssid || info.wl0_ssid || '',
					clientCount: Object.keys(bandClients).length,
					clients: Object.keys(bandClients).map((m) => m.toLowerCase())
				});
			};

			addRadio('2G', raw.ap2g, raw.ap2g_ssid);
			addRadio('5G', raw.ap5g, raw.ap5g_ssid);
			if (raw.ap5g1) addRadio('5G1', raw.ap5g1, raw.ap5g1_ssid);
			if (raw.ap6g) addRadio('6G', raw.ap6g, raw.ap6g_ssid);

			return {
				id: mac,
				alias: raw.alias || raw.ui_model_name,
				model: raw.ui_model_name || raw.model_name,
				modelId: raw.model_name,
				firmware: raw.fwver,
				ip: raw.ip,
				mac,
				online: raw.online === '1',
				isMainNode: parseInt(raw.level) === 0 && raw.re_path === '0',
				radios,
				backhaulType: raw.re_path === '2' ? 'wireless' as const : 'wired' as const,
				linkRate: (() => {
					const wp = raw.wired_port as Record<string, unknown> | undefined;
					if (!wp?.wan_port) return undefined;
					const wanPort = wp.wan_port as Record<string, { link_rate?: string }>;
					const first = Object.values(wanPort)[0];
					return first?.link_rate;
				})(),
				level: parseInt(raw.level) || 0,
				wiredMacs: (raw.wired_mac || []).map((m: string) => m.toLowerCase())
			};
		});

		const clients: WirelessClient[] = [];
		for (const [mac, raw] of Object.entries(clientsRaw)) {
			if (typeof raw !== 'object' || !raw.mac) continue;

			const isNode = nodesRaw.some(
				(n) =>
					n.mac.toLowerCase() === mac.toLowerCase() ||
					(n.wired_mac || []).some((wm: string) => wm.toLowerCase() === mac.toLowerCase())
			);
			if (isNode) continue;

			const clientMac = mac.toLowerCase();
			const nodeInfo = clientNodeMap.get(clientMac);
			const parentMac = (raw.amesh_papMac || nodeInfo?.nodeMac || '').toLowerCase();
			const parentName = nodeAliasMap.get(parentMac) || parentMac;

			const isWireless = raw.isWL !== '0' && raw.isWL !== '';
			const asusBand = raw.isWL === '1' ? '2G' : raw.isWL === '2' ? '5G' : raw.isWL === '3' ? '5G1' : raw.isWL === '4' ? '6G' : undefined;

			clients.push({
				mac: clientMac,
				name: resolveName(raw),
				ip: raw.ip || '',
				vendor: raw.vendor || '',
				isWireless,
				isOnline: raw.isOnline === '1',
				band: isWireless ? (nodeInfo?.band ?? asusBand) : undefined,
				signal: isWireless ? (parseInt(raw.rssi) || nodeInfo?.rssi || undefined) : undefined,
				txRate: parseInt(raw.curTx) || undefined,
				rxRate: parseInt(raw.curRx) || undefined,
				connectTime: raw.wlConnectTime || undefined,
				connectedTo: parentMac,
				connectedToName: parentName,
				ipMethod: raw.ipMethod || undefined,
				isMeshReClient: raw.amesh_isReClient === '1',
				boundToMac: raw.amesh_bind_mac || undefined,
				boundToName: raw.amesh_bind_mac ? (nodeAliasMap.get(raw.amesh_bind_mac.toLowerCase()) || raw.amesh_bind_mac) : undefined
			});
		}

		return {
			nodes,
			clients,
			ssid: info.wl0_ssid || '',
			provider: 'asus'
		};
	},

	async getConfig(): Promise<WirelessConfig> {
		const raw = await call<{
			provider: string; host: string; port: string; proto: string;
			username: string; has_password: boolean;
		}>('laubter-mesh', 'get_config', {});
		return {
			provider: raw.provider || 'asus',
			host: raw.host || '',
			port: raw.port || '8443',
			proto: raw.proto || 'https',
			username: raw.username || 'admin',
			hasPassword: !!raw.has_password
		};
	},

	async testConnection() {
		return await call<{ status: string; message?: string }>('laubter-mesh', 'test_connection', {});
	},

	async configure(config) {
		await call('laubter-mesh', 'configure', config);
	},

	async bindClient(clientMac: string, targetMac: string, band = '0') {
		await call('laubter-mesh', 'bind_client', {
			client_mac: clientMac.toUpperCase(),
			target_mac: targetMac || '',
			band
		});
	}
};
