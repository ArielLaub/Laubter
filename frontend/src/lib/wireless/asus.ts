/**
 * ASUS AiMesh provider -- transforms raw ASUS API data into generic WirelessTopology.
 * All data comes through the laubter-mesh rpcd proxy plugin.
 */

import { call } from '$api/ubus';
import type { WirelessNode, WirelessClient, WirelessRadio, WirelessTopology, WirelessBand, WirelessConfig, WirelessProvider, NodeConfig } from './types';

// --- Raw ASUS API response types ---

interface AsusNodeRaw {
	alias: string;
	model_name: string;
	ui_model_name: string;
	fwver: string;
	newfwver: string;
	ip: string;
	mac: string;
	online: string;
	ap2g: string;
	ap5g: string;
	ap5g1: string;
	ap6g: string;
	ap6g1: string;
	apdwb: string;
	pap2g: string;
	pap5g: string;
	pap6g: string;
	rssi2g: string;
	rssi5g: string;
	rssi6g: string;
	pap2g_ssid: string;
	pap5g_ssid: string;
	pap6g_ssid: string;
	sta2g: string;
	sta5g: string;
	sta6g: string;
	level: string;
	re_path: string;
	band_num: string;
	product_id: string;
	wired_mac: string[];
	wired_port: Record<string, unknown>;
	ap2g_ssid: string;
	ap5g_ssid: string;
	ap5g1_ssid: string;
	ap6g_ssid: string;
	config: {
		wireless?: Record<string, string>;
		backhalctrl?: { amas_ethernet?: string };
		ctrl_led?: { led_val?: string };
		prefer_ap?: Record<string, string>;
	};
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

// --- Helper functions ---

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

/** Map re_path to backhaul band: 2=2G, 4=5G, 8=5G1/DWB */
function backhaulBandFromRePath(rePath: string): WirelessBand | undefined {
	const p = parseInt(rePath);
	if (p === 2) return '2G';
	if (p === 4) return '5G';
	if (p === 8) return '5G1';
	return undefined;
}

/** Determine backhaul type from re_path: 0=main, 1=wired, 2/4/8=wireless */
function backhaulTypeFromRePath(rePath: string): 'wired' | 'wireless' | 'unknown' {
	const p = parseInt(rePath);
	if (p === 0) return 'unknown'; // main node, no backhaul
	if (p === 1) return 'wired';
	if (p > 1) return 'wireless';
	return 'wired'; // negative values (e.g., level=-1) default to wired
}

/** Derive connection quality from RSSI */
function connectionQualityFromRssi(rssi: number | undefined): 'good' | 'ok' | 'weak' | 'poor' | undefined {
	if (rssi == null || rssi === 0) return undefined;
	if (rssi >= -50) return 'good';
	if (rssi >= -65) return 'ok';
	if (rssi >= -75) return 'weak';
	return 'poor';
}

function resolveName(client: AsusClientRaw): string {
	return client.nickName || client.name || client.vendor || client.mac;
}

/**
 * Build a map from radio BSSID → node MAC.
 * This lets us resolve pap2g/pap5g/pap6g (which contain radio BSSIDs) to the owning node.
 */
function buildRadioToNodeMap(nodesRaw: AsusNodeRaw[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const node of nodesRaw) {
		const nodeMac = node.mac.toLowerCase();
		for (const radioMac of [node.ap2g, node.ap5g, node.ap5g1, node.ap6g, node.ap6g1, node.apdwb, node.sta2g, node.sta5g, node.sta6g]) {
			if (radioMac) {
				map.set(radioMac.toLowerCase(), nodeMac);
			}
		}
		// Also map the node MAC itself
		map.set(nodeMac, nodeMac);
	}
	return map;
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

/** Parse node config from raw ASUS config object */
function parseNodeConfig(raw: AsusNodeRaw): NodeConfig | undefined {
	const cfg = raw.config;
	if (!cfg || typeof cfg !== 'object') return undefined;

	const radioEnabled: Record<string, boolean> = {};
	if (cfg.wireless) {
		for (const [key, val] of Object.entries(cfg.wireless)) {
			radioEnabled[key] = val === '1';
		}
	}

	const backhaulMap: Record<string, string> = { '1': 'ethernet', '2': 'wireless', '3': 'auto' };

	return {
		ledEnabled: cfg.ctrl_led?.led_val === '1',
		backhaulPriority: backhaulMap[cfg.backhalctrl?.amas_ethernet ?? '3'] || 'auto',
		preferredUplink: cfg.prefer_ap?.amas_wlc_target_bssid || '',
		radioEnabled
	};
}

// --- Provider implementation ---

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
		const radioToNodeMap = buildRadioToNodeMap(nodesRaw);

		const nodeAliasMap = new Map<string, string>();
		for (const node of nodesRaw) {
			nodeAliasMap.set(node.mac.toLowerCase(), node.alias || node.ui_model_name || node.model_name);
		}

		// First pass: create all nodes
		const nodes: WirelessNode[] = nodesRaw.map((raw) => {
			const radios: WirelessRadio[] = [];
			const mac = raw.mac.toLowerCase();
			const nodeTopology = topologyRaw[raw.mac] || {};
			const rePath = parseInt(raw.re_path) || 0;
			const isMain = rePath === 0 && raw.online === '1' && !raw.pap2g && !raw.pap5g && !raw.pap6g;

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

			// Resolve parent node from pap* fields
			let parentMac: string | undefined;
			let backhaulRssi: number | undefined;
			let backhaulSsid: string | undefined;
			const bhType = backhaulTypeFromRePath(raw.re_path);

			if (bhType === 'wireless') {
				// Find which pap* field is populated and resolve it
				if (raw.pap5g) {
					parentMac = radioToNodeMap.get(raw.pap5g.toLowerCase());
					backhaulRssi = parseInt(raw.rssi5g) || undefined;
					backhaulSsid = raw.pap5g_ssid || undefined;
				} else if (raw.pap2g) {
					parentMac = radioToNodeMap.get(raw.pap2g.toLowerCase());
					backhaulRssi = parseInt(raw.rssi2g) || undefined;
					backhaulSsid = raw.pap2g_ssid || undefined;
				} else if (raw.pap6g) {
					parentMac = radioToNodeMap.get(raw.pap6g.toLowerCase());
					backhaulRssi = parseInt(raw.rssi6g) || undefined;
					backhaulSsid = raw.pap6g_ssid || undefined;
				}
			} else if (bhType === 'wired') {
				// Wired nodes: parent is the main node (or could be chained, but
				// ASUS doesn't expose wired parent info reliably in get_cfg_clientlist)
				// We'll set parentMac to main node later in the tree-building pass
			}

			return {
				id: mac,
				alias: raw.alias || raw.ui_model_name,
				model: raw.ui_model_name || raw.model_name,
				modelId: raw.model_name,
				firmware: raw.fwver,
				ip: raw.ip,
				mac,
				online: raw.online === '1',
				isMainNode: isMain,
				radios,
				backhaulType: bhType,
				backhaulBand: backhaulBandFromRePath(raw.re_path),
				backhaulRssi,
				backhaulSsid,
				linkRate: (() => {
					const wp = raw.wired_port as Record<string, unknown> | undefined;
					if (!wp?.wan_port) return undefined;
					const wanPort = wp.wan_port as Record<string, { link_rate?: string }>;
					const first = Object.values(wanPort)[0];
					return first?.link_rate;
				})(),
				level: 0, // computed below
				wiredMacs: (raw.wired_mac || []).map((m: string) => m.toLowerCase()),
				parentMac,
				parentName: parentMac ? nodeAliasMap.get(parentMac) : undefined,
				connectionQuality: bhType === 'wireless' ? connectionQualityFromRssi(backhaulRssi) : undefined,
				productId: raw.product_id || undefined,
				newFirmware: raw.newfwver || undefined,
				bandCount: parseInt(raw.band_num) || undefined,
				config: parseNodeConfig(raw),
				children: []
			};
		});

		// Second pass: build tree hierarchy
		const mainNode = nodes.find((n) => n.isMainNode);
		const mainMac = mainNode?.mac;
		const nodeMap = new Map<string, WirelessNode>();
		for (const node of nodes) nodeMap.set(node.mac, node);

		// Assign wired nodes to main if they don't have a parent
		for (const node of nodes) {
			if (node.isMainNode) continue;
			if (!node.parentMac && mainMac) {
				node.parentMac = mainMac;
				node.parentName = mainNode?.alias;
			}
		}

		// Build children lists and compute levels
		for (const node of nodes) {
			if (node.parentMac) {
				const parent = nodeMap.get(node.parentMac);
				if (parent && parent.children) {
					parent.children.push(node.mac);
				}
			}
		}

		// Compute levels via BFS from main node
		if (mainNode) {
			mainNode.level = 0;
			const queue = [mainNode.mac];
			const visited = new Set<string>([mainNode.mac]);
			while (queue.length > 0) {
				const currentMac = queue.shift()!;
				const current = nodeMap.get(currentMac)!;
				for (const childMac of current.children ?? []) {
					if (visited.has(childMac)) continue;
					visited.add(childMac);
					const child = nodeMap.get(childMac);
					if (child) {
						child.level = current.level + 1;
						queue.push(childMac);
					}
				}
			}
		}

		// Build clients
		// Also need to filter out node station interfaces from the client list
		const nodeStaMacs = new Set<string>();
		for (const raw of nodesRaw) {
			for (const staMac of [raw.sta2g, raw.sta5g, raw.sta6g, raw.mac]) {
				if (staMac) nodeStaMacs.add(staMac.toLowerCase());
			}
			for (const wm of raw.wired_mac || []) {
				nodeStaMacs.add(wm.toLowerCase());
			}
			// Also add all radio MACs
			for (const rm of [raw.ap2g, raw.ap5g, raw.ap5g1, raw.ap6g, raw.ap6g1, raw.apdwb]) {
				if (rm) nodeStaMacs.add(rm.toLowerCase());
			}
		}

		const clients: WirelessClient[] = [];
		const seenClientMacs = new Set<string>();

		for (const [mac, raw] of Object.entries(clientsRaw)) {
			if (typeof raw !== 'object' || !raw.mac) continue;

			const clientMac = mac.toLowerCase();
			if (nodeStaMacs.has(clientMac)) continue;

			seenClientMacs.add(clientMac);
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

		// Add clients that appear in topology (get_allclientlist) but not in get_clientlist
		for (const [clientMac, nodeInfo] of clientNodeMap.entries()) {
			if (seenClientMacs.has(clientMac)) continue;
			if (nodeStaMacs.has(clientMac)) continue;

			const parentName = nodeAliasMap.get(nodeInfo.nodeMac.toLowerCase()) || nodeInfo.nodeMac;
			const isWireless = nodeInfo.band !== undefined && nodeInfo.rssi !== 0;

			clients.push({
				mac: clientMac,
				name: clientMac,
				ip: '',
				vendor: '',
				isWireless,
				isOnline: true,
				band: isWireless ? nodeInfo.band : undefined,
				signal: isWireless && nodeInfo.rssi ? nodeInfo.rssi : undefined,
				connectedTo: nodeInfo.nodeMac.toLowerCase(),
				connectedToName: parentName
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
		return await call('laubter-mesh', 'bind_client', {
			client_mac: clientMac.toUpperCase(),
			target_mac: targetMac || '',
			band
		});
	}
};
