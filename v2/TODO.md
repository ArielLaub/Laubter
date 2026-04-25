# Laubter v2 — Remaining Work

## Completed (this session)

### VPN Page - DONE
- [x] Peer creation form (name, generate keys, assigned IP)
- [x] QR code generation for mobile WireGuard setup
- [x] Config download (.conf file) per peer
- [x] Peer deletion with confirmation modal
- [x] Copy server public key button
- [x] Server status with connected peers count, online indicators
- [x] DDNS section: enable/disable, provider, domain, token, interval, test

### AdGuard Page - DONE
- [x] 3 tabs: Dashboard, Filters, Query Log
- [x] Protection toggle
- [x] Top queried domains + top blocked domains side by side
- [x] Filter list management (add/remove, toggle individual, rule count)
- [x] Global filtering toggle
- [x] Query Log: search, color-coded blocked rows, scrollable
- [x] Live stats via WebSocket

### Log Page - DONE
- [x] Severity filter buttons (All, Errors, Warnings, Info)
- [x] Export logs to file
- [x] Entry count (filtered/total)

### DHCP Page - Fixes done
- [x] Active leases count bug (showed total, now shows dynamic only)
- [x] "Make Static" button proper styling
- [x] "Expires In" relative time format

### Statistics Page - DONE
- [x] Temperature chart
- [x] Network throughput chart (DL/UL)
- [x] 2x2 chart grid layout
- [x] DL/UL cards with stable width (value + unit separated)
- [x] Server-side history (300 samples) for instant chart seeding

## Remaining polish items

### Statistics Page
- [ ] Time range selector (1H, 6H, 24H) — requires longer server-side storage
- [ ] Connections chart (currently only metric card)
- [ ] Peak/daily stats cards

### AdGuard Page
- [ ] Custom user rules textarea
- [ ] Query log retention settings
- [ ] 24h bar charts for queries/blocked trends

### VPN Page
- [ ] Server settings section (change port, subnet)
- [ ] Enable/disable server toggle

### Log Page
- [ ] Clear logs button

### UI Polish (all pages)
- [ ] Professional design system (consistent component library)
- [ ] Transitions and animations
- [ ] Toast notification system
- [ ] Loading skeleton states
