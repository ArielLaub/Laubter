/**
 * asus-aimesh — Topology processor
 *
 * Transforms raw ASUS API data into a normalized mesh topology
 * with proper tree hierarchy, backhaul detection, and client mapping.
 */

import type {
  AsusNodeRaw, AsusClientRaw, AsusTopologyData,
  MeshNode, MeshClient, MeshRadio, MeshTopology,
  BackhaulType, ConnectionQuality, WirelessBand, NodeConfig
} from './types.js';

/** Map re_path to backhaul type: 0=main, 1=wired, 2/4/8=wireless */
function backhaulTypeFromRePath(rePath: number): BackhaulType {
  if (rePath === 0) return 'unknown';
  if (rePath === 1) return 'wired';
  if (rePath > 1) return 'wireless';
  return 'wired';
}

/** Map re_path to backhaul band */
function backhaulBandFromRePath(rePath: number): WirelessBand | undefined {
  if (rePath === 2) return '2G';
  if (rePath === 4) return '5G';
  if (rePath === 8) return '5G1';
  return undefined;
}

/** Derive connection quality from RSSI */
function qualityFromRssi(rssi: number | undefined): ConnectionQuality | undefined {
  if (!rssi || rssi === 0) return undefined;
  if (rssi >= -50) return 'good';
  if (rssi >= -65) return 'ok';
  if (rssi >= -75) return 'weak';
  return 'poor';
}

/** Parse backhaul priority from ASUS config */
function parseBackhaulPriority(val?: string): 'auto' | 'ethernet' | 'wireless' {
  if (val === '1') return 'ethernet';
  if (val === '2') return 'wireless';
  return 'auto';
}

/**
 * Build a Map from radio BSSID → node MAC.
 * Used to resolve pap2g/pap5g/pap6g (which are radio BSSIDs) to the owning node.
 */
function buildRadioToNodeMap(nodes: AsusNodeRaw[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    const nodeMac = node.mac.toLowerCase();
    for (const radioMac of [node.ap2g, node.ap5g, node.ap5g1, node.ap6g, node.ap6g1, node.apdwb, node.sta2g, node.sta5g, node.sta6g, node.mac]) {
      if (radioMac) map.set(radioMac.toLowerCase(), nodeMac);
    }
  }
  return map;
}

/**
 * Build a Set of all MACs that belong to mesh nodes (to filter from client list).
 */
function buildNodeMacSet(nodes: AsusNodeRaw[]): Set<string> {
  const set = new Set<string>();
  for (const node of nodes) {
    for (const mac of [node.mac, node.ap2g, node.ap5g, node.ap5g1, node.ap6g, node.ap6g1, node.apdwb, node.sta2g, node.sta5g, node.sta6g, ...(node.wired_mac ?? [])]) {
      if (mac) set.add(mac.toLowerCase());
    }
  }
  return set;
}

/**
 * Process raw ASUS data into a normalized MeshTopology.
 *
 * @param nodesRaw - Raw nodes from get_cfg_clientlist()
 * @param clientsRaw - Raw clients from get_clientlist()
 * @param topoRaw - Raw topology from get_allclientlist()
 * @param info - Info from nvram_get
 */
export function processTopology(
  nodesRaw: AsusNodeRaw[],
  clientsRaw: Record<string, AsusClientRaw>,
  topoRaw: AsusTopologyData,
  info: Record<string, string> = {}
): MeshTopology {
  const radioToNode = buildRadioToNodeMap(nodesRaw);
  const nodeMacSet = buildNodeMacSet(nodesRaw);

  // Node alias lookup
  const nodeAliasMap = new Map<string, string>();
  for (const node of nodesRaw) {
    nodeAliasMap.set(node.mac.toLowerCase(), node.alias || node.ui_model_name || node.model_name);
  }

  // ---- Process nodes ----
  const nodes: MeshNode[] = nodesRaw.map(raw => {
    const mac = raw.mac.toLowerCase();
    const rePath = parseInt(raw.re_path) || 0;
    const isMain = rePath === 0 && raw.online === '1' && !raw.pap2g && !raw.pap5g && !raw.pap6g;
    const bhType = backhaulTypeFromRePath(rePath);
    const nodeTopology = topoRaw[raw.mac] || {};

    // Build radios
    const radios: MeshRadio[] = [];
    const addRadio = (band: WirelessBand, radioMac: string, ssid: string) => {
      if (!radioMac) return;
      const bandClients = nodeTopology[band] || {};
      radios.push({
        band,
        mac: radioMac.toLowerCase(),
        ssid: ssid || info.wl0_ssid || '',
        clientCount: Object.keys(bandClients).length,
        clients: Object.keys(bandClients).map(m => m.toLowerCase())
      });
    };
    addRadio('2G', raw.ap2g, raw.ap2g_ssid);
    addRadio('5G', raw.ap5g, raw.ap5g_ssid);
    if (raw.ap5g1) addRadio('5G1', raw.ap5g1, raw.ap5g1_ssid);
    if (raw.ap6g) addRadio('6G', raw.ap6g, raw.ap6g_ssid);

    // Resolve parent
    let parentMac: string | undefined;
    let backhaulRssi: number | undefined;
    let backhaulSsid: string | undefined;

    if (bhType === 'wireless') {
      if (raw.pap5g) {
        parentMac = radioToNode.get(raw.pap5g.toLowerCase());
        backhaulRssi = parseInt(raw.rssi5g) || undefined;
        backhaulSsid = raw.pap5g_ssid || undefined;
      } else if (raw.pap2g) {
        parentMac = radioToNode.get(raw.pap2g.toLowerCase());
        backhaulRssi = parseInt(raw.rssi2g) || undefined;
      } else if (raw.pap6g) {
        parentMac = radioToNode.get(raw.pap6g.toLowerCase());
        backhaulRssi = parseInt(raw.rssi6g) || undefined;
      }
    }

    // Link rate
    const linkRate = (() => {
      const wp = raw.wired_port as Record<string, unknown>;
      const wan = wp?.wan_port as Record<string, { link_rate?: string }> | undefined;
      if (wan) {
        const r = Object.values(wan)[0]?.link_rate;
        if (r === 'Q') return '2.5G';
        if (r === 'G') return '1G';
        if (r === 'M') return '100M';
      }
      return undefined;
    })();

    // Config
    const config: NodeConfig = {
      ledEnabled: raw.config?.ctrl_led?.led_val === '1',
      backhaulPriority: parseBackhaulPriority(raw.config?.backhalctrl?.amas_ethernet),
      preferredUplink: raw.config?.prefer_ap?.amas_wlc_target_bssid || '',
      radioEnabled: Object.fromEntries(
        Object.entries(raw.config?.wireless ?? {}).map(([k, v]) => [k, v === '1'])
      )
    };

    return {
      mac, alias: raw.alias || raw.ui_model_name, model: raw.ui_model_name || raw.model_name,
      modelId: raw.model_name, productId: raw.product_id || '', firmware: raw.fwver,
      newFirmware: raw.newfwver || undefined, ip: raw.ip, online: raw.online === '1',
      isMainNode: isMain, radios, backhaulType: bhType,
      backhaulBand: backhaulBandFromRePath(rePath), backhaulRssi, backhaulSsid,
      linkRate, connectionQuality: bhType === 'wireless' ? qualityFromRssi(backhaulRssi) : undefined,
      parentMac, parentName: parentMac ? nodeAliasMap.get(parentMac) : undefined,
      children: [], level: 0, bandCount: parseInt(raw.band_num) || 0,
      wiredMacs: (raw.wired_mac || []).map(m => m.toLowerCase()),
      config
    };
  });

  // ---- Build tree ----
  const nodeMap = new Map(nodes.map(n => [n.mac, n]));
  const mainNode = nodes.find(n => n.isMainNode);

  for (const node of nodes) {
    if (node.isMainNode) continue;
    if (!node.parentMac && mainNode) {
      node.parentMac = mainNode.mac;
      node.parentName = mainNode.alias;
    }
    const parent = nodeMap.get(node.parentMac!);
    if (parent) parent.children.push(node.mac);
  }

  // BFS levels
  if (mainNode) {
    const queue = [mainNode.mac];
    const visited = new Set([mainNode.mac]);
    while (queue.length) {
      const cur = queue.shift()!;
      const curNode = nodeMap.get(cur)!;
      for (const childMac of curNode.children) {
        if (visited.has(childMac)) continue;
        visited.add(childMac);
        const child = nodeMap.get(childMac);
        if (child) { child.level = curNode.level + 1; queue.push(childMac); }
      }
    }
  }

  // ---- Build clients ----
  const clients: MeshClient[] = [];
  const seenMacs = new Set<string>();

  // From get_clientlist (richest data)
  for (const [mac, raw] of Object.entries(clientsRaw)) {
    if (typeof raw !== 'object' || !raw.mac) continue;
    const clientMac = mac.toLowerCase();
    if (nodeMacSet.has(clientMac)) continue;
    seenMacs.add(clientMac);

    const isWireless = raw.isWL !== '0' && raw.isWL !== '';
    const parentMac = (raw.amesh_papMac || '').toLowerCase();

    clients.push({
      mac: clientMac,
      name: raw.nickName || raw.name || raw.vendor || clientMac,
      ip: raw.ip || '',
      vendor: raw.vendor || '',
      isWireless,
      isOnline: raw.isOnline === '1',
      band: isWireless ? (['', '2G', '5G', '5G1', '6G'][parseInt(raw.isWL)] as WirelessBand | undefined) : undefined,
      signal: isWireless ? (parseInt(raw.rssi) || undefined) : undefined,
      txRate: parseInt(raw.curTx) || undefined,
      rxRate: parseInt(raw.curRx) || undefined,
      connectTime: raw.wlConnectTime || undefined,
      connectedTo: parentMac,
      connectedToName: nodeAliasMap.get(parentMac) || parentMac,
      boundToMac: raw.amesh_bind_mac || undefined,
      boundToName: raw.amesh_bind_mac ? nodeAliasMap.get(raw.amesh_bind_mac.toLowerCase()) : undefined
    });
  }

  // From topology (catch devices not in get_clientlist)
  for (const [nodeMac, bands] of Object.entries(topoRaw)) {
    for (const [bandKey, bandClients] of Object.entries(bands)) {
      if (bandKey === 'wired_mac') continue;
      for (const [clientMac, entry] of Object.entries(bandClients)) {
        const cm = clientMac.toLowerCase();
        if (seenMacs.has(cm) || nodeMacSet.has(cm)) continue;
        seenMacs.add(cm);
        clients.push({
          mac: cm, name: cm, ip: entry.ip || '', vendor: '',
          isWireless: true, isOnline: true,
          band: bandKey as WirelessBand,
          signal: parseInt(entry.rssi) || undefined,
          connectedTo: nodeMac.toLowerCase(),
          connectedToName: nodeAliasMap.get(nodeMac.toLowerCase()) || nodeMac
        });
      }
    }
  }

  return { nodes, clients, ssid: info.wl0_ssid || '' };
}
