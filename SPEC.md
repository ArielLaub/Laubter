# OpenWrt Modern UI — Complete UI/UX Specification

> Codename: **Laubter**
> A modern, UniFi-inspired web interface for OpenWrt routers.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
1b. [LuCI Analysis: Reuse vs Replace](#1b-luci-analysis-reuse-vs-replace)
2. [Technical Stack](#2-technical-stack)
3. [Visual Design System](#3-visual-design-system)
4. [Application Shell & Navigation](#4-application-shell--navigation)
5. [Dashboard](#5-dashboard)
6. [Clients Page](#6-clients-page)
7. [Ports & Devices Page](#7-ports--devices-page)
8. [Statistics Page](#8-statistics-page)
9. [Traffic & Firewall Page](#9-traffic--firewall-page)
10. [System Log Page](#10-system-log-page)
11. [Settings: WiFi](#11-settings-wifi)
12. [Settings: Networks](#12-settings-networks)
13. [Settings: Internet (WAN)](#13-settings-internet-wan)
14. [Settings: VPN](#14-settings-vpn)
15. [Settings: Firewall & Security](#15-settings-firewall--security)
16. [Settings: Routing](#16-settings-routing)
17. [Settings: DNS](#17-settings-dns)
18. [Settings: Profiles](#18-settings-profiles)
19. [Settings: System](#19-settings-system)
20. [Settings: Packages](#20-settings-packages)
21. [Setup Wizard](#21-setup-wizard)
22. [Interaction Patterns](#22-interaction-patterns)
23. [Responsive & Mobile](#23-responsive--mobile)
24. [API Layer & Data Sources](#24-api-layer--data-sources)
25. [APK Packaging](#25-apk-packaging)

---

## 1. Design Philosophy

### Core Principles

1. **Clone UniFi's information architecture.** Ubiquiti spent millions on UX research. We adopt their proven menu structure, page layouts, and interaction patterns wholesale — adapted for a single OpenWrt device.

2. **Three-tier complexity (from GL.iNet).** Every settings page has three levels:
   - **Simple** — the 5 things 80% of users touch. Toggle-based, plain English labels.
   - **Advanced** — full configuration surface via an "Advanced" accordion. Still guided.
   - **Terminal** — an embedded terminal/UCI editor for power users who want raw access.

3. **Activity feed for security (from Firewalla).** Firewall blocks and security events appear as a scrolling, human-readable feed with one-tap Block/Allow actions — not as a log table.

4. **Actionable, not informational.** Every piece of data shown should lead to an action. A client consuming 80% bandwidth → click → apply bandwidth limit. A blocked connection → click → create allow rule.

5. **Progressive disclosure everywhere.** Default views are clean and uncluttered. Details expand on click/tap. No setting is hidden — but rarely-used settings require one more click to reach.

6. **Dark-first design.** Dark theme is the default. Light theme available via toggle. All colors, contrasts, and visualizations are designed for dark backgrounds first.

7. **Device fingerprinting (from Firewalla).** Clients are shown with auto-detected device names, manufacturer logos, and device type icons — not raw MAC addresses.

### What We're NOT Building

- Fleet management / multi-site controller (this is for one router)
- Cloud dependency (everything runs locally on the router)
- Native mobile app (progressive web app is sufficient)

### Coexistence with LuCI

Laubter ships alongside LuCI — not as a replacement. Laubter serves on port 3000 (configurable), LuCI stays on port 80. Users can fall back to LuCI for edge cases, third-party `luci-app-*` packages, or any functionality Laubter doesn't yet cover. This is a lesson from every failed LuCI alternative (LuCI2, luci-ng, OUI, VWRT) — trying to replace LuCI completely before reaching feature parity killed them all.

---

## 1b. LuCI Analysis: Reuse vs Replace

### LuCI's Current Architecture (post-2024)

LuCI is now **65% JavaScript, 17% C, 7% Lua**. The old Lua server-side rendering is largely replaced:
- **Frontend**: Client-side SPA using `LuCI.js` framework, communicating via JSON-RPC to `/ubus`
- **Backend**: ucode (not Lua) for the dispatcher/template layer; `rpcd` for all data access
- **Lua**: only remains in unmigrated third-party `luci-app-*` packages; core is Lua-free

### What We MUST Port (high value, hard to replicate)

#### 1. UCI Data Layer Pattern (`LuCI.uci`)

LuCI's UCI abstraction uses a **3-phase commit** that prevents router lockout:

```
Phase 1: load()     → Fetch configs from ubus, cache locally
          get/set()  → All reads/writes hit local cache (synchronous, fast)

Phase 2: save()     → Submit accumulated deltas to rpcd staging area
                       Deltas are ChangeRecords: [op, section, param?, value?]
                       ops: add, set, remove, order, list-add, list-del, rename

Phase 3: apply(timeout=10) → Commit staged changes with ROLLBACK TIMER
          confirm()          → Cancel the rollback timer (user can still reach UI)
          (timeout expires)  → Auto-revert all changes (user got locked out)
```

**We port this as a Svelte store** (`uciStore`) with the same semantics. This is non-negotiable — every router UI that skips rollback protection eventually bricks someone's remote router.

#### 2. RPC Call Batching (`LuCI.rpc`)

LuCI's `rpc.declare()` pattern is elegant:

```javascript
const callSystemInfo = rpc.declare({
    object: 'system',
    method: 'info',
    expect: { '': {} }
});
```

Multiple declared calls are **automatically batched into a single HTTP POST** (JSON-RPC batch request). This is a major performance optimization — the dashboard issues 10+ ubus calls on load; batching turns that into 1 HTTP round-trip.

**We port this pattern** into a typed TypeScript RPC client with automatic batching.

#### 3. Network State Aggregation (`LuCI.network`, ~5000 lines)

This is the crown jewel. `network.js` merges data from **6 parallel ubus calls** into a unified object model:

```
callLuciNetworkDevices()    → physical/virtual device inventory
callLuciWirelessDevices()   → radio + SSID state
callLuciBoardJSON()         → hardware port layout (board.json)
callLuciHostHints()         → DHCP/ARP/mDNS → hostname mapping
callNetworkInterfaceDump()  → logical interface state
callNetworkProtoHandlers()  → available protocol types
+ uci.load('network')       → saved configuration
+ uci.load('wireless')      → saved wireless config
```

The join logic handles:
- **DSA port detection**: `devtype === 'dsa'` from kernel attributes, not name heuristics
- **Bridge VLAN synthesis**: UCI `bridge-vlan` sections → virtual `basedev.vid` devices
- **Device hierarchy**: `getParent()` resolves DSA port → switch, VLAN → base device
- **Protocol handlers**: Dynamic subclass registration for DHCP, PPPoE, WireGuard, etc.
- **Device type classification**: Regex-based (bridge/wifi/tunnel/vlan/vrf/switch/ethernet)
- **Device filtering**: Ignores internal devices (wmaster, hwsim, imq, ifb, lo, etc.)

**We extract the data transformation logic** into framework-agnostic TypeScript modules. The class hierarchy becomes TypeScript interfaces + pure functions.

#### 4. Firewall Referential Integrity (`LuCI.firewall`, ~594 lines)

When you delete a firewall zone, LuCI cascades:
- Removes all `forwarding` sections referencing that zone (src or dest)
- Removes all `redirect` sections referencing that zone
- Removes all `rule` sections referencing that zone
- Cleans up network-to-zone associations

When you delete a network, it removes it from all zones' network lists.

**We port this logic directly** — it's ~200 lines of cascading delete/cleanup code.

#### 5. Protocol Handler Plugin System

LuCI uses dynamic module loading: `L.require('protocol.static')`, `L.require('protocol.dhcp')`, etc. Each protocol registers a handler via `Network.registerProtocol(name, methods)` that:
- Reports its capabilities (virtual? floating? bridge?)
- Contributes protocol-specific form fields
- Queries protocol-specific runtime state

**We adopt this pattern** with a Svelte component registry:

```typescript
// protocol-registry.ts
registerProtocol('dhcp', {
    label: 'DHCP Client',
    package: 'netifd',
    component: () => import('./protocols/DhcpConfig.svelte'),
    getStatus: (iface) => ({ /* runtime state */ })
});
```

#### 6. Host Hints Aggregation

LuCI's `getHostHints()` merges:
- DHCP leases (hostname → IP → MAC)
- ARP table (IP → MAC)
- IPv6 neighbor discovery
- WiFi association list (MAC → signal, rate)

Into a unified device identity database. **We port this** into our device fingerprinting system and extend it with OUI lookups.

### What We REPLACE (dated, limiting, or unnecessary)

| LuCI Component | Why Replace | Our Replacement |
|---|---|---|
| `form.Map` / CBI system (~6000 lines) | Generates flat, auto-generated forms with no UX intelligence. UCI-structure-mirrors-UI is the root cause of LuCI's poor UX. | Purpose-built Svelte components per settings page. Semantic UI, not UCI mirrors. |
| `LuCI.ui` widget library | Raw DOM manipulation, custom widget rendering. No modern component framework benefits. | shadcn-svelte components (accessible, composable, Tailwind-styled) |
| Theme system (CSS-only over fixed HTML) | Can only skin, not restructure. All themes look dated because the HTML skeleton is dated. | Tailwind + CSS variables. Full control over markup and layout. |
| ucode dispatcher/templates | Server-side routing and rendering. Unnecessary for a pure SPA. | SvelteKit client-side routing (`adapter-static`) |
| Lua runtime (`luci-lua-runtime`) | Legacy compat layer. We don't need backward compatibility with Lua apps. | Zero server-side rendering. Browser does everything. |
| JSON menu definitions | Flat hierarchical menus that mirror UCI structure, not user tasks. | Task-oriented navigation designed around user workflows. |
| `luci-rpc` server-side helpers | Custom rpcd module that wraps ubus calls with LuCI-specific transformations (getNetworkDevices, getHostHints, etc.) | We need equivalent rpcd plugins but will write our own (smaller, JSON-native). |

### Critical LuCI rpcd Dependencies

LuCI registers custom rpcd methods via `luci-mod-rpc` that provide **aggregated data** not available from raw ubus. We need equivalents:

| LuCI rpcd Method | What It Does | Our Approach |
|---|---|---|
| `luci-rpc.getNetworkDevices` | Merges `/sys/class/net/` stats with ubus device data | Custom `laubter-network` rpcd plugin |
| `luci-rpc.getWirelessDevices` | Combines `iwinfo` + `hostapd` + UCI wireless config | Custom `laubter-wireless` rpcd plugin |
| `luci-rpc.getHostHints` | Merges DHCP leases + ARP + neighbor + WiFi assoclist | Custom `laubter-hosts` rpcd plugin |
| `luci-rpc.getBoardJSON` | Reads `/etc/board.json` (hardware port layout) | Direct `file.read` of `/etc/board.json` |

These are small shell/ucode scripts in `/usr/libexec/rpcd/`, installed as part of the Laubter APK.

### Lessons from Failed LuCI Alternatives

| Project | Year | Stack | Why It Failed |
|---|---|---|---|
| **LuCI2** | 2013 | Pure JS + ubus | Single developer (jow). Backend gaps forced writing rpcd plugins. UI freezing bugs. Deprecated. |
| **luci-ng** | 2016 | Angular + ubus | Angular too heavy for embedded. Single maintainer. Goals absorbed into mainline LuCI JS migration. |
| **OUI** | 2019 | Vue 3 + Element Plus | Required its own backend (lighttpd + Lua-eco) — parallel stack, not drop-in. Thin docs. Limited adoption. |
| **VWRT** | 2019 | Vue + iview | Abandoned. Minimal community. |
| **MoCI** | 2026 | Vanilla JS + ubus | Newest. Positive reception for aesthetics. Criticized for code quality. Only covers subset of LuCI. **Coexists with LuCI — smart approach we adopt.** |

**Pattern**: Every project that tried to **replace** LuCI died. MoCI, which **coexists**, survived. We follow MoCI's model.

### The 80/20 Trap

Building a pretty dashboard with bandwidth graphs and a client list covers 80% of daily use — and takes 20% of the effort. The remaining 80% of effort is:

- DSA bridge-VLAN tagged/untagged per-port matrix configuration
- Multi-radio wireless with 802.11r roaming, WDS mesh, and per-radio regulatory constraints
- IPv6 with DHCPv6-PD, SLAAC, 6in4 tunnels, DNS64, and prefix delegation
- Firewall zones with masquerading, MSS clamping, conntrack helpers, and zone forwarding matrices
- Multi-WAN failover with health checks, policy routing, and MWAN3 rules
- SQM/QoS with cake/fq_codel queue disciplines and per-interface shaping

LuCI's `network.js` has **15 years of accumulated edge-case handling** for these scenarios. We don't skip them — we port the logic progressively, prioritizing the most common workflows first, with LuCI as fallback for the rest.

---

## 2. Technical Stack

| Layer | Package | Why |
|-------|---------|-----|
| **Framework** | SvelteKit (SPA mode, `adapter-static`) | 10 kB runtime, compiler-based, no virtual DOM — ideal for resource-constrained routers |
| **Components** | shadcn-svelte (uses bits-ui) | Copy/paste components, full control, UniFi-like aesthetic out of the box, built-in chart support via LayerChart |
| **Styling** | Tailwind CSS v4 | Zero runtime CSS, utility-first, excellent dark mode support |
| **Time-series charts** | uPlot | 21 kB gzipped, renders 150K points in 90ms, 10% CPU at 60fps — critical for live bandwidth graphs |
| **Compositional charts** | LayerChart (via shadcn-svelte) | Svelte-native, SVG-based donut/area/bar charts for dashboard cards |
| **Sparklines** | sparkline-svelte | <2 kB, animated, real-time — for inline table sparklines |
| **Icons** | lucide-svelte | Clean thin-line style matching UniFi, 200-400 bytes/icon tree-shaken, default for shadcn-svelte |
| **Data tables** | TanStack Table + TanStack Virtual | Headless, virtual scrolling for 200+ client lists, sorting/filtering/column customization |
| **IP/CIDR validation** | ip-cidr + is-cidr | Lightweight input validation for network fields |
| **API client** | Custom ubus JSON-RPC client | Typed wrapper around OpenWrt's rpcd HTTP endpoint |

### Bundle Size Budget

| Component | Gzipped |
|-----------|---------|
| Svelte runtime | ~10 kB |
| App code + components | ~40-60 kB |
| uPlot | ~21 kB |
| LayerChart (tree-shaken) | ~30 kB |
| TanStack Table + Virtual | ~20 kB |
| Icons (est. 50 icons) | ~15 kB |
| **Total** | **~140-160 kB** |

This fits comfortably in router flash storage (smallest: 16 MB) and loads fast even on a 100 Mbps LAN.

---

## 3. Visual Design System

### Color Palette (UniFi-derived, dark-first)

```
BACKGROUND LAYERS (darkest → lightest)
surface-900  #0e1117   App background
surface-800  #161b22   Card background
surface-700  #1c2333   Elevated cards / hover background
surface-600  #2a3040   Active/selected state background
surface-500  #303846   Borders (subtle)

TEXT
text-primary    #e8eaed   Primary text (headings, values)
text-secondary  #8b949e   Secondary text (labels, descriptions)
text-muted      #6b7280   Disabled, placeholder text

ACCENT (UniFi Blue)
accent          #006fff   Primary actions, links, active nav items
accent-hover    #0058cc   Hover state
accent-muted    #1a3a5c   Subtle blue backgrounds (selected rows, badges)
accent-light    #338bff   Focus rings

STATUS
success         #22c55e   Online, healthy, connected, allowed
success-muted   #0f3d1e   Success background tint
warning         #f59e0b   Degraded, high latency, expiring
warning-muted   #3d2f0b   Warning background tint
danger          #ef4444   Offline, error, blocked, critical
danger-muted    #3d1212   Danger background tint
info            #06b6d4   Informational, neutral actions
info-muted      #0c3040   Info background tint

CHARTS
chart-blue      #006fff   Primary data series (download)
chart-cyan      #06b6d4   Secondary data series (upload)
chart-green     #22c55e   Healthy/success metrics
chart-amber     #f59e0b   Warning metrics
chart-red       #ef4444   Error/danger metrics
chart-purple    #a354e3   Tertiary data series
```

### Light Theme Overrides

```
surface-900  #f9fafa   App background
surface-800  #ffffff   Card background
surface-700  #f4f5f6   Elevated cards
surface-600  #eef0f1   Borders
text-primary    #212327
text-secondary  #50565e
text-muted      #808893
accent          #006fff   (unchanged)
```

### Typography

| Token | Size | Weight | Use |
|-------|------|--------|-----|
| `display` | 24px / 1.33 | 600 | Page titles |
| `heading` | 18px / 1.33 | 600 | Card titles, section headers |
| `subheading` | 14px / 1.43 | 600 | Sub-section labels |
| `body` | 14px / 1.57 | 400 | Default text, form labels |
| `small` | 12px / 1.33 | 400 | Table cells, secondary info |
| `caption` | 11px / 1.27 | 400 | Timestamps, footnotes |
| `mono` | 13px / 1.54 | 400 | IP addresses, MAC addresses, config values |

**Font stack**: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
**Monospace stack**: `"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace`
**Font smoothing**: `-webkit-font-smoothing: antialiased`

### Spacing

4px base grid: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`

### Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `sm` | 4px | Buttons, inputs, badges |
| `md` | 8px | Cards, panels, dropdowns |
| `lg` | 12px | Modals, large containers |
| `full` | 9999px | Pills, avatar circles |

### Elevation (via background, not shadows)

Cards are differentiated by background color steps, not box-shadows. This matches UniFi's flat-but-layered look and performs better on low-end devices.

| Level | Background | Use |
|-------|-----------|-----|
| Base | surface-900 | Page background |
| Card | surface-800 | Content cards, sidebar |
| Elevated | surface-700 | Hover states, nested cards, dropdowns |
| Overlay | `rgba(0,0,0,0.6)` | Modal backdrops |

### Iconography

Use Lucide icons exclusively. Style rules:
- Stroke width: 1.75px (slightly lighter than default 2px, closer to UniFi)
- Size: 20px in navigation, 16px inline with text, 24px in empty states
- Color: `text-secondary` by default, `accent` for active/interactive, `text-muted` for disabled

---

## 4. Application Shell & Navigation

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ [Sidebar]  [Top Bar                                    ] │
│            ┌────────────────────────────────────────────┐ │
│  ◉ Logo    │                                            │ │
│            │                                            │ │
│  Dashboard │           Main Content Area                │ │
│  Clients   │                                            │ │
│  Ports     │                                            │ │
│  Statistics│                                            │ │
│  Traffic   │                                            │ │
│  Log       │                                            │ │
│            │                                            │ │
│  ─────     │                                            │ │
│  Settings  │                                            │ │
│            └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Sidebar (Left, 64px collapsed / 220px expanded)

**Behavior:**
- Collapsed by default (icons only, 64px wide)
- Expands on hover (220px, with text labels fading in)
- Can be pinned open via a lock icon at the top
- On mobile: hidden, triggered by hamburger in top bar

**Items (top to bottom):**

| Icon | Label | Route |
|------|-------|-------|
| `LayoutDashboard` | Dashboard | `/` |
| `Users` | Clients | `/clients` |
| `Network` | Ports | `/ports` |
| `BarChart3` | Statistics | `/statistics` |
| `Shield` | Traffic | `/traffic` |
| `ScrollText` | Log | `/log` |
| — separator — | | |
| `Settings` | Settings | `/settings` |

**Active state**: Left 3px accent-blue border, icon and text in accent color, subtle `accent-muted` background.

**Bottom of sidebar**:
- Throughput indicator: `▲ 12.4 Mbps  ▼ 847 Mbps` (real-time, always visible)
- Router hostname and firmware version in caption text

### Top Bar (48px height)

Left to right:
1. **Hamburger** (mobile only) — toggles sidebar
2. **Breadcrumb** — e.g., `Settings > WiFi > MyNetwork-5G`
3. **Spacer**
4. **Global Search** — `Cmd+K` / `Ctrl+K` to open command palette. Searches: clients by name/IP/MAC, settings pages by keyword, recent actions. Shows results in a floating dropdown with keyboard navigation.
5. **Speed Test** button — triggers an inline speed test (via speedtest-cli or iperf if installed), shows results in a toast
6. **Notification bell** — badge count of unread alerts. Click opens a dropdown with recent events (connection drops, firmware updates, security blocks). Each item is an actionable card.
7. **Theme toggle** — sun/moon icon, switches light/dark
8. **System menu** — avatar/hostname. Dropdown: Reboot, Backup, Factory Reset, Logout

### Settings Sub-Navigation

When on `/settings/*`, the main content area splits:

```
┌──────────────────────────────────────────────────────────┐
│ Settings                           [Search settings...] │
│ ┌──────────────┐ ┌──────────────────────────────────────┐│
│ │ WiFi         │ │                                      ││
│ │ Networks     │ │    Settings content area              ││
│ │ Internet     │ │                                      ││
│ │ VPN          │ │                                      ││
│ │ Firewall     │ │                                      ││
│ │ Routing      │ │                                      ││
│ │ DNS          │ │                                      ││
│ │ Profiles     │ │                                      ││
│ │ System       │ │                                      ││
│ │ Packages     │ │                                      ││
│ └──────────────┘ └──────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

Settings sidebar: 200px, no icons, text-only, subtle background.

---

## 5. Dashboard

The dashboard is a **widget grid** using a responsive card layout. Widgets are arranged in a 12-column CSS grid.

### Default Widget Layout

```
Row 1:  [System Status (3col)] [Internet Status (3col)] [WiFi Status (3col)] [Clients Summary (3col)]
Row 2:  [Bandwidth Graph (8col)                                             ] [Top Clients (4col)   ]
Row 3:  [Traffic by Category (4col)] [Firewall Activity (4col)             ] [WiFi Channels (4col)  ]
```

### Widget: System Status (3 col)

A compact card showing:
- **Hostname** in heading text
- **Model** in secondary text (e.g., "Linksys E8450")
- **Uptime** as `5d 14h 23m`
- **CPU load** as a thin horizontal bar with percentage (`12%`)
- **Memory** as a thin horizontal bar with used/total (`312 MB / 1 GB`)
- **OpenWrt version** in caption (e.g., `24.10.0 r28427`)

Layout: vertical stack of labeled rows, each with a subtle progress bar.

### Widget: Internet Status (3 col)

- **Status indicator**: large green dot + "Connected" / red dot + "Disconnected"
- **WAN IP**: e.g., `203.0.113.47` (with copy button)
- **Gateway**: `192.168.1.1`
- **DNS servers**: `1.1.1.1, 8.8.8.8`
- **Protocol**: DHCP / PPPoE / Static
- **Uptime**: WAN uptime specifically
- **Latency**: ping to gateway, shown as `4ms` with green/amber/red color

Click anywhere → navigates to Settings > Internet.

### Widget: WiFi Status (3 col)

- **Per-radio summary**: Each radio (2.4 GHz, 5 GHz, 6 GHz) gets a row:
  - Radio name and band badge
  - Channel number + width (e.g., `Ch 36 @ 80MHz`)
  - Client count
  - Small signal quality indicator (arc icon filled proportionally)
- **SSIDs**: List of active SSIDs below, each with client count

Click → Settings > WiFi.

### Widget: Clients Summary (3 col)

- **Total count** in large display text (e.g., `23`)
- Breakdown: `18 wireless / 5 wired`
- **Mini donut chart** showing device type distribution:
  - Phones (blue)
  - Computers (cyan)
  - IoT (purple)
  - Media (green)
  - Other (gray)
- **New today**: count of newly seen devices in the last 24h

Click → Clients page.

### Widget: Bandwidth Graph (8 col)

- **Full-width time-series chart** (uPlot)
- Two series: Download (blue, filled area) and Upload (cyan, filled area)
- **Time range selector**: `1H | 24H | 7D | 30D` toggle buttons at top-right of card
- **Current throughput** in large text at top-left: `▼ 847 Mbps  ▲ 12.4 Mbps`
- **Peak** values annotated on the chart
- Tooltip on hover shows exact values at that timestamp
- Y-axis auto-scales with human-readable units (Kbps, Mbps, Gbps)
- 1-second polling for 1H view, aggregated for longer ranges

**Data source**: Poll `network.device status` for interface `statistics.rx_bytes` / `tx_bytes`, calculate deltas. For historical data: `nlbwmon` databases read via `file.exec`.

### Widget: Top Clients (4 col)

- **Top 5 clients by bandwidth** in the selected time range
- Each row: device icon + name, sparkline of recent activity, current throughput value
- Hover: shows IP address, connection type, signal strength
- Click a client → opens Client Detail Panel (right slide-out)

### Widget: Traffic by Category (4 col)

- **Donut chart** (LayerChart) showing traffic distribution by application category
- Categories (from DPI or DNS-based classification):
  - Streaming (Netflix, YouTube, etc.)
  - Web Browsing
  - Gaming
  - Social Media
  - Cloud / File Sync
  - IoT / Smart Home
  - VPN
  - Other
- Each slice is labeled with category name + percentage
- Legend below with byte totals

**Data source**: If `nlbwmon` is available with protocol data, use that. Otherwise fall back to connection tracking port-based heuristics (80/443 = Web, 1935/RTMP = Streaming, etc.). DNS-based classification can use the router's DNS cache.

### Widget: Firewall Activity (4 col)

**Firewalla-style activity feed** (the key differentiator):
- Scrolling feed of recent firewall events (last 50)
- Each event is a compact card:
  ```
  ✕ Blocked   Samsung-TV → telemetry.samsung.com
  12 min ago   Rule: Block IoT Telemetry
  ```
  ```
  ✓ Allowed   MacBook-Pro → github.com:443
  2 min ago    TCP/HTTPS
  ```
- Events are color-coded: red (blocked), green (allowed), amber (rate-limited)
- Click an event → expands to show full details (source IP, dest IP, port, protocol, matched rule)
- Quick actions on each event: **Create Rule** (to allow/block permanently), **View Client**, **Mute**

**Data source**: `nft monitor` output via a custom rpcd plugin or WebSocket bridge, plus `logread` for firewall log entries.

### Widget: WiFi Channels (4 col)

- **Channel utilization visualization** per radio
- Horizontal bar chart showing each channel's utilization percentage
- Color-coded: green (<50%), amber (50-80%), red (>80%)
- Current channel highlighted with accent color
- Nearby networks shown as small marks on the channel bars

**Data source**: `iwinfo survey` for channel utilization data.

### Widget Customization

- **Add widget** button at bottom of dashboard opens a widget picker modal
- Widgets can be **reordered** via drag-and-drop (using `svelte-dnd-action`)
- Widgets can be **removed** via an X button (visible on hover)
- Widget preferences are persisted in `localStorage` (or a UCI config section)
- Available additional widgets:
  - **Speed Test**: embedded speed test with history graph
  - **DHCP Leases**: compact lease table with expiry countdown
  - **VPN Status**: connected peers, tunnel throughput
  - **Latency Monitor**: ping graph to configurable targets (gateway, 1.1.1.1, custom)
  - **Switch Ports**: visual port diagram with link status/speed
  - **DNS Queries**: query rate graph, top queried domains
  - **Security Score**: radar chart scoring password strength, firmware age, open ports, encryption (from Synology/ASUS)

---

## 6. Clients Page

### Main View: Client Table

Full-page data table (TanStack Table + TanStack Virtual) with:

**Default Columns:**

| Column | Width | Content | Sortable |
|--------|-------|---------|----------|
| Name | 200px | Device icon + hostname (editable inline) | Yes |
| IP Address | 130px | Monospaced, copy on click | Yes |
| MAC Address | 150px | Monospaced, copy on click, manufacturer OUI shown as tooltip | Yes |
| Connection | 100px | Badge: `WiFi 5G` / `WiFi 2.4G` / `Ethernet` with color | Yes |
| Signal | 80px | 4-bar icon filled by strength, dBm value on hover | Yes (by dBm) |
| Activity | 120px | Sparkline (last 5 min) + current throughput value | Yes (by throughput) |
| Download | 100px | Total bytes down in time range | Yes |
| Upload | 100px | Total bytes up in time range | Yes |
| Last Seen | 100px | Relative time ("3m ago") / "Now" for active | Yes |

**Additional Columns (toggled via column picker):**
- AP / SSID (which WiFi network)
- DHCP Lease Expiry
- TX/RX Rate
- TX Retries %
- First Seen
- Device Type
- Manufacturer

**Table Features:**
- **Column customization**: gear icon opens column picker (checkboxes), saved to localStorage
- **Column resizing**: drag column borders
- **Virtual scrolling**: only visible rows rendered (handles 500+ clients)
- **Global search**: text input above table, filters across name/IP/MAC/manufacturer
- **Filters** (horizontal filter bar above table):
  - Connection type: All | Wireless | Wired
  - Band: All | 2.4 GHz | 5 GHz | 6 GHz
  - Status: Online | Offline | All
  - Network/VLAN: dropdown of configured networks
- **Bulk actions**: select multiple clients → group action bar: Block, Assign to Network, Set Bandwidth Limit
- **Time range**: matches dashboard (1H / 24H / 7D / 30D) for traffic stats

### Client Detail Panel (Right Slide-Out)

Triggered by clicking any client row. Panel slides in from right, 400px wide, overlaying the table.

**Panel Header:**
- Large device type icon (auto-detected: phone, laptop, smart TV, IoT, printer, etc.)
- Device name (editable text field, click to edit)
- Manufacturer name in secondary text
- Status dot (green/gray)
- Close button (X) at top-right

**Tabs: Overview | Insights | Settings**

**Overview Tab:**
- **Connection info card**:
  - IP Address (with "Set Static" action link)
  - MAC Address
  - Connection type + signal strength bar
  - Connected to: SSID name + radio band
  - Uptime: how long connected
  - WiFi generation badge: `Wi-Fi 6` / `Wi-Fi 5` etc.
- **Current Activity**:
  - Bandwidth sparkline (live, last 5 minutes)
  - Current download/upload rate
  - Total transferred this session
- **Connection History**:
  - Vertical timeline showing connect/disconnect events with timestamps

**Insights Tab:**
- **Bandwidth over time**: area chart (uPlot) showing this client's usage over selected period
- **Top Destinations**: horizontal bar chart of most-contacted domains/IPs
  - Shows resolved hostnames where possible
  - Service name/logo for known services (Netflix, Google, Apple, etc.)
- **Traffic breakdown**: donut showing protocol/category distribution for this client
- **Blocked attempts**: list of firewall blocks for this client (if any)

**Settings Tab:**
- **Name**: text input (overrides auto-detected hostname)
- **Device type**: dropdown (Phone, Laptop, Desktop, Tablet, Smart TV, IoT Sensor, Camera, Speaker, Gaming Console, Printer, Other)
- **Fixed IP**: toggle + IP address input (creates a static DHCP lease)
- **Bandwidth Limit**: toggle + download/upload speed inputs (Mbps)
- **Network/VLAN**: dropdown to move client to a different network
- **Block**: toggle to block this client entirely
- **Access Schedule**: weekly grid scheduler (paint time slots) — from Synology SRM pattern
- **Notes**: free-text field for admin notes

### Device Fingerprinting

Clients are auto-identified using:
1. **DHCP hostname** — most devices send one
2. **MAC OUI** — first 3 bytes → manufacturer (use a bundled OUI database, ~200 KB compressed)
3. **HTTP User-Agent** — if DPI is available
4. **mDNS/SSDP** — device type announcements
5. **Known MAC patterns** — Apple devices have recognizable randomized MAC prefixes

Display priority: user-set name > DHCP hostname > manufacturer + device type > MAC address

---

## 7. Ports & Devices Page

### Switch Port Diagram

Visual representation of the router's physical ports:

```
┌─────────────────────────────────────────────────────┐
│  Linksys E8450                                      │
│                                                     │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐           │
│  │WAN │  │ 1  │  │ 2  │  │ 3  │  │ 4  │           │
│  │ ●  │  │ ●  │  │ ●  │  │ ●  │  │ ○  │           │
│  │1Gbps│  │1Gbps│  │1Gbps│  │100M│  │    │           │
│  └────┘  └────┘  └────┘  └────┘  └────┘           │
│  WAN      LAN     LAN     LAN     LAN              │
└─────────────────────────────────────────────────────┘
```

- Each port is a clickable box
- **Link indicator**: green dot (connected), amber dot (100 Mbps — speed mismatch warning), empty (no link)
- **Speed label** below each port
- **Port assignment** label: WAN, LAN, Guest, IoT (from DSA/VLAN config)
- Hover shows: connected device name, MAC, IP, duplex mode

### Port Detail (on click)

Slide-out panel similar to client detail:
- Port name and number
- Link status (up/down, speed, duplex)
- VLAN assignments (tagged/untagged)
- Connected device (if LLDP/ARP data available)
- Port statistics: RX/TX bytes, packets, errors, drops
- Traffic graph for this port
- Port settings: enable/disable, VLAN membership, PoE (if supported)

### Wireless Radios Section

Below the switch diagram, show each wireless radio:

| Radio | Band | Channel | Width | Clients | Utilization |
|-------|------|---------|-------|---------|-------------|
| radio0 | 2.4 GHz | 6 | 40 MHz | 8 | 34% |
| radio1 | 5 GHz | 36 | 80 MHz | 15 | 12% |

Click a radio → shows details: supported modes, current power, country code, channel survey results, associated clients.

---

## 8. Statistics Page

### Time Range Selector (persistent across all views)

`1H | 24H | 7D | 30D | Custom` — toggle buttons at page top.

### Tabs: Overview | WiFi | Clients | Internet

**Overview Tab:**
- **Throughput chart**: large time-series (uPlot) with download/upload, per-interface toggle
- **Client count over time**: line chart showing connected client count
- **Connection tracking**: chart showing active connections over time (from conntrack count)

**WiFi Tab:**
- **Per-radio charts**: channel utilization over time
- **Signal distribution**: histogram of client signal strengths per radio
- **Top APs/SSIDs by client count**: bar chart (relevant if using multiple APs via 802.11r)
- **WiFi generation breakdown**: donut showing % of clients by Wi-Fi 4/5/6/6E/7
- **TX retry rate**: line chart over time (indicates interference)
- **Channel survey**: bar chart of interference per available channel

**Clients Tab:**
- **Top 10 clients by bandwidth**: horizontal bar chart with device names
- **Top 10 destinations by bandwidth**: bar chart with resolved hostnames / service names
- **New vs returning clients**: stacked area chart showing new devices per day
- **Device type distribution over time**: stacked area chart

**Internet Tab:**
- **WAN throughput**: dedicated chart for WAN interface
- **Latency**: line chart showing ping to gateway + external targets (1.1.1.1, 8.8.8.8)
- **Speed test history**: if periodic speed tests are configured, show results over time
- **DNS query rate**: queries per second over time
- **WAN errors/drops**: line chart from interface error counters

---

## 9. Traffic & Firewall Page

This is the **Firewalla-inspired** activity view combined with UniFi's Traffic Management.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Traffic & Firewall                                      │
│                                                          │
│  [Activity Feed]  [Traffic Rules]  [Firewall Rules]      │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │                                                      ││
│  │   Content based on selected tab                      ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### Activity Feed Tab

Real-time scrolling feed of network events (newest at top):

Each event card:
```
┌──────────────────────────────────────────────────┐
│ ✕ BLOCKED  Samsung-TV → samsungads.com           │
│ 3 min ago  •  Rule: Block Smart TV Telemetry     │
│                              [Allow] [View Rule] │
└──────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────┐
│ ✓ ALLOWED  MacBook-Pro → github.com:443          │
│ Just now   •  TCP/HTTPS  •  1.2 MB transferred   │
│                           [Block] [View Client]  │
└──────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────┐
│ ⚠ WARNING  Unknown device joined network         │
│ 12 min ago  •  MAC: AA:BB:CC:DD:EE:FF            │
│              [View Client] [Block] [Dismiss]      │
└──────────────────────────────────────────────────┘
```

**Filters** (horizontal bar at top):
- Type: All | Blocked | Allowed | Warnings
- Client: dropdown of known clients
- Destination: text search
- Protocol: Any | TCP | UDP | ICMP

**Feed behavior:**
- Auto-scrolls when at top, pauses when user scrolls down
- "New events" indicator appears when paused and new events arrive
- Events grouped if >10 identical events in 1 minute ("Samsung-TV → samsungads.com blocked 47 times")

### Traffic Rules Tab (Simplified — from UniFi)

High-level, plain-English rules for common scenarios:

**Rule creation wizard:**
1. **Action**: Allow / Block / Rate Limit
2. **What**: App category (Streaming, Gaming, Social Media, etc.) OR specific domain OR IP range
3. **Who**: All clients / specific client / client group / network/VLAN
4. **When**: Always / Schedule (weekly grid picker from Synology SRM)
5. **Description**: free text

**Rule list display** (plain English):
```
● Block [Social Media] for [Kids Network] during [Weekdays 10pm-7am]
● Rate Limit [Streaming] to [50 Mbps] for [All Clients]
● Block [samsungads.com, samsungcloudsolution.com] for [All Clients]
● Allow [TCP/443] from [WAN] to [NAS] (port forward)
```

Each rule has: drag handle (for reordering), enable/disable toggle, edit button, delete button.

### Firewall Rules Tab (Advanced — from pfSense)

Full nftables rule management for advanced users:

**Rule table columns:**
| # | Action | Protocol | Source | Destination | Port | States | Description | Actions |
|---|--------|----------|--------|-------------|------|--------|-------------|---------|
| 1 | Accept | TCP | LAN | * | 80,443 | 1,247 | Allow web | ✏️ 🗑 |
| 2 | Accept | TCP/UDP | * | Router | 53 | 342 | DNS | ✏️ 🗑 |
| 3 | Drop | * | WAN | * | * | 8,931 | Block WAN in | ✏️ 🗑 |

**Key features (from pfSense):**
- **Hit counter / active states** per rule — shows how many connections currently match each rule
- **Drag-and-drop reordering** — rules evaluate top-to-bottom
- **Aliases** — named groups of IPs, ports, or subnets usable in rules. Managed in Settings > Profiles.
- **Quick-add** from activity feed: clicking "Create Rule" on a feed event pre-fills the rule form
- **Rule search**: text filter across all rule fields
- **Zone-based** display: tabs or filters for LAN-in, LAN-out, WAN-in, WAN-out, Forward (matching OpenWrt/nftables zones)

**Rule editor form:**
- Zone/Chain: dropdown
- Action: Accept / Drop / Reject (with reject type)
- Protocol: dropdown (TCP, UDP, TCP+UDP, ICMP, Any, custom)
- Source: IP/CIDR input + zone dropdown + port range + alias dropdown
- Destination: same
- Advanced: connection limit, rate limit, time schedule, log toggle, mark/DSCP
- Description: text

---

## 10. System Log Page

### Layout

Full-page log viewer with:

**Filters (top bar):**
- Severity: Emergency | Alert | Critical | Error | Warning | Notice | Info | Debug (multi-select checkboxes)
- Facility: dropdown (kern, daemon, auth, etc.)
- Search: text input filtering log message content
- Time range: datepicker or quick select

**Log table:**
| Timestamp | Severity | Facility | Message |
|-----------|----------|----------|---------|
| 14:23:01 | warning | kernel | nf_conntrack: table full, dropping packet |
| 14:22:58 | info | hostapd | wlan0: STA aa:bb:cc:dd:ee:ff IEEE 802.11: associated |
| 14:22:45 | notice | dnsmasq | query[A] example.com from 192.168.1.101 |

- Severity badges: red (error+), amber (warning), blue (info), gray (debug)
- **Auto-tail mode**: checkbox to auto-scroll to new entries (like `tail -f`)
- **Export**: download as text file
- **Clear log**: button (with confirmation)
- **Click a log entry**: expands to show full multi-line message if truncated

**Data source**: `ubus call log read` with filtering parameters, polled every 2 seconds when page is active.

---

## 11. Settings: WiFi

### SSID List View

Cards showing each configured WiFi network:

```
┌─────────────────────────────────────────────────────┐
│  MyNetwork-5G                              [Toggle] │
│  ●●●●●●●● (password hidden)        [Show] [Copy]  │
│  5 GHz  •  WPA3  •  VLAN: Default  •  14 clients   │
│                                         [Edit] [⋮]  │
└─────────────────────────────────────────────────────┘
```

`[+ Create WiFi Network]` button at top.

### SSID Editor (full page, replaces list)

**Simple Mode (default):**

| Field | Control | Default |
|-------|---------|---------|
| Network Name | Text input | — |
| Password | Password input with show/generate | — |
| Network | Dropdown (Default, Guest, IoT, + custom VLANs) | Default |
| Band | Checkbox group: 2.4 GHz / 5 GHz / 6 GHz | All available |

**Advanced Mode (accordion sections, collapsed by default):**

**Security:**
| Field | Control | Default |
|-------|---------|---------|
| Protocol | Dropdown: WPA2, WPA2/WPA3, WPA3, WPA2 Enterprise, WPA3 Enterprise, Open | WPA2/WPA3 |
| PMF (802.11w) | Dropdown: Disabled, Optional, Required | Optional |
| Group Rekey Interval | Number input (seconds) | 3600 |
| Fast Roaming (802.11r) | Toggle | Off |
| BSS Transition (802.11v) | Toggle | Off |
| SAE Anti-clogging Threshold | Number input | 5 |
| RADIUS server | IP + port + secret (if Enterprise) | — |
| MAC Filter | Toggle + Allow/Block list with MAC input | Off |

**Performance:**
| Field | Control | Default |
|-------|---------|---------|
| Band Steering | Toggle | Off |
| Minimum Data Rate | Dropdown: Auto, 1, 6, 11, 24 Mbps | Auto |
| UAPSD (WMM Power Save) | Toggle | On |
| Airtime Fairness | Toggle | Off |
| Bandwidth Limit | Toggle + download/upload inputs | Off |
| Client Limit | Number input (0 = unlimited) | 0 |

**Privacy:**
| Field | Control | Default |
|-------|---------|---------|
| Hide SSID | Toggle | Off |
| Client Isolation | Toggle | Off |
| Proxy ARP | Toggle | Off |

**Multicast:**
| Field | Control | Default |
|-------|---------|---------|
| Multicast Enhancement | Toggle | Off |
| Multicast/Broadcast Control | Toggle + exception list | Off |
| IGMP Snooping | Toggle | On |

**Schedule:**
| Field | Control | Default |
|-------|---------|---------|
| WiFi Schedule | Toggle + weekly grid painter | Always On |

The weekly grid painter is a 7×24 grid (days × hours). Click-and-drag to paint "off" time slots. Green = active, dark = disabled. From Synology SRM's excellent time scheduling UX.

**Guest Network Options** (shown only if network type is Guest):
| Field | Control | Default |
|-------|---------|---------|
| Captive Portal | Toggle | Off |
| Portal Page | Rich text editor for splash page | Default template |
| Terms of Service | Text area | — |
| Session Duration | Dropdown (1h, 4h, 24h, unlimited) | Unlimited |
| Bandwidth Limit | Download/Upload inputs | — |
| Access to LAN | Toggle | Off (isolated) |

---

## 12. Settings: Networks

### Network List View

Cards showing each configured network/VLAN:

```
┌─────────────────────────────────────────────────────┐
│  Default (LAN)                                      │
│  VLAN: 1  •  192.168.1.0/24  •  DHCP: On           │
│  Gateway: 192.168.1.1  •  18 clients                │
│                                         [Edit] [⋮]  │
└─────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────┐
│  Guest                                              │
│  VLAN: 10  •  192.168.10.0/24  •  DHCP: On         │
│  Gateway: 192.168.10.1  •  3 clients  •  Isolated   │
│                                         [Edit] [⋮]  │
└─────────────────────────────────────────────────────┘
```

`[+ Create Network]` button at top.

### Network Editor

**Simple Mode:**

| Field | Control | Default |
|-------|---------|---------|
| Name | Text input | — |
| Purpose | Dropdown: Standard, Guest, IoT | Standard |
| VLAN ID | Number (auto-suggested) | Next available |
| Subnet | IP/CIDR input (e.g., 192.168.10.0/24) | Auto-calculated |
| Gateway | IP input (auto-filled as .1 of subnet) | Auto |
| DHCP | Toggle | On |

**Advanced Mode:**

**DHCP Settings:**
| Field | Control |
|-------|---------|
| Range Start | IP input |
| Range End | IP input |
| Lease Time | Dropdown: 1h, 6h, 12h, 24h, 7d, custom |
| DNS Servers | Multiple IP inputs (default: router IP) |
| Domain Name | Text input |
| Static Leases | Table: Hostname, MAC, IP, Lease Time + Add button |
| DHCP Options | Key-value table for custom options |

**Advanced Network:**
| Field | Control |
|-------|---------|
| IPv6 | Toggle + RA/DHCPv6/SLAAC options |
| IGMP Snooping | Toggle |
| mDNS Repeater | Toggle (relay mDNS across VLANs) |
| Bridge Members | Multi-select of physical ports |
| MTU | Number input |
| STP (Spanning Tree) | Toggle |

**Isolation:**
| Field | Control |
|-------|---------|
| Inter-VLAN Routing | Toggle (enable/disable routing to other VLANs) |
| Internet Access | Toggle |
| Accessible Services | Checkboxes: DNS, NTP, DHCP (when isolated) |

---

## 13. Settings: Internet (WAN)

**Simple Mode:**

| Field | Control | Default |
|-------|---------|---------|
| Connection Type | Dropdown: Automatic (DHCP), PPPoE, Static IP | DHCP |
| PPPoE Username | Text (if PPPoE) | — |
| PPPoE Password | Password (if PPPoE) | — |
| Static IP / Gateway / DNS | IP inputs (if Static) | — |

**Advanced Mode:**

**IPv4:**
| Field | Control |
|-------|---------|
| MAC Clone | Toggle + MAC input |
| MTU | Number |
| Custom DNS | Toggle + DNS server IP inputs |
| VLAN Tag | Toggle + VLAN ID (for tagged WAN ports) |

**IPv6:**
| Field | Control |
|-------|---------|
| IPv6 Mode | Dropdown: Auto, DHCPv6, 6in4, 6to4, Disabled |
| Prefix Delegation | Toggle + prefix length |
| DNS64 | Toggle |

**Multi-WAN** (if multiple WAN interfaces exist):
| Field | Control |
|-------|---------|
| Mode | Dropdown: Failover, Load Balance |
| Primary WAN | Interface dropdown |
| Health Check | Target IP + interval + threshold |

**QoS / Smart Queues:**
| Field | Control |
|-------|---------|
| SQM (Smart Queue Management) | Toggle |
| Download Bandwidth | Number (Mbps) — should be ~85% of actual |
| Upload Bandwidth | Number (Mbps) |
| Queue Discipline | Dropdown: cake, fq_codel |
| Link Layer | Dropdown: Ethernet, ATM, None |

**Speed Test:**
- Embedded speed test button
- Shows download, upload, latency results
- History chart of past results
- Auto-schedule option (daily/weekly)

---

## 14. Settings: VPN

VPN is a **first-class nav item** (from GL.iNet's approach), not buried in settings.

### VPN Dashboard

Shows all configured VPN connections at a glance:

```
┌─────────────────────────────────────────────────────┐
│  WireGuard Server                    ● Running      │
│  Port: 51820  •  2 connected peers                   │
│  Throughput: ▼ 4.2 Mbps  ▲ 1.1 Mbps                │
│                                    [Configure] [⋮]  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Mullvad VPN (WireGuard Client)      ● Connected    │
│  Endpoint: 198.54.131.40:51820  •  Uptime: 4d 12h  │
│  Throughput: ▼ 12.4 Mbps  ▲ 847 Kbps               │
│                                    [Configure] [⋮]  │
└─────────────────────────────────────────────────────┘
```

### WireGuard Server Setup

**Simple Mode:**
| Field | Control |
|-------|---------|
| Enable | Toggle |
| Listen Port | Number (default: 51820) |
| Peers | List with [+ Add Peer] button |

**Per-peer:**
| Field | Control |
|-------|---------|
| Name | Text |
| Allowed IPs | CIDR input |
| Generate Config | Button → shows QR code + downloadable .conf file |

**Advanced Mode:**
| Field | Control |
|-------|---------|
| Private Key | Auto-generated, shown as masked input |
| Address | CIDR input |
| DNS | IP input |
| MTU | Number |
| Pre/Post Up/Down Scripts | Text area |
| Keepalive | Number (seconds) |

### WireGuard/OpenVPN Client

**Simple Mode:**
- **Drag and drop config file** (from GL.iNet) — accepts `.conf` (WireGuard) or `.ovpn` (OpenVPN)
- Parses the file and auto-fills all fields
- Or paste config text into a text area
- One-click connect/disconnect

**Advanced Mode:**
Full manual field entry for endpoint, keys, allowed IPs, routing table, kill switch toggle.

### VPN Policy Routing

Table of rules determining which traffic goes through VPN:

| Source | Destination | VPN | Action |
|--------|-------------|-----|--------|
| All Clients | * | Mullvad | Route through VPN |
| Gaming Console | * | — | Bypass VPN (direct) |
| Work Laptop | 10.0.0.0/8 | Office VPN | Route through VPN |

---

## 15. Settings: Firewall & Security

### Zones

Visual zone diagram + table:

```
         ┌───────┐
    ┌────│  WAN  │────┐
    │    └───────┘    │
    │    ┌───────┐    │
    ├────│  LAN  │────┤
    │    └───────┘    │
    │    ┌───────┐    │
    └────│ Guest │────┘
         └───────┘
```

Arrows show forwarding rules between zones. Green = accept, red = reject/drop.

**Zone table:**

| Zone | Input | Output | Forward | Networks | Masquerading |
|------|-------|--------|---------|----------|-------------|
| LAN | Accept | Accept | Accept | Default, IoT | No |
| WAN | Reject | Accept | Reject | WAN | Yes |
| Guest | Reject | Accept | Reject | Guest | Yes |

Click a zone → edit default policies, member networks, masquerading, MSS clamping.

### Port Forwards

| Name | Protocol | External Port | Internal IP | Internal Port | Enabled |
|------|----------|--------------|-------------|---------------|---------|
| NAS Web | TCP | 8443 | 192.168.1.50 | 443 | ● |
| Plex | TCP | 32400 | 192.168.1.50 | 32400 | ● |

`[+ Add Port Forward]` button → form with source zone, protocol, ext/int port, internal IP (dropdown of known clients or manual input).

### Intrusion Prevention

If available via packages:
| Field | Control |
|-------|---------|
| Enable IPS/IDS | Toggle |
| Mode | Dropdown: IDS (detect only), IPS (detect + block) |
| Ruleset | Dropdown: ET Open, Snort Community |
| Sensitivity | Slider: Low / Medium / High / Custom |

### Security Advisor (from Synology SRM)

A dedicated sub-page that scans configuration and shows a security checklist:

```
Security Score: 78/100

✓ Admin password is strong
✓ SSH uses key authentication
✕ Firmware is 47 days old — [Update Now]
✕ UPnP is enabled — [Disable]
✓ WPA3 enabled on all SSIDs
✕ Default SSID name in use — [Change]
✓ DNS over TLS configured
✕ 3 unused port forwards — [Review]
✓ Guest network is isolated
```

Each item has an explanation + one-click fix action.

### Aliases / Groups (from pfSense)

Named sets reusable in firewall rules:

| Name | Type | Members | Used By |
|------|------|---------|---------|
| IoT_Devices | IP Group | 192.168.1.50, .51, .52, .60-70 | 3 rules |
| Blocked_Ads | Domain Group | ads.example.com, tracking.co | 1 rule |
| Gaming_Ports | Port Group | 3074, 3478-3480, 27015-27030 | 2 rules |

---

## 16. Settings: Routing

### Static Routes

Table:
| Destination | Gateway | Interface | Metric | Enabled |
|-------------|---------|-----------|--------|---------|
| 10.0.0.0/8 | 192.168.1.254 | LAN | 100 | ● |
| 0.0.0.0/0 | via WAN | WAN | 0 | ● |

### Routing Table (read-only)

Current kernel routing table displayed in a readable format.

### Policy Routing

Rules for source-based routing (multi-WAN, VPN routing):
| Priority | Source | Destination | Table | Description |
|----------|--------|-------------|-------|-------------|
| 100 | 192.168.10.0/24 | * | vpn | Guest via VPN |
| 200 | * | 10.0.0.0/8 | main | Office network |

---

## 17. Settings: DNS

### DNS Server Configuration

**Simple Mode:**
| Field | Control |
|-------|---------|
| DNS Provider | Dropdown: Automatic (ISP), Cloudflare (1.1.1.1), Google (8.8.8.8), Quad9 (9.9.9.9), Custom |
| DNS over TLS | Toggle (uses Cloudflare/Google DoT endpoints) |
| Ad Blocking | Toggle (uses built-in dnsmasq domain blocking) |

**Advanced Mode:**

**Upstream DNS:**
| Field | Control |
|-------|---------|
| Primary DNS | IP input |
| Secondary DNS | IP input |
| DNS over TLS | Toggle + server name for SNI |
| DNSSEC | Toggle |
| DNS Caching | Toggle + cache size |
| DNS Rebinding Protection | Toggle |

**Local DNS:**
| Field | Control |
|-------|---------|
| Local Domain | Text (e.g., `lan`) |
| Local DNS Records | Table: Hostname, IP, Type (A/AAAA/CNAME) |
| Override records | Table: domain → IP (for split-horizon DNS) |

**Ad/Tracker Blocking:**
| Field | Control |
|-------|---------|
| Enable | Toggle |
| Block Lists | Multi-select with URLs (presets: Steven Black, EasyList, etc.) |
| Whitelist | Domain list |
| Blacklist | Additional domain list |
| Update Schedule | Dropdown (daily, weekly) |

**Stats:**
- Total queries today
- Blocked queries (with percentage)
- Top queried domains
- Top blocked domains
- Query rate over time graph

---

## 18. Settings: Profiles

Reusable configuration objects referenced elsewhere.

### Bandwidth Profiles

| Name | Download | Upload | Used By |
|------|----------|--------|---------|
| Standard | Unlimited | Unlimited | Default network |
| Guest | 50 Mbps | 10 Mbps | Guest network |
| IoT | 10 Mbps | 5 Mbps | IoT network |
| Kids | 25 Mbps | 10 Mbps | Kids client group |

### IP Groups (Aliases)

Table of named IP/subnet groups usable in firewall rules. Same as Aliases in the Firewall section — this is the management view.

### Port Groups

Named sets of ports (e.g., "Web Ports" = 80, 443, 8080).

### Client Groups

Named groups of clients by MAC or IP for applying policies:
| Name | Members | Policies Applied |
|------|---------|------------------|
| Kids | iPad, Chromebook | Bandwidth: Kids, Schedule: School Hours |
| IoT | Ring Doorbell, Nest, Hue Bridge | Network: IoT VLAN |
| Work | MacBook Pro, Monitor | VPN: Office |

### Schedule Profiles

Reusable time schedules (weekly grid) that can be applied to WiFi SSIDs, client groups, firewall rules, etc.

---

## 19. Settings: System

### General

| Field | Control |
|-------|---------|
| Hostname | Text input |
| Timezone | Dropdown (searchable, grouped by region) |
| NTP Servers | Multiple text inputs (defaults: openwrt pool) |
| LED Control | Toggle per LED (power, WiFi, LAN, etc.) |

### Administration

| Field | Control |
|-------|---------|
| Router Password | Change password form (current + new + confirm) |
| SSH | Toggle + port input + key-only toggle |
| Authorized SSH Keys | Text area for public keys |
| Web UI Port | Number (default: 80/443) |
| HTTPS | Toggle + certificate management |

### Backup & Restore

- **Download Backup**: button → downloads `/etc/config` archive
- **Restore Backup**: file upload → restores config
- **Factory Reset**: button with confirmation dialog → calls `rpc-sys factory`

### Firmware

- **Current Version**: display with build date
- **Check for Update**: button → queries ASU (Attended Sysupgrade) server
- **Upgrade**:
  - Upload firmware file
  - Or one-click upgrade from ASU (preserves installed packages)
  - Keep settings toggle
  - Progress bar during flash
  - Automatic reconnect after reboot
- **Release Notes**: collapsible section showing changelog

### Reboot

- **Reboot**: button with 3-second countdown and confirmation
- **Scheduled Reboot**: toggle + time picker (weekly maintenance window)

### Diagnostics

Built-in network diagnostic tools:
- **Ping**: target input + count + results display
- **Traceroute**: target + max hops + results
- **DNS Lookup**: domain input + server + query type + results
- **Speed Test**: WAN speed test with results
- **Network Connections**: live conntrack table (sortable, searchable)

---

## 20. Settings: Packages

### Installed Packages

Searchable, sortable table:
| Package | Version | Size | Description | Actions |
|---------|---------|------|-------------|---------|
| dnsmasq-full | 2.90-1 | 420 kB | DNS/DHCP server | [Remove] |
| firewall4 | 2024.09.15 | 85 kB | nftables firewall | — (system) |
| kmod-nft-nat | 6.6.74 | 12 kB | NAT kernel module | — (system) |

### Available Packages

- Search input
- Category filter: All, Network, Wireless, VPN, Monitoring, Utilities
- Package cards showing name, description, size, install button
- Dependency resolution shown before install

### Update

- **Update package lists**: button (runs `apk update`)
- **Upgrade all**: button showing count of upgradable packages
- Per-package upgrade in the installed table

---

## 21. Setup Wizard

First-run experience when no configuration exists (or triggered from Settings > System).

### Multi-step flow (from Omada / Eero):

**Step 1: Welcome**
- Laubter logo + "Let's set up your router"
- Language selector (if multiple languages supported)

**Step 2: Internet Connection**
- Auto-detect connection type (DHCP, PPPoE, Static)
- If PPPoE: username/password fields
- If Static: IP/Gateway/DNS fields
- Connection test with success/failure indicator

**Step 3: WiFi Networks**
- Network name (SSID)
- Password (with strength indicator + generate button)
- Band selection (checkboxes)
- Optional: create a separate Guest network (toggle + name/password)

**Step 4: Router Password**
- Set admin password (with strength indicator)
- Warning about not using the same password as WiFi

**Step 5: Summary & Apply**
- Review all settings in a clean summary card
- "Apply & Connect" button
- Progress indicator while settings are applied
- Instructions to reconnect to the new WiFi network
- QR code for the new WiFi network (for easy mobile connection — from Eero)

---

## 22. Interaction Patterns

### Slide-Out Detail Panel

- **Trigger**: click a row in any table (clients, firewall rules, leases, etc.)
- **Position**: slides in from right edge, 400px wide (50% width on mobile)
- **Animation**: 200ms ease-out slide + fade
- **Backdrop**: semi-transparent overlay on the table (click to close)
- **Close**: X button, Escape key, click backdrop
- **Persistence**: opening a new panel closes the previous one (no stacking)
- **Tabs within panel**: underlined tab bar at panel top

### Toasts / Notifications

- **Position**: bottom-right corner, stacked
- **Types**: success (green), error (red), warning (amber), info (blue)
- **Behavior**: auto-dismiss after 5s (errors persist), click to dismiss, "Undo" action for destructive operations
- **Examples**:
  - "Settings saved successfully" (success, auto-dismiss)
  - "Client blocked: Samsung-TV" (info, with Undo)
  - "Failed to apply firewall rules: syntax error on line 12" (error, persistent)

### Config Apply Flow (Safe Apply — from UCI)

When any setting is changed:
1. Changes are staged (not applied immediately)
2. **"Apply Changes"** button appears as a sticky bar at page bottom: `You have unsaved changes. [Discard] [Apply]`
3. Clicking Apply triggers `uci apply` with a **30-second rollback timer**
4. A countdown toast appears: "Settings applied. Confirming in 28s... [Confirm] [Revert]"
5. If the user can still reach the UI, they click Confirm (or it auto-confirms after the countdown)
6. If the settings broke connectivity, the router auto-reverts after 30 seconds

This prevents lockout from bad network configuration.

### Command Palette (Cmd+K / Ctrl+K)

- Opens a modal with a search input
- Searches across: pages, settings, clients, actions
- Results grouped by category: Navigation, Clients, Settings, Actions
- Keyboard navigable (arrow keys + Enter)
- Recent items shown when empty
- Actions: "Reboot router", "Run speed test", "Export backup", "Toggle dark mode"

### Simple/Advanced Toggle

- Located at the top-right of each settings page
- Two states: "Simple" (toggle left) and "Advanced" (toggle right)
- In Simple mode: only essential fields shown
- In Advanced mode: additional accordion sections appear below the simple fields
- Toggle state is remembered per page in localStorage
- Animation: accordion sections expand/collapse with 200ms ease

### Tables

- **Row hover**: subtle background change (surface-700)
- **Row click**: opens detail panel
- **Sorting**: click column header, arrow indicator shows direction. Second click reverses. Third click removes sort.
- **Empty state**: centered illustration + message + action button (e.g., "No clients connected. Check your WiFi settings.")
- **Loading state**: skeleton rows (pulsing rectangles matching column widths)

### Forms

- **Labels**: above inputs, in body weight, text-secondary color
- **Help text**: below inputs, in caption size, text-muted color
- **Validation**: inline, shown on blur. Red border + error message below input.
- **Required fields**: no asterisk — instead, optional fields are labeled "(optional)"
- **Disabled fields**: reduced opacity, not-allowed cursor, tooltip explaining why
- **Dropdowns**: searchable when >8 items

---

## 23. Responsive & Mobile

### Breakpoints

| Name | Width | Layout changes |
|------|-------|----------------|
| Desktop | ≥1280px | Full layout, sidebar + content |
| Tablet | 768-1279px | Sidebar collapsed (icons), narrower cards |
| Mobile | <768px | Sidebar hidden (hamburger), stacked cards, panels full-width |

### Mobile-specific adaptations

- **Sidebar**: hidden, opens as overlay from left on hamburger tap
- **Dashboard**: widgets stack single-column
- **Tables**: horizontal scroll with first column (Name) frozen
- **Detail panels**: full-screen overlay instead of side panel
- **Charts**: simplified (fewer data points, larger touch targets)
- **Top bar**: hamburger + logo + notification bell only
- **Settings sub-nav**: collapses to a dropdown selector
- **Touch targets**: minimum 44×44px for all interactive elements

### Progressive Web App (PWA)

- **manifest.json**: app name, icons, theme color, display: standalone
- **Service worker**: cache static assets for instant reload (not for API responses)
- **Install prompt**: banner on mobile suggesting "Add to Home Screen"
- Result: behaves like a native app when installed from mobile browser

---

## 24. API Layer & Data Sources

### ubus JSON-RPC Client

The frontend communicates exclusively through OpenWrt's `rpcd` daemon via HTTP POST to `/ubus`.

**Authentication:**
```typescript
// Login → get session token
POST /ubus
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "call",
  "params": ["00000000000000000000000000000000", "session", "login",
             {"username": "root", "password": "***"}]
}
// Response: { result: [0, { ubus_rpc_session: "abc123...", timeout: 300 }] }
```

**Subsequent calls use session token:**
```typescript
POST /ubus
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "call",
  "params": ["abc123...", "system", "info", {}]
}
```

### Data Source Map

| UI Section | ubus Call | Poll Interval |
|-----------|-----------|---------------|
| System status | `system.board`, `system.info` | 5s |
| Network interfaces | `network.interface dump` | 5s |
| Interface stats (bandwidth) | `network.device status` | 1s |
| Wireless radios | `network.wireless status` | 10s |
| Wireless clients | `hostapd.*.get_clients`, `iwinfo assoclist` | 3s |
| WiFi scan | `iwinfo scan` | On demand |
| Channel survey | `iwinfo survey` | 30s |
| DHCP leases | `dhcp.ipv4leases`, `dhcp.ipv6leases` | 10s |
| Firewall config | `uci get {"config":"firewall"}` | On demand |
| All settings R/W | `uci get/set/commit/apply` | On demand |
| Conntrack count | `file.read /proc/sys/net/netfilter/nf_conntrack_count` | 5s |
| Bandwidth history | `file.exec nlbw -c json` | 30s |
| System log | `log read` | 2s (when page active) |
| Package list | `rpc-sys packagelist` | On demand |
| Firmware upgrade | `rpc-sys upgrade_test/start` + cgi-io | On demand |
| Reboot | `system.reboot` | On demand |
| WireGuard peers | `file.exec wg show dump` | 10s |
| CPU detail | `file.read /proc/stat` | 2s |
| Speed test | `file.exec` with speedtest-cli | On demand |
| Service management | `rc list`, `rc init` | On demand |

### Custom rpcd Plugins Needed

We need 4 rpcd plugins (shell/ucode scripts in `/usr/libexec/rpcd/`) to replicate what LuCI's `luci-mod-rpc` provides, plus fill additional gaps:

1. **`laubter-network`**: Replaces `luci-rpc.getNetworkDevices`. Merges `/sys/class/net/` stats with ubus device data, detects DSA ports, reads `/etc/board.json` for hardware port layout. Returns unified device inventory JSON.

2. **`laubter-wireless`**: Replaces `luci-rpc.getWirelessDevices`. Combines `iwinfo` + `hostapd` + UCI wireless config into a single response per radio with clients, signal quality, and channel data.

3. **`laubter-hosts`**: Replaces `luci-rpc.getHostHints`. Merges DHCP leases + ARP table + IPv6 neighbor discovery + WiFi assoclist + mDNS cache into a unified device identity database. Adds OUI-based manufacturer lookups.

4. **`laubter-firewall`**: New (no LuCI equivalent). Wraps `nft list ruleset` and parses active connection counts per rule via conntrack. Returns structured JSON for the firewall activity feed.

These are installed as part of the Laubter APK package. They are critical — LuCI's research showed that raw ubus calls alone are insufficient; you need server-side aggregation to avoid excessive HTTP round-trips and complex client-side joins.

### RPC Call Batching (ported from LuCI.rpc)

Our ubus client implements **automatic request batching** (ported from LuCI's `rpc.declare()` pattern):

```typescript
// Declaration (like LuCI's rpc.declare)
const getSystemInfo = ubus.declare({
    object: 'system',
    method: 'info',
    expect: {}
});

const getInterfaceDump = ubus.declare({
    object: 'network.interface',
    method: 'dump',
    expect: { interface: [] }
});

// These two calls are automatically batched into ONE HTTP request
const [sysInfo, interfaces] = await Promise.all([
    getSystemInfo(),
    getInterfaceDump()
]);
```

When multiple declared calls execute within the same microtask, they are combined into a JSON-RPC batch request — a single HTTP POST returning all results. This is how LuCI achieves fast page loads despite needing 10+ ubus calls for the dashboard.

### Session Management

- Session tokens expire after 300s (configurable in rpcd)
- The frontend refreshes the session on every API call (piggyback on `params[0]`)
- If a call returns error code 6 (permission denied), redirect to login page
- Login page: simple username/password form, no "remember me" (sessions are short-lived for security)

---

## 25. APK Packaging

### Package Structure

```
laubter-ui.apk (gzipped tar)
├── .PKGINFO
├── .control/
│   ├── control
│   └── postinst
├── usr/
│   └── share/
│       └── laubter/
│           ├── index.html
│           ├── assets/
│           │   ├── app-[hash].js       (~140 kB gzipped)
│           │   ├── app-[hash].css      (~20 kB gzipped)
│           │   └── oui-database.json   (~200 kB gzipped, MAC manufacturer DB)
│           ├── manifest.json
│           └── favicon.svg
├── usr/
│   └── libexec/
│       └── rpcd/
│           ├── laubter-network
│           ├── laubter-wireless
│           ├── laubter-hosts
│           └── laubter-firewall
└── usr/
    └── share/
        └── rpcd/
            └── acl.d/
                └── laubter.json          (ACL permissions)
```

### .PKGINFO

```
pkgname = laubter-ui
pkgver = 1.0.0-r1
arch = all
size = 450000
pkgdesc = Modern web interface for OpenWrt
url = https://github.com/user/laubter-ui
license = MIT
depend = uhttpd rpcd rpcd-mod-file rpcd-mod-iwinfo
```

### .control/control

```
Package: laubter-ui
Version: 1.0.0-r1
Architecture: all
Depends: uhttpd, rpcd, rpcd-mod-file, rpcd-mod-iwinfo
Description: Laubter - Modern web UI for OpenWrt
 A modern, UniFi-inspired web interface for OpenWrt routers.
 Replaces LuCI with a fast, dark-themed single-page application.
Maintainer: Your Name <email>
Section: luci
```

### .control/postinst

```sh
#!/bin/sh

# Add uhttpd config for Laubter UI
if ! uci -q get uhttpd.laubter > /dev/null; then
    uci batch <<-EOF
        set uhttpd.laubter=uhttpd
        set uhttpd.laubter.home='/usr/share/laubter'
        set uhttpd.laubter.listen_http='0.0.0.0:3000'
        set uhttpd.laubter.listen_https='0.0.0.0:3443'
        set uhttpd.laubter.ubus_prefix='/ubus'
        set uhttpd.laubter.max_requests='3'
        set uhttpd.laubter.cert='/etc/uhttpd.crt'
        set uhttpd.laubter.key='/etc/uhttpd.key'
        commit uhttpd
EOF
fi

# Restart services
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

exit 0
```

### Build Script (runs on Mac)

```bash
#!/bin/bash
set -euo pipefail

VERSION="1.0.0-r1"

# Build the SPA
cd frontend
npm run build    # outputs to dist/

# Assemble APK structure
cd ..
rm -rf build/apk
mkdir -p build/apk/usr/share/laubter
mkdir -p build/apk/usr/libexec/rpcd
mkdir -p build/apk/usr/share/rpcd/acl.d
mkdir -p build/apk/.control

# Copy frontend assets
cp -r frontend/dist/* build/apk/usr/share/laubter/

# Copy rpcd plugins
cp rpcd-plugins/* build/apk/usr/libexec/rpcd/
chmod +x build/apk/usr/libexec/rpcd/*

# Copy ACL
cp acl/laubter.json build/apk/usr/share/rpcd/acl.d/

# Generate .PKGINFO
cat > build/apk/.PKGINFO <<EOF
pkgname = laubter-ui
pkgver = ${VERSION}
arch = all
size = $(du -sb build/apk/usr | cut -f1)
pkgdesc = Modern web interface for OpenWrt
url = https://github.com/user/laubter-ui
license = MIT
depend = uhttpd
depend = rpcd
depend = rpcd-mod-file
depend = rpcd-mod-iwinfo
EOF

# Generate control
cat > build/apk/.control/control <<EOF
Package: laubter-ui
Version: ${VERSION}
Architecture: all
Depends: uhttpd, rpcd, rpcd-mod-file, rpcd-mod-iwinfo
Description: Laubter - Modern web UI for OpenWrt
Maintainer: Developer <dev@example.com>
Section: luci
EOF

# Copy postinst
cp packaging/postinst build/apk/.control/postinst
chmod +x build/apk/.control/postinst

# Create APK (gzipped tar)
cd build/apk
tar -czf ../../dist/laubter-ui_${VERSION}.apk .PKGINFO .control usr
cd ../..

echo "Built: dist/laubter-ui_${VERSION}.apk"
echo "Install on router: scp dist/laubter-ui_${VERSION}.apk root@router:/tmp/ && ssh root@router 'apk add --allow-untrusted /tmp/laubter-ui_${VERSION}.apk'"
```

---

## Appendix: File Structure

```
openwrt-ui/
├── SPEC.md                          # This file
├── frontend/
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── app.html
│   │   ├── app.css                  # Theme tokens, Tailwind imports
│   │   ├── lib/
│   │   │   ├── api/
│   │   │   │   ├── ubus.ts          # ubus JSON-RPC client with auto-batching (ported from LuCI.rpc)
│   │   │   │   ├── session.ts       # Auth / session management with interceptors
│   │   │   │   └── types.ts         # TypeScript types for all ubus responses
│   │   │   ├── components/
│   │   │   │   ├── ui/              # shadcn-svelte components (button, card, input, etc.)
│   │   │   │   ├── layout/
│   │   │   │   │   ├── Sidebar.svelte
│   │   │   │   │   ├── TopBar.svelte
│   │   │   │   │   ├── CommandPalette.svelte
│   │   │   │   │   └── DetailPanel.svelte
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── SystemStatus.svelte
│   │   │   │   │   ├── InternetStatus.svelte
│   │   │   │   │   ├── WifiStatus.svelte
│   │   │   │   │   ├── ClientsSummary.svelte
│   │   │   │   │   ├── BandwidthGraph.svelte
│   │   │   │   │   ├── TopClients.svelte
│   │   │   │   │   ├── TrafficCategory.svelte
│   │   │   │   │   ├── FirewallActivity.svelte
│   │   │   │   │   └── WifiChannels.svelte
│   │   │   │   ├── clients/
│   │   │   │   │   ├── ClientTable.svelte
│   │   │   │   │   ├── ClientDetail.svelte
│   │   │   │   │   ├── SignalBars.svelte
│   │   │   │   │   └── DeviceIcon.svelte
│   │   │   │   ├── network/
│   │   │   │   │   ├── PortDiagram.svelte
│   │   │   │   │   ├── InterfaceCard.svelte
│   │   │   │   │   └── PortDetail.svelte
│   │   │   │   ├── traffic/
│   │   │   │   │   ├── ActivityFeed.svelte
│   │   │   │   │   ├── ActivityCard.svelte
│   │   │   │   │   ├── TrafficRules.svelte
│   │   │   │   │   ├── FirewallRules.svelte
│   │   │   │   │   ├── RuleEditor.svelte
│   │   │   │   │   └── AliasEditor.svelte
│   │   │   │   ├── settings/
│   │   │   │   │   ├── wifi/
│   │   │   │   │   │   ├── SsidList.svelte
│   │   │   │   │   │   ├── SsidEditor.svelte
│   │   │   │   │   │   └── ScheduleGrid.svelte
│   │   │   │   │   ├── networks/
│   │   │   │   │   │   ├── NetworkList.svelte
│   │   │   │   │   │   └── NetworkEditor.svelte
│   │   │   │   │   ├── internet/
│   │   │   │   │   │   ├── WanConfig.svelte
│   │   │   │   │   │   ├── QosConfig.svelte
│   │   │   │   │   │   └── SpeedTest.svelte
│   │   │   │   │   ├── vpn/
│   │   │   │   │   │   ├── VpnDashboard.svelte
│   │   │   │   │   │   ├── WireguardServer.svelte
│   │   │   │   │   │   ├── VpnClient.svelte
│   │   │   │   │   │   └── PolicyRouting.svelte
│   │   │   │   │   ├── firewall/
│   │   │   │   │   │   ├── Zones.svelte
│   │   │   │   │   │   ├── PortForwards.svelte
│   │   │   │   │   │   └── SecurityAdvisor.svelte
│   │   │   │   │   ├── routing/
│   │   │   │   │   │   ├── StaticRoutes.svelte
│   │   │   │   │   │   └── PolicyRouting.svelte
│   │   │   │   │   ├── dns/
│   │   │   │   │   │   ├── DnsConfig.svelte
│   │   │   │   │   │   ├── AdBlocking.svelte
│   │   │   │   │   │   └── LocalDns.svelte
│   │   │   │   │   ├── profiles/
│   │   │   │   │   │   ├── BandwidthProfiles.svelte
│   │   │   │   │   │   ├── ClientGroups.svelte
│   │   │   │   │   │   └── Schedules.svelte
│   │   │   │   │   ├── system/
│   │   │   │   │   │   ├── General.svelte
│   │   │   │   │   │   ├── Administration.svelte
│   │   │   │   │   │   ├── BackupRestore.svelte
│   │   │   │   │   │   ├── Firmware.svelte
│   │   │   │   │   │   └── Diagnostics.svelte
│   │   │   │   │   └── packages/
│   │   │   │   │       ├── InstalledPackages.svelte
│   │   │   │   │       └── AvailablePackages.svelte
│   │   │   │   ├── charts/
│   │   │   │   │   ├── UPlotChart.svelte    # uPlot wrapper
│   │   │   │   │   ├── DonutChart.svelte    # LayerChart donut
│   │   │   │   │   ├── BarChart.svelte      # LayerChart bar
│   │   │   │   │   └── Sparkline.svelte     # sparkline-svelte wrapper
│   │   │   │   └── shared/
│   │   │   │       ├── CidrInput.svelte
│   │   │   │       ├── MacInput.svelte
│   │   │   │       ├── PasswordInput.svelte
│   │   │   │       ├── SimpleAdvancedToggle.svelte
│   │   │   │       ├── StatusDot.svelte
│   │   │   │       ├── WeeklySchedule.svelte
│   │   │   │       └── EmptyState.svelte
│   │   │   ├── openwrt/               # Data layer (ported from LuCI.js abstractions)
│   │   │   │   ├── uci.ts            # UCI store: load/cache/set/save/apply with rollback (from LuCI.uci)
│   │   │   │   ├── network.ts        # Network model: Device, Protocol, WifiDevice, WifiNetwork (from LuCI.network)
│   │   │   │   ├── firewall.ts       # Firewall model: Zone, Forwarding, Rule, Redirect + cascading deletes (from LuCI.firewall)
│   │   │   │   ├── protocols/        # Protocol handler registry (from LuCI.network.Protocol)
│   │   │   │   │   ├── registry.ts   # registerProtocol() + dynamic loading
│   │   │   │   │   ├── dhcp.ts       # DHCP client protocol handler
│   │   │   │   │   ├── static.ts     # Static IP protocol handler
│   │   │   │   │   ├── pppoe.ts      # PPPoE protocol handler
│   │   │   │   │   ├── wireguard.ts  # WireGuard protocol handler
│   │   │   │   │   └── types.ts      # Protocol handler interface
│   │   │   │   ├── device.ts         # Device classification: DSA detection, bridge/VLAN synthesis, type inference
│   │   │   │   ├── hosts.ts          # Host hints aggregation: DHCP + ARP + mDNS + assoclist merge
│   │   │   │   └── board.ts          # board.json parser: physical port layout, switch topology
│   │   │   ├── stores/
│   │   │   │   ├── session.ts         # Auth state
│   │   │   │   ├── system.ts          # System info (polled)
│   │   │   │   ├── network.ts         # Interface/device state (polled, uses openwrt/network.ts)
│   │   │   │   ├── wireless.ts        # Radio/client state (polled)
│   │   │   │   ├── clients.ts         # Aggregated client data (uses openwrt/hosts.ts)
│   │   │   │   ├── firewall.ts        # Firewall state (uses openwrt/firewall.ts)
│   │   │   │   ├── uci.ts            # UCI reactive store (wraps openwrt/uci.ts for Svelte reactivity)
│   │   │   │   ├── preferences.ts     # UI state (localStorage)
│   │   │   │   └── polling.ts         # Centralized poll manager
│   │   │   ├── utils/
│   │   │   │   ├── format.ts          # Byte formatting, time formatting
│   │   │   │   ├── oui.ts             # MAC → manufacturer lookup
│   │   │   │   ├── fingerprint.ts     # Device type detection
│   │   │   │   ├── cidr.ts            # IP/CIDR validation & utilities (ported from LuCI datatypes)
│   │   │   │   └── validators.ts      # Input validators: ipaddr, port, hostname, macaddr, etc. (from LuCI.validation)
│   │   │   └── data/
│   │   │       └── oui-mini.json      # Compressed MAC OUI database
│   │   └── routes/
│   │       ├── +layout.svelte         # App shell (sidebar, topbar)
│   │       ├── +page.svelte           # Dashboard
│   │       ├── login/+page.svelte
│   │       ├── clients/+page.svelte
│   │       ├── ports/+page.svelte
│   │       ├── statistics/+page.svelte
│   │       ├── traffic/+page.svelte
│   │       ├── log/+page.svelte
│   │       ├── setup/+page.svelte     # Setup wizard
│   │       └── settings/
│   │           ├── +layout.svelte     # Settings sub-nav
│   │           ├── wifi/+page.svelte
│   │           ├── networks/+page.svelte
│   │           ├── internet/+page.svelte
│   │           ├── vpn/+page.svelte
│   │           ├── firewall/+page.svelte
│   │           ├── routing/+page.svelte
│   │           ├── dns/+page.svelte
│   │           ├── profiles/+page.svelte
│   │           ├── system/+page.svelte
│   │           └── packages/+page.svelte
│   └── static/
│       ├── favicon.svg
│       └── manifest.json
├── rpcd-plugins/
│   ├── laubter-network             # Replaces luci-rpc.getNetworkDevices + getBoardJSON
│   ├── laubter-wireless            # Replaces luci-rpc.getWirelessDevices
│   ├── laubter-hosts               # Replaces luci-rpc.getHostHints + OUI lookup
│   └── laubter-firewall            # New: nft ruleset parser + conntrack stats
├── acl/
│   └── laubter.json                     # rpcd ACL permissions
├── packaging/
│   ├── postinst
│   ├── prerm
│   └── build-apk.sh
└── scripts/
    ├── dev-proxy.js                   # Dev server proxy to router's /ubus
    └── deploy.sh                      # Build + scp + install on router
```
