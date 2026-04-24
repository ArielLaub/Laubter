/**
 * asus-aimesh — Type definitions for ASUS AiMesh router API.
 *
 * These types represent the raw data returned by the ASUS router's
 * app API (appGet.cgi) and the processed/normalized structures.
 */

// ============================================================
// Raw ASUS API response types (as returned by the router)
// ============================================================

/** A mesh node from get_cfg_clientlist() */
export interface AsusNodeRaw {
  alias: string;
  model_name: string;
  ui_model_name: string;
  icon_model_name: string;
  product_id: string;
  fwver: string;
  newfwver: string;
  ip: string;
  mac: string;
  online: string;
  /** Radio BSSIDs */
  ap2g: string;
  ap5g: string;
  ap5g1: string;
  ap6g: string;
  ap6g1: string;
  apdwb: string;
  /** Parent AP BSSIDs (backhaul) */
  pap2g: string;
  pap5g: string;
  pap6g: string;
  /** Backhaul RSSI */
  rssi2g: string;
  rssi5g: string;
  rssi6g: string;
  /** Backhaul SSIDs */
  pap2g_ssid: string;
  pap5g_ssid: string;
  pap6g_ssid: string;
  /** Station interfaces */
  sta2g: string;
  sta5g: string;
  sta6g: string;
  /** SSIDs */
  ap2g_ssid: string;
  ap5g_ssid: string;
  ap5g1_ssid: string;
  ap6g_ssid: string;
  /** Topology level and backhaul path type */
  level: string;
  re_path: string;
  band_num: string;
  tcode: string;
  /** Wired MACs and port info */
  wired_mac: string[];
  wired_port: Record<string, unknown>;
  /** Node configuration */
  config: AsusNodeConfig;
  capability: Record<string, unknown>;
  misc_info: Record<string, string>;
  [key: string]: unknown;
}

export interface AsusNodeConfig {
  wireless?: Record<string, string>;
  misc?: { cfg_alias?: string };
  backhalctrl?: { amas_ethernet?: string };
  ctrl_led?: { led_val?: string };
  prefer_ap?: Record<string, string>;
}

/** A client from get_clientlist() */
export interface AsusClientRaw {
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

/** Per-client entry in get_allclientlist() topology data */
export interface AsusTopoClientEntry {
  ip: string;
  rssi: string;
}

/** Full topology: node_mac → band → client_mac → entry */
export type AsusTopologyData = Record<string, Record<string, Record<string, AsusTopoClientEntry>>>;

// ============================================================
// Processed / normalized types
// ============================================================

export type BackhaulType = 'wired' | 'wireless' | 'unknown';
export type ConnectionQuality = 'good' | 'ok' | 'weak' | 'poor';
export type WirelessBand = '2G' | '5G' | '5G1' | '6G' | '6G1';

export interface MeshNode {
  mac: string;
  alias: string;
  model: string;
  modelId: string;
  productId: string;
  firmware: string;
  newFirmware?: string;
  ip: string;
  online: boolean;
  isMainNode: boolean;
  radios: MeshRadio[];
  backhaulType: BackhaulType;
  backhaulBand?: WirelessBand;
  backhaulRssi?: number;
  backhaulSsid?: string;
  linkRate?: string;
  connectionQuality?: ConnectionQuality;
  parentMac?: string;
  parentName?: string;
  children: string[];
  level: number;
  bandCount: number;
  wiredMacs: string[];
  config: NodeConfig;
}

export interface MeshRadio {
  band: WirelessBand;
  mac: string;
  ssid: string;
  clientCount: number;
  clients: string[];
}

export interface NodeConfig {
  ledEnabled: boolean;
  backhaulPriority: 'auto' | 'ethernet' | 'wireless';
  preferredUplink: string;
  radioEnabled: Record<string, boolean>;
}

export interface MeshClient {
  mac: string;
  name: string;
  ip: string;
  vendor: string;
  isWireless: boolean;
  isOnline: boolean;
  band?: WirelessBand;
  signal?: number;
  txRate?: number;
  rxRate?: number;
  connectTime?: string;
  connectedTo: string;
  connectedToName: string;
  boundToMac?: string;
  boundToName?: string;
}

export interface MeshTopology {
  nodes: MeshNode[];
  clients: MeshClient[];
  ssid: string;
}

export interface AsusConnectionConfig {
  host: string;
  port: number;
  proto: 'https' | 'http';
  username: string;
  password: string;
}
