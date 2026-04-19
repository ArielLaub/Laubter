/**
 * Generic wireless provider types.
 * Supports ASUS AiMesh, OpenWrt native WiFi, and future providers (TP-Link Deco, etc.).
 */

export interface WirelessNode {
	id: string;              // MAC address or radio name (unique identifier)
	alias: string;           // User-friendly name ("Office", "5 GHz Radio")
	model: string;           // Model name ("ZenWiFi AX", "MediaTek MT7915")
	modelId: string;         // Internal model ID
	firmware: string;        // Firmware version
	ip: string;              // IP address
	mac: string;             // Primary MAC
	online: boolean;
	isMainNode: boolean;     // true for the primary/root AP
	radios: WirelessRadio[];
	backhaulType: 'wired' | 'wireless' | 'unknown';
	backhaulRssi?: number;
	linkRate?: string;       // Link speed: 'Q'=2.5G, 'G'=1G, 'M'=100M
	level: number;           // hop count from main node (0 = main)
	wiredMacs: string[];     // MACs of wired ports on this node
}

export interface WirelessRadio {
	band: WirelessBand;
	mac: string;             // radio BSSID
	ssid: string;
	channel?: number;
	htmode?: string;
	clientCount: number;
	clients: string[];       // client MACs connected to this radio
}

export type WirelessBand = '2G' | '5G' | '5G1' | '6G' | '6G1';

export interface WirelessClient {
	mac: string;
	name: string;
	ip: string;
	vendor: string;
	isWireless: boolean;
	isOnline: boolean;
	band?: WirelessBand;
	signal?: number;         // RSSI dBm
	txRate?: number;         // Mbps
	rxRate?: number;         // Mbps
	connectTime?: string;    // "02:21:07" format
	connectedTo: string;     // node MAC or radio name
	connectedToName: string; // node alias
	ipMethod?: string;       // "DHCP" / "Static"
	wifiGeneration?: number; // 4=WiFi 4, 5=WiFi 5, 6=WiFi 6, 7=WiFi 7
	// Mesh-specific (optional)
	isMeshReClient?: boolean;
	boundToMac?: string;
	boundToName?: string;
}

export interface WirelessTopology {
	nodes: WirelessNode[];
	clients: WirelessClient[];
	ssid: string;
	provider: string;        // "asus", "openwrt", etc.
}

export interface WirelessConfig {
	provider: string;
	// ASUS-specific
	host?: string;
	port?: string;
	proto?: string;
	username?: string;
	hasPassword?: boolean;
	// OpenWrt-specific (radio config)
	radios?: RadioConfig[];
}

export interface RadioConfig {
	name: string;            // "radio0", "radio1"
	band: string;            // "2g", "5g", "6g"
	channel: string | number;
	htmode: string;
	disabled: boolean;
	interfaces: InterfaceConfig[];
}

export interface InterfaceConfig {
	section: string;         // UCI section name
	ssid: string;
	encryption: string;
	network: string[];
	disabled: boolean;
}

export interface WirelessCapabilities {
	multiNode: boolean;      // mesh systems with multiple APs
	clientBinding: boolean;  // can pin client to node
	nativeConfig: boolean;   // can configure SSID/channel/etc directly
}

export interface WirelessProvider {
	name: string;
	label: string;
	capabilities: WirelessCapabilities;
	getTopology(): Promise<WirelessTopology>;
	getConfig(): Promise<WirelessConfig>;
	testConnection?(): Promise<{ status: string; message?: string }>;
	configure(config: Record<string, string>): Promise<void>;
	bindClient?(clientMac: string, targetMac: string, band?: string): Promise<void>;
}
