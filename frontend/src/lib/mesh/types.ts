/**
 * Generic Mesh WiFi provider types.
 * Designed to support ASUS AiMesh, and in the future OpenWrt native WiFi (802.11r/k/v).
 */

export interface MeshNode {
	id: string;              // MAC address (unique identifier)
	alias: string;           // User-friendly name ("Office", "Clinic")
	model: string;           // Model name ("ZenWiFi AX")
	modelId: string;         // Internal model ID ("ZenWiFi_XT8")
	firmware: string;        // Firmware version
	ip: string;              // IP address
	mac: string;             // Primary MAC
	online: boolean;
	isMainNode: boolean;     // true for the primary/root AP
	radios: MeshRadio[];
	backhaulType: 'wired' | 'wireless' | 'unknown';
	backhaulRssi?: number;   // backhaul signal strength (for wireless backhaul)
	linkRate?: string;       // Link speed: 'Q'=2.5G, 'G'=1G, 'M'=100M, ''=unknown
	level: number;           // hop count from main node (0 = main)
	wiredMacs: string[];     // MACs of wired ports on this node
}

export interface MeshRadio {
	band: MeshBand;
	mac: string;             // radio BSSID
	ssid: string;
	clientCount: number;
	clients: string[];       // client MACs connected to this radio
}

export type MeshBand = '2G' | '5G' | '5G1' | '6G' | '6G1';

export interface MeshClient {
	mac: string;
	name: string;            // Best resolved name (nickName > name > hostname > vendor > mac)
	ip: string;
	vendor: string;
	isWireless: boolean;
	isOnline: boolean;
	band?: MeshBand;
	signal?: number;         // RSSI dBm
	txRate?: number;         // Mbps
	rxRate?: number;         // Mbps
	connectTime?: string;    // "02:21:07" format
	connectedTo: string;     // node MAC
	connectedToName: string; // node alias
	ipMethod?: string;       // "DHCP" / "Static"
	// Mesh-specific
	isMeshReClient?: boolean; // connected through mesh (not directly to main)
	boundToMac?: string;      // if bound to a specific node, that node's MAC
	boundToName?: string;     // bound node's alias
}

export interface MeshTopology {
	nodes: MeshNode[];
	clients: MeshClient[];
	ssid: string;
	provider: string;        // "asus", "openwrt", etc.
}

export interface MeshConfig {
	provider: string;
	host: string;
	port: string;
	proto: string;
	username: string;
	hasPassword: boolean;
}

/**
 * Generic mesh provider interface.
 * Implementations: ASUS (rpcd proxy), OpenWrt native (future).
 */
export interface MeshProvider {
	name: string;
	getTopology(): Promise<MeshTopology>;
	getConfig(): Promise<MeshConfig>;
	testConnection(): Promise<{ status: string; message?: string }>;
	configure(config: Partial<MeshConfig> & { password?: string }): Promise<void>;
}
