# Laubter v2 — Remaining Work

## Critical: Pages below v1 parity

### VPN Page (massive gaps)
- [ ] Peer creation form (name, generate keys, allowed IPs)
- [ ] QR code generation for mobile WireGuard setup
- [ ] Config download (.conf file) per peer
- [ ] Peer deletion with confirmation modal
- [ ] Copy server public key button
- [ ] Server enable/disable toggle
- [ ] Server settings section (collapsible: port, subnet, DNS)
- [ ] DDNS section: enable/disable, provider, domain, token, interval, test connectivity
- [ ] Connected peers count + online indicators with animated pulse
- [ ] Loading states and error handling on all actions
- [ ] Toast notifications for success/error

### AdGuard Page (significant gaps)
- [ ] 3 tabs: Dashboard, Filters, Query Log (currently only 2)
- [ ] Dashboard: sparklines on stat cards, 24h bar charts (queries + blocked)
- [ ] Dashboard: top queried domains list, top clients with DHCP names
- [ ] Filters tab: add/remove filter lists (URL + name), rule count, status
- [ ] Filters tab: global filtering toggle with animated switch
- [ ] Filters tab: custom user rules textarea
- [ ] Filters tab: query log retention settings
- [ ] Query Log: search/filter bar
- [ ] Query Log: row color coding for blocked queries
- [ ] Query Log: auto-scroll, update indicator
- [ ] Protection toggle on dashboard (green/red gradient)

### Statistics Page (minor gaps)
- [ ] Time range selector (1H, 6H, 24H) — currently only live view
- [ ] Peak download and total daily stats cards
- [ ] Connections chart (currently only metric card)

### Log Page (minor gaps)
- [ ] Severity filter buttons (All, Error, Warning, Info, Debug)
- [ ] Export logs to file button
- [ ] Clear logs button
- [ ] Proper severity parsing (not keyword detection)
- [ ] Entry count showing filtered/total

## Server endpoints needed for above
- [ ] VPN: POST /api/vpn/peers (create peer, generate keys)
- [ ] VPN: DELETE /api/vpn/peers/:section
- [ ] VPN: GET /api/vpn/peers/:section/qr (QR code PNG)
- [ ] VPN: GET /api/vpn/peers/:section/config (download .conf)
- [ ] VPN: PUT /api/vpn/server (update server config)
- [ ] VPN: DDNS CRUD endpoints
- [ ] AdGuard: POST /api/dns/toggle-protection
- [ ] AdGuard: POST /api/dns/toggle-filtering
- [ ] AdGuard: CRUD /api/dns/filters
- [ ] AdGuard: PUT /api/dns/user-rules
- [ ] AdGuard: PUT /api/dns/querylog-config

## UI Polish (all pages)
- [ ] Professional design system (consistent component library)
- [ ] Transitions and animations
- [ ] Toast notification system
- [ ] Confirmation modals for destructive actions
- [ ] Loading skeleton states
