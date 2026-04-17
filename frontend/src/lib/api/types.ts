/** TypeScript types for OpenWrt ubus responses */

// --- system ---

export interface SystemBoard {
	kernel: string;
	hostname: string;
	system: string;
	model: string;
	board_name: string;
	rootfs_type: string;
	release: {
		distribution: string;
		version: string;
		revision: string;
		target: string;
		description: string;
		builddate?: string;
		firmware_url?: string;
	};
}

export interface SystemInfo {
	localtime: number;
	uptime: number;
	load: [number, number, number]; // fixed-point, divide by 65536
	memory: {
		total: number;
		free: number;
		shared: number;
		buffered: number;
		available?: number;
		cached: number;
	};
	root?: {
		total: number;
		free: number;
		used: number;
		avail: number;
	};
	swap: {
		total: number;
		free: number;
	};
}

// --- network ---

export interface NetworkInterfaceDump {
	interface: NetworkInterface[];
}

export interface NetworkInterface {
	interface: string;
	up: boolean;
	pending: boolean;
	available: boolean;
	autostart: boolean;
	dynamic: boolean;
	uptime: number;
	l3_device?: string;
	proto: string;
	device?: string;
	metric: number;
	dns_metric: number;
	delegation: boolean;
	'ipv4-address': Array<{ address: string; mask: number }>;
	'ipv6-address': Array<{ address: string; mask: number }>;
	'ipv6-prefix': Array<{ address: string; mask: number }>;
	'ipv6-prefix-assignment': Array<{ address: string; mask: number }>;
	route: Array<{
		target: string;
		mask: number;
		nexthop: string;
		source: string;
	}>;
	'dns-server': string[];
	'dns-search': string[];
	inactive?: Record<string, unknown>;
	data?: Record<string, unknown>;
}

export interface NetworkDeviceStatus {
	type: string;
	up: boolean;
	carrier: boolean;
	link?: boolean;
	speed?: string;
	mtu: number;
	mtu6?: number;
	macaddr: string;
	txqueuelen?: number;
	ipv6?: boolean;
	multicast?: boolean;
	statistics: {
		rx_bytes: number;
		rx_packets: number;
		rx_errors: number;
		rx_dropped: number;
		tx_bytes: number;
		tx_packets: number;
		tx_errors: number;
		tx_dropped: number;
		collisions?: number;
		multicast?: number;
	};
}

// --- wireless ---

export interface WirelessStatus {
	[radio: string]: {
		up: boolean;
		pending: boolean;
		autostart: boolean;
		disabled: boolean;
		config: {
			path?: string;
			hwmode?: string;
			htmode?: string;
			channel?: string | number;
			country?: string;
			band?: string;
		};
		interfaces: Array<{
			section: string;
			ifname: string;
			config: {
				mode: string;
				ssid: string;
				encryption: string;
				network: string[];
				ieee80211r?: boolean;
			};
		}>;
	};
}

export interface IwinfoInfo {
	phy: string;
	ssid: string;
	bssid: string;
	country: string;
	channel: number;
	frequency: number;
	frequency_offset: number;
	txpower: number;
	txpower_offset: number;
	quality: number;
	quality_max: number;
	signal: number;
	noise: number;
	bitrate: number;
	encryption: {
		enabled: boolean;
		wpa: number[];
		authentication: string[];
		ciphers: string[];
	};
	htmodes: string[];
	hwmodes: string[];
	hardware: { id: number[] };
}

export interface WifiClient {
	mac: string;
	signal: number;
	noise?: number;
	inactive?: number;
	rx: { rate: number; mcs?: number; '40mhz'?: boolean; short_gi?: boolean };
	tx: { rate: number; mcs?: number; '40mhz'?: boolean; short_gi?: boolean };
}

export interface HostapdClients {
	freq: number;
	clients: Record<
		string,
		{
			auth: boolean;
			assoc: boolean;
			authorized: boolean;
			ht: boolean;
			vht: boolean;
			he: boolean;
			wmm: boolean;
			aid: number;
			signal: number;
			bytes: { rx: number; tx: number };
			airtime?: { rx: number; tx: number };
			packets: { rx: number; tx: number };
			rate: { rx: number; tx: number };
			wifi_generation?: number;
		}
	>;
}

// --- DHCP ---

export interface DhcpLease {
	expire: number;
	hostname: string;
	ipaddr: string;
	macaddr: string;
}

export interface DhcpLeases {
	device: Record<string, { leases: DhcpLease[] }>;
}

// --- UCI ---

export interface UciSection {
	'.anonymous': boolean;
	'.type': string;
	'.name': string;
	'.index'?: number;
	[key: string]: unknown;
}

export interface UciGetResult {
	values?: Record<string, unknown> | UciSection;
}

export interface UciChanges {
	[config: string]: Array<[string, string, string?, unknown?]>;
}
