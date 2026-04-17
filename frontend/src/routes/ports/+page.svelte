<script lang="ts">
	import { call } from '$api/ubus';
	import { onMount } from 'svelte';
	import * as uci from '$openwrt/uci';
	import { formatUptime, formatBytes, formatMac } from '$utils/format';
	import { Globe, Network, ArrowDown, ArrowUp, Shield } from 'lucide-svelte';
	import DetailPanel from '$components/shared/DetailPanel.svelte';

	let loading = $state(true);
	let editPanel = $state(false);
	let editIface = $state<string | null>(null);
	let editForm = $state({ proto: '', ipaddr: '', netmask: '', gateway: '', dns: '', mtu: '', macaddr: '', ip6assign: '' });
	let saving = $state(false);
	let message = $state('');

	let ports = $state<Array<{
		name: string;
		label: string;
		role: string;
		up: boolean;
		speed: string;
		macaddr: string;
		rxBytes: number;
		txBytes: number;
	}>>([]);

	let interfaces = $state<Array<{
		name: string;
		proto: string;
		ipaddr: string;
		device: string;
		up: boolean;
		uptime: number;
	}>>([]);

	async function fetchData() {
		try {
			const [ifDump, devAll] = await Promise.all([
				call<{ interface: any[] }>('network.interface', 'dump', {}),
				call<Record<string, any>>('network.device', 'status', {})
			]);

			const portList: typeof ports = [];

			// WAN port
			const eth1 = devAll['eth1'];
			if (eth1) {
				portList.push({
					name: 'eth1', label: 'WAN', role: 'Internet',
					up: eth1.carrier ?? false,
					speed: eth1.speed || '—',
					macaddr: eth1.macaddr || '',
					rxBytes: eth1.statistics?.rx_bytes || 0,
					txBytes: eth1.statistics?.tx_bytes || 0
				});
			}

			// LAN port
			const eth0 = devAll['eth0'];
			if (eth0) {
				portList.push({
					name: 'eth0', label: 'LAN', role: 'Local Network',
					up: eth0.carrier ?? false,
					speed: eth0.speed || '—',
					macaddr: eth0.macaddr || '',
					rxBytes: eth0.statistics?.rx_bytes || 0,
					txBytes: eth0.statistics?.tx_bytes || 0
				});
			}

			ports = portList;

			interfaces = (ifDump.interface || []).filter((iface: any) => iface.interface !== 'loopback').map((iface: any) => {
				const ipv4 = iface['ipv4-address']?.[0];
				return {
					name: iface.interface || '',
					proto: iface.proto || '',
					ipaddr: ipv4 ? `${ipv4.address}/${ipv4.mask}` : '—',
					device: iface.device || iface.l3_device || '—',
					up: iface.up ?? false,
					uptime: iface.uptime || 0
				};
			});
		} catch (err) {
			console.error('Failed to fetch port data:', err);
		} finally {
			loading = false;
		}
	}

	async function openEdit(ifaceName: string) {
		await uci.load('network');
		const sec = uci.get('network', ifaceName);
		if (!sec) return;
		editIface = ifaceName;
		editForm = {
			proto: (sec.proto as string) ?? 'dhcp',
			ipaddr: (sec.ipaddr as string) ?? '',
			netmask: (sec.netmask as string) ?? '',
			gateway: (sec.gateway as string) ?? '',
			dns: Array.isArray(sec.dns) ? (sec.dns as string[]).join(' ') : (sec.dns as string) ?? '',
			mtu: (sec.mtu as string) ?? '',
			macaddr: (sec.macaddr as string) ?? '',
			ip6assign: (sec.ip6assign as string) ?? ''
		};
		message = '';
		editPanel = true;
	}

	async function saveEdit() {
		if (!editIface) return;
		saving = true;
		message = '';
		try {
			uci.set('network', editIface, 'proto', editForm.proto);
			if (editForm.proto === 'static') {
				if (editForm.ipaddr) uci.set('network', editIface, 'ipaddr', editForm.ipaddr);
				if (editForm.gateway) uci.set('network', editIface, 'gateway', editForm.gateway);
			}
			if (editForm.dns) uci.set('network', editIface, 'dns', editForm.dns.split(/[\s,]+/).filter(Boolean));
			if (editForm.mtu) uci.set('network', editIface, 'mtu', editForm.mtu);
			if (editForm.ip6assign) uci.set('network', editIface, 'ip6assign', editForm.ip6assign);

			await uci.save();
			await uci.apply(30);
			setTimeout(async () => { try { await uci.confirm(); } catch {} }, 5000);
			message = 'Applied. Network restarting...';
			setTimeout(fetchData, 3000);
		} catch (e) {
			message = 'Error: ' + (e instanceof Error ? e.message : 'unknown');
		} finally {
			saving = false;
		}
	}

	const pendingChanges = $derived(uci.hasChanges('network'));

	onMount(() => {
		fetchData();
		const timer = setInterval(fetchData, 5000);
		return () => clearInterval(timer);
	});

	function portIcon(label: string) {
		if (label === 'WAN') return Globe;
		if (label === 'VPN') return Shield;
		return Network;
	}

	function formatLinkSpeed(raw: string): string {
		if (!raw || raw === '—') return '—';
		// Parse "1000F" / "100H" / "2500F" format
		const match = raw.match(/^(\d+)([FH])?$/);
		if (!match) return raw;
		const mbps = parseInt(match[1]);
		const duplex = match[2] === 'F' ? '' : ' Half';
		if (mbps >= 2500) return `2.5 Gbps${duplex}`;
		if (mbps >= 1000) return `1 Gbps${duplex}`;
		if (mbps >= 100) return `100 Mbps${duplex}`;
		if (mbps >= 10) return `10 Mbps${duplex}`;
		return `${mbps} Mbps${duplex}`;
	}

	function portColor(label: string): string {
		if (label === 'WAN') return '#ef4444';
		if (label === 'VPN') return '#006fff';
		return '#22c55e';
	}
</script>

<div class="page">
	<h1>Interfaces</h1>
	<p class="subtitle">Physical ports and network interfaces</p>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<!-- Port Cards -->
		<div class="port-grid">
			{#each ports as port (port.name)}
				{@const Icon = portIcon(port.label)}
				{@const color = portColor(port.label)}
				<div class="port-card">
					<div class="pc-top">
						<div class="pc-icon" style="background: {color}20; color: {color}">
							<Icon size={24} strokeWidth={1.75} />
						</div>
						<div class="pc-title">
							<span class="pc-label">{port.label}</span>
							<span class="pc-role">{port.role}</span>
						</div>
						<div class="pc-status">
							<span class="pc-dot" class:up={port.up}></span>
							<span class="pc-state">{port.up ? 'Connected' : 'Down'}</span>
						</div>
					</div>

					<div class="pc-details">
						<div class="pc-row">
							<span class="pc-dl">Interface</span>
							<span class="pc-dv mono">{port.name}</span>
						</div>
						{#if port.speed && port.speed !== '—'}
							<div class="pc-row">
								<span class="pc-dl">Speed</span>
								<span class="pc-dv">{formatLinkSpeed(port.speed)}</span>
							</div>
						{/if}
						{#if port.macaddr}
							<div class="pc-row">
								<span class="pc-dl">MAC</span>
								<span class="pc-dv mono">{formatMac(port.macaddr)}</span>
							</div>
						{/if}
					</div>

					<div class="pc-traffic">
						<div class="pc-traf-item">
							<ArrowDown size={13} class="dl-icon" />
							<span class="pc-traf-val">{formatBytes(port.rxBytes)}</span>
						</div>
						<div class="pc-traf-item">
							<ArrowUp size={13} class="ul-icon" />
							<span class="pc-traf-val">{formatBytes(port.txBytes)}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Interfaces Table -->
		<h2 class="section-title">Logical Interfaces</h2>
		<div class="table-card">
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Protocol</th>
						<th>IP Address</th>
						<th>Device</th>
						<th>Status</th>
						<th>Uptime</th>
					</tr>
				</thead>
				<tbody>
					{#each interfaces as iface, i (iface.name)}
						<tr class="clickable" onclick={() => openEdit(iface.name)}>
							<td class="cell-name">{iface.name}</td>
							<td>{iface.proto.toUpperCase()}</td>
							<td class="mono">{iface.ipaddr}</td>
							<td class="mono">{iface.device}</td>
							<td>
								<span class="badge" class:up={iface.up} class:down={!iface.up}>
									{iface.up ? 'Up' : 'Down'}
								</span>
							</td>
							<td class="mono">{iface.up ? formatUptime(iface.uptime) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<DetailPanel open={editPanel} title={editIface ? `Edit ${editIface}` : 'Edit Interface'} onClose={() => { editPanel = false; }}>
	{#if editIface}
		<div class="ef">
			<div class="ef-group">
				<label class="ef-label">Protocol</label>
				<select class="ef-input" bind:value={editForm.proto}>
					<option value="dhcp">DHCP Client</option>
					<option value="static">Static Address</option>
					<option value="pppoe">PPPoE</option>
					<option value="wireguard">WireGuard</option>
				</select>
			</div>

			{#if editForm.proto === 'static'}
				<div class="ef-group">
					<label class="ef-label">IP Address / CIDR</label>
					<input type="text" class="ef-input mono" bind:value={editForm.ipaddr} placeholder="192.168.50.1/24" />
				</div>
				<div class="ef-group">
					<label class="ef-label">Gateway</label>
					<input type="text" class="ef-input mono" bind:value={editForm.gateway} placeholder="Optional" />
				</div>
			{/if}

			<div class="ef-group">
				<label class="ef-label">DNS Servers</label>
				<input type="text" class="ef-input mono" bind:value={editForm.dns} placeholder="1.1.1.1 8.8.8.8" />
			</div>
			<div class="ef-group">
				<label class="ef-label">MTU</label>
				<input type="text" class="ef-input mono" bind:value={editForm.mtu} placeholder="Auto (1500)" />
			</div>
			<div class="ef-group">
				<label class="ef-label">IPv6 Prefix Length</label>
				<input type="text" class="ef-input mono" bind:value={editForm.ip6assign} placeholder="60" />
			</div>

			{#if message}
				<div class="ef-msg">{message}</div>
			{/if}

			<button class="ef-save" onclick={saveEdit} disabled={saving}>
				{saving ? 'Applying...' : 'Save & Apply'}
			</button>
		</div>
	{/if}
</DetailPanel>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; max-width: 1400px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: -12px 0 0; }
	.loading { text-align: center; color: var(--color-text-muted); padding: 40px; }

	/* Port Cards */
	.port-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }

	.port-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 12px; padding: 20px;
		display: flex; flex-direction: column; gap: 16px;
		transition: border-color 0.2s;
	}
	.port-card:hover { border-color: var(--color-surface-400); }

	.pc-top { display: flex; align-items: center; gap: 12px; }
	.pc-icon {
		width: 44px; height: 44px; border-radius: 12px;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
	}
	.pc-title { flex: 1; }
	.pc-label { font-size: 18px; font-weight: 700; color: var(--color-text-primary); display: block; }
	.pc-role { font-size: 12px; color: var(--color-text-muted); }

	.pc-status { display: flex; align-items: center; gap: 6px; }
	.pc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); }
	.pc-dot.up { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
	.pc-state { font-size: 12px; color: var(--color-text-secondary); }

	.pc-details { display: flex; flex-direction: column; gap: 6px; }
	.pc-row { display: flex; justify-content: space-between; font-size: 13px; }
	.pc-dl { color: var(--color-text-muted); }
	.pc-dv { color: var(--color-text-primary); }

	.pc-traffic {
		display: flex; gap: 16px; padding-top: 12px;
		border-top: 1px solid var(--color-surface-600);
	}
	.pc-traf-item { display: flex; align-items: center; gap: 6px; font-size: 13px; font-family: var(--font-mono); color: var(--color-text-primary); }
	:global(.dl-icon) { color: #006fff; }
	:global(.ul-icon) { color: #06b6d4; }

	/* Section */
	.section-title { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 8px 0 0; }

	/* Table */
	.table-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; overflow-x: auto;
	}
	table { width: 100%; border-collapse: collapse; }
	thead th {
		text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600;
		color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em;
		border-bottom: 1px solid var(--color-surface-500);
	}
	tbody td {
		padding: 10px 16px; font-size: 14px; color: var(--color-text-primary);
		border-bottom: 1px solid var(--color-surface-700);
	}
	tbody tr:last-child td { border-bottom: none; }
	tbody tr:hover td { background: rgba(255,255,255,0.03); }
	.cell-name { font-weight: 500; }
	.mono { font-family: var(--font-mono); font-size: 13px; }

	.badge {
		display: inline-block; padding: 2px 10px; border-radius: 20px;
		font-size: 12px; font-weight: 500;
	}
	.badge.up { background: rgba(34,197,94,0.15); color: #22c55e; }
	.badge.down { background: rgba(107,114,128,0.15); color: var(--color-text-muted); }

	.clickable { cursor: pointer; }

	/* Edit form in panel */
	.ef { display: flex; flex-direction: column; gap: 14px; }
	.ef-group { display: flex; flex-direction: column; gap: 4px; }
	.ef-label { font-size: 13px; color: var(--color-text-secondary); }
	.ef-input {
		padding: 10px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 14px; font-family: inherit;
		outline: none;
	}
	.ef-input:focus { border-color: var(--color-accent); }
	.ef-input.mono { font-family: var(--font-mono); }
	select.ef-input { cursor: pointer; }
	.ef-msg { font-size: 13px; color: var(--color-success); }
	.ef-save {
		padding: 12px; background: var(--color-accent); color: white;
		border: none; border-radius: 8px; font-size: 14px; font-weight: 500;
		cursor: pointer; font-family: inherit; margin-top: 4px;
	}
	.ef-save:hover:not(:disabled) { background: var(--color-accent-hover); }
	.ef-save:disabled { opacity: 0.6; }
</style>
