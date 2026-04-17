# Laubter — External Mesh Integration Design

## Architecture

Laubter integrates with external mesh WiFi systems (ASUS first, extensible to others).
OpenWrt handles routing/firewall/DHCP. The mesh system handles WiFi.

```
┌─────────────────┐     ┌──────────────────┐
│   Laubter UI    │     │  ASUS Mesh API   │
│  (browser SPA)  │────▶│  192.168.50.2    │
└────────┬────────┘     │  appGet.cgi      │
         │              └──────────────────┘
         │ ubus JSON-RPC
┌────────▼────────┐
│    OpenWrt      │
│  192.168.50.1   │
│  rpcd + plugins │
└─────────────────┘
```

The browser makes requests to BOTH:
1. OpenWrt (192.168.50.1:3000/ubus) for routing, firewall, DHCP, bandwidth
2. ASUS mesh (via a proxy on OpenWrt, or directly) for WiFi clients, mesh topology, signal

### Proxy vs Direct Access

**Option A — OpenWrt proxy rpcd plugin**: An rpcd plugin on the router fetches from the ASUS API and caches/transforms the data. The browser only talks to OpenWrt.
- Pro: Single origin, no CORS issues, credentials stored server-side
- Con: More router CPU, another moving part

**Option B — Direct browser access**: The browser fetches from ASUS directly via its IP.
- Pro: Simpler, no proxy needed
- Con: CORS (ASUS httpd doesn't set CORS headers), credentials in browser

**Decision: Option A (proxy)** — credentials stay on the router, no CORS issues, and we can cache/transform the data server-side.

## ASUS API Reference (Reverse-Engineered)

Base URL: `https://<asus-ip>:8443/appGet.cgi` (or `http://<asus-ip>/appGet.cgi`)

### Authentication
Login: POST to `/login.cgi` with `login_authorization=base64(user:pass)`
Returns: `Set-Cookie: asus_token=...`
All subsequent requests use `Cookie: asus_token=...`

### Endpoints (via `?hook=` query parameter)

| Hook | Description |
|------|-------------|
| `get_cfg_clientlist()` | Mesh nodes: alias, model, firmware, MAC, radios (2G/5G/5G1/6G), online status, wired MACs, backhaul RSSI |
| `get_clientlist()` | All clients: name, nickName, vendor, IP, MAC, isWL, rssi, curTx/curRx, wlConnectTime, amesh_papMac (parent node) |
| `get_allclientlist()` | Per-node per-band clients with RSSI |
| `get_wclientlist()` | Wireless client MACs grouped by node and band |
| `get_wiredclientlist()` | Wired client MACs grouped by node |
| `nvram_get(key)` | Config values (wl0_ssid, wl0_channel, firmver, etc.) |

### Key Client Fields
```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "name": "Vendor Name",
  "nickName": "User-assigned name",
  "ip": "192.168.50.xxx",
  "vendor": "Manufacturer",
  "isWL": "1",           // "1"=wireless, "0"=wired
  "rssi": "-42",         // signal strength dBm
  "curTx": "866",        // current TX rate Mbps
  "curRx": "866",        // current RX rate Mbps
  "wlConnectTime": "02:21:07",  // WiFi session duration
  "amesh_papMac": "F0:2F:74:12:8C:B0",  // parent AP MAC
  "amesh_isReClient": "1",  // connected via mesh
  "isOnline": "1"
}
```

### Mesh Node Fields
```json
{
  "alias": "Office",
  "model_name": "ZenWiFi_XT8",
  "ui_model_name": "ZenWiFi AX",
  "fwver": "3.0.0.4.388_24768",
  "ip": "192.168.50.2",
  "mac": "F0:2F:74:12:8C:B0",
  "online": "1",
  "ap2g": "F0:2F:74:12:8C:B0",  // 2.4GHz radio MAC
  "ap5g": "F0:2F:74:12:8C:B4",  // 5GHz radio MAC
  "ap5g1": "F0:2F:74:12:8C:B8", // 5GHz-2 radio MAC
  "level": "0",           // hop count from main AP
  "re_path": "0",         // backhaul type: 0=wired, 1=wireless
  "band_num": "3"         // number of radios
}
```

## UI Design

### Remove from Laubter
- WiFi status card on dashboard (replace with Mesh Status)
- Settings > WiFi page (replace with link to ASUS admin or mesh config)
- Any hostapd/iwinfo references in stores

### Add to Laubter

#### 1. Mesh Status Dashboard Card
Replaces the WiFi card. Shows:
- Mesh system name + SSID ("Laub")
- Node count with online/offline status
- Total wireless clients across all nodes
- Mini topology: icons for each node with connection lines

#### 2. Mesh Map Page (new route: /mesh)
Full-page interactive mesh topology visualization:
- Each node shown as a device icon with name, model, client count
- Lines between nodes showing backhaul type (wired=solid, wireless=dashed)
- Clients clustered around their parent node
- Color-coded by band (2G=blue, 5G=green, 5G1=purple)
- Click a node: shows node details (firmware, radios, uptime)
- Click a client: shows client details with signal, band, speed

#### 3. Enhanced Client Table
Merge ASUS client data with DHCP leases:
- Add columns: WiFi/Wired, Band (2.4G/5G), Signal, Mesh Node, TX/RX Speed
- Signal bars component using ASUS RSSI data
- "Connected to: Office (5G)" showing which mesh node and band
- Sort by signal strength, band, node

#### 4. Mesh Settings (future)
- Link to ASUS admin panel for now
- Eventually: SSID/password change, channel selection, band steering via ASUS API

## Implementation

### rpcd Plugin: laubter-mesh

A new rpcd plugin that proxies ASUS API requests:

```sh
#!/bin/sh
# /usr/libexec/rpcd/laubter-mesh
# Proxies requests to ASUS mesh router API

ASUS_HOST="192.168.50.2"
ASUS_PORT="8443"
ASUS_PROTO="https"
COOKIE_FILE="/tmp/laubter/asus_cookie"
CONFIG_FILE="/tmp/laubter/mesh_config.json"

# Methods:
# - get_nodes: returns mesh node list
# - get_clients: returns all clients with wireless info
# - get_topology: returns wired/wireless client assignments per node per band
# - configure: set ASUS host/credentials
```

### Mesh Provider Interface (generic)

```typescript
// src/lib/mesh/types.ts
interface MeshProvider {
  name: string;  // "asus", "tp-link", etc.
  getNodes(): Promise<MeshNode[]>;
  getClients(): Promise<MeshClient[]>;
  getTopology(): Promise<MeshTopology>;
}

interface MeshNode {
  id: string;        // MAC address
  alias: string;     // "Office", "Clinic"
  model: string;     // "ZenWiFi AX"
  firmware: string;
  ip: string;
  online: boolean;
  radios: MeshRadio[];
  backhaulType: 'wired' | 'wireless';
  backhaulRssi?: number;
  level: number;     // hop count from main
  clientCount: number;
}

interface MeshRadio {
  band: '2G' | '5G' | '5G1' | '6G';
  mac: string;
  ssid: string;
  clients: string[];  // client MACs
}

interface MeshClient {
  mac: string;
  name: string;      // resolved name (nickName > name > hostname > vendor)
  ip: string;
  vendor: string;
  isWireless: boolean;
  band?: '2G' | '5G' | '5G1' | '6G';
  signal?: number;    // RSSI dBm
  txRate?: number;
  rxRate?: number;
  connectedTo: string; // node MAC
  connectedToName: string; // node alias
  online: boolean;
  connectTime?: string;
}
```
