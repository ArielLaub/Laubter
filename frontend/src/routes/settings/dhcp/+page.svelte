<script lang="ts">
	import { onMount } from 'svelte';
	import * as uci from '$openwrt/uci';
	import { call } from '$api/ubus';
	import DetailPanel from '$components/shared/DetailPanel.svelte';

	let loading = $state(true);
	let saving = $state(false);
	let applyCountdown = $state(0);
	let tab = $state<'leases' | 'dns' | 'unassigned'>('leases');

	// --- Static Leases ---
	interface Lease {
		sectionName: string;
		name: string;
		mac: string;
		ip: string;
	}

	let leases = $state<Lease[]>([]);
	let searchQuery = $state('');
	let sortColumn = $state<'name' | 'mac' | 'ip'>('name');
	let sortAsc = $state(true);
	let editingLease = $state<string | null>(null); // sectionName or '__new__'
	let editForm = $state({ name: '', mac: '', ip: '' });
	let deleteTarget = $state<Lease | null>(null);

	// --- DNS Records ---
	interface DnsRecord {
		sectionName: string;
		name: string;
		ip: string;
	}

	let dnsRecords = $state<DnsRecord[]>([]);
	let editingDns = $state<string | null>(null);
	let dnsForm = $state({ name: '', ip: '' });
	let deleteDnsTarget = $state<DnsRecord | null>(null);

	// --- Active DHCP Leases ---
	interface ActiveLease {
		timestamp: string;
		mac: string;
		ip: string;
		hostname: string;
	}

	let activeLeases = $state<ActiveLease[]>([]);

	onMount(async () => {
		try {
			await uci.load('dhcp');
			loadLeases();
			loadDnsRecords();
		} catch (e) {
			console.error('Failed to load DHCP config:', e);
		}
		try {
			const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
			parseActiveLeases(result.data || '');
		} catch { /* ignore */ }
		loading = false;
	});

	function loadLeases() {
		const hosts = uci.sections('dhcp', 'host');
		leases = hosts.map((h) => ({
			sectionName: h['.name'] as string,
			name: (h.name as string) ?? '',
			mac: normalizeMac(h.mac),
			ip: (h.ip as string) ?? ''
		}));
	}

	function loadDnsRecords() {
		const domains = uci.sections('dhcp', 'domain');
		dnsRecords = domains.map((d) => ({
			sectionName: d['.name'] as string,
			name: (d.name as string) ?? '',
			ip: (d.ip as string) ?? ''
		}));
	}

	function normalizeMac(mac: unknown): string {
		if (Array.isArray(mac)) return (mac[0] as string) ?? '';
		return (mac as string) ?? '';
	}

	async function loadActiveLeases() {
		try {
			const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
			if (result?.data) parseActiveLeases(result.data);
		} catch {}
	}

	function parseActiveLeases(data: string) {
		const lines = data.trim().split('\n').filter(Boolean);
		activeLeases = lines.map((line) => {
			const parts = line.split(/\s+/);
			return {
				timestamp: parts[0] ?? '',
				mac: (parts[1] ?? '').toUpperCase(),
				ip: parts[2] ?? '',
				hostname: parts[3] ?? '*'
			};
		});
	}

	// --- Sorting & Filtering ---
	const filteredLeases = $derived(() => {
		const q = searchQuery.toLowerCase();
		let result = leases.filter(
			(l) =>
				l.name.toLowerCase().includes(q) ||
				l.mac.toLowerCase().includes(q) ||
				l.ip.toLowerCase().includes(q)
		);
		result.sort((a, b) => {
			const va = a[sortColumn].toLowerCase();
			const vb = b[sortColumn].toLowerCase();
			if (sortColumn === 'ip') {
				const na = ipToNum(va);
				const nb = ipToNum(vb);
				return sortAsc ? na - nb : nb - na;
			}
			return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
		});
		return result;
	});

	function ipToNum(ip: string): number {
		const parts = ip.split('.').map(Number);
		return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
	}

	function toggleSort(col: 'name' | 'mac' | 'ip') {
		if (sortColumn === col) {
			sortAsc = !sortAsc;
		} else {
			sortColumn = col;
			sortAsc = true;
		}
	}

	function sortIndicator(col: string): string {
		if (sortColumn !== col) return '';
		return sortAsc ? ' \u25B2' : ' \u25BC';
	}

	// --- Unassigned active leases ---
	const unassignedLeases = $derived(() => {
		const staticMacs = new Set(leases.map((l) => l.mac.toUpperCase()));
		return activeLeases.filter((a) => !staticMacs.has(a.mac.toUpperCase()));
	});

	// --- CRUD: Static Leases ---
	function startEditLease(lease: Lease) {
		// Load advanced fields from UCI if editing existing
		const sec = uci.get('dhcp', lease.sectionName);
		addPanelForm = {
			name: lease.name, mac: lease.mac, ip: lease.ip,
			leasetime: (sec?.leasetime as string) ?? '',
			hostid: (sec?.hostid as string) ?? '',
			duid: (sec?.duid as string) ?? '',
			dns: sec?.dns === '1',
			broadcast: sec?.broadcast === '1',
			tag: (sec?.tag as string) ?? ''
		};
		editingLease = lease.sectionName;
		showAdvanced = false;
		showAddPanel = true;
	}

	function startAddLease() {
		addPanelForm = { name: '', mac: '', ip: '', leasetime: '', hostid: '', duid: '', dns: false, broadcast: false, tag: '' };
		editingLease = '__new__';
		showAdvanced = false;
		showAddPanel = true;
	}

	function cancelEditLease() {
		editingLease = null;
		showAddPanel = false;
	}

	function confirmDeleteLease(lease: Lease) {
		deleteTarget = lease;
	}

	function cancelDelete() {
		deleteTarget = null;
	}

	async function doDeleteLease() {
		if (!deleteTarget) return;
		try {
			await call('uci', 'delete', { config: 'dhcp', section: deleteTarget.sectionName });
			await call('uci', 'commit', { config: 'dhcp' });
			uci.unload('dhcp');
			await uci.load('dhcp');
			loadLeases();
		} catch (e) {
			console.error('Delete failed:', e);
		}
		deleteTarget = null;
	}

	// --- CRUD: DNS Records ---
	function startAddDns() {
		editingDns = '__new__';
		dnsForm = { name: '', ip: '' };
	}

	function startEditDns(rec: DnsRecord) {
		editingDns = rec.sectionName;
		dnsForm = { name: rec.name, ip: rec.ip };
	}

	function cancelEditDns() {
		editingDns = null;
	}

	async function saveDns() {
		if (!dnsForm.name) return;
		try {
			const values = { name: dnsForm.name, ip: dnsForm.ip };
			if (editingDns === '__new__') {
				const result = await call<{ section: string }>('uci', 'add', { config: 'dhcp', type: 'domain' });
				await call('uci', 'set', { config: 'dhcp', section: result.section, values });
			} else if (editingDns) {
				await call('uci', 'set', { config: 'dhcp', section: editingDns, values });
			}
			await call('uci', 'commit', { config: 'dhcp' });
			uci.unload('dhcp');
			await uci.load('dhcp');
			loadDnsRecords();
		} catch (e) {
			console.error('DNS save failed:', e);
		}
		editingDns = null;
	}

	function confirmDeleteDns(rec: DnsRecord) {
		deleteDnsTarget = rec;
	}

	function cancelDeleteDns() {
		deleteDnsTarget = null;
	}

	async function doDeleteDns() {
		if (!deleteDnsTarget) return;
		try {
			await call('uci', 'delete', { config: 'dhcp', section: deleteDnsTarget.sectionName });
			await call('uci', 'commit', { config: 'dhcp' });
			uci.unload('dhcp');
			await uci.load('dhcp');
			loadDnsRecords();
		} catch (e) {
			console.error('DNS delete failed:', e);
		}
		deleteDnsTarget = null;
	}

	// --- Make Static from active lease ---
	let showAddPanel = $state(false);
	let showAdvanced = $state(false);
	let addPanelForm = $state({ name: '', mac: '', ip: '', leasetime: '', hostid: '', duid: '', dns: false, broadcast: false, tag: '' });

	function makeStatic(active: ActiveLease) {
		addPanelForm = {
			name: active.hostname !== '*' ? active.hostname : '',
			mac: active.mac.toUpperCase(),
			ip: active.ip,
			leasetime: '', hostid: '', duid: '', dns: false, broadcast: false, tag: ''
		};
		editingLease = '__new__';
		showAdvanced = false;
		showAddPanel = true;
	}

	let panelSaving = $state(false);
	let panelMessage = $state('');

	async function saveFromPanel() {
		if (!addPanelForm.mac) return;
		panelSaving = true;
		panelMessage = '';

		try {
			const values: Record<string, unknown> = {
				name: addPanelForm.name,
				mac: addPanelForm.mac.toUpperCase(),
				ip: addPanelForm.ip
			};
			// Advanced fields
			if (addPanelForm.leasetime) values.leasetime = addPanelForm.leasetime;
			if (addPanelForm.hostid) values.hostid = addPanelForm.hostid;
			if (addPanelForm.duid) values.duid = addPanelForm.duid;
			if (addPanelForm.tag) values.tag = addPanelForm.tag;
			if (addPanelForm.dns) values.dns = '1';
			if (addPanelForm.broadcast) values.broadcast = '1';

			if (editingLease && editingLease !== '__new__') {
				// Edit existing — direct ubus call
				await call('uci', 'set', { config: 'dhcp', section: editingLease, values });
			} else {
				// Add new — use ubus add then set
				const result = await call<{ section: string }>('uci', 'add', { config: 'dhcp', type: 'host' });
				await call('uci', 'set', { config: 'dhcp', section: result.section, values });
			}

			// Commit immediately
			await call('uci', 'commit', { config: 'dhcp' });

			// Reload from server
			uci.unload('dhcp');
			await uci.load('dhcp');
			loadLeases();

			showAddPanel = false;
			editingLease = null;
		} catch (e) {
			panelMessage = 'Error: ' + (e instanceof Error ? e.message : 'Save failed');
		} finally {
			panelSaving = false;
		}
	}

	// Changes are saved immediately to the server — no deferred apply needed

	let restarting = $state(false);
	async function restartDhcp() {
		restarting = true;
		try {
			await call('rc', 'init', { name: 'dnsmasq', action: 'restart' });
			// Reload leases after a short delay
			setTimeout(async () => {
				await loadActiveLeases();
				restarting = false;
			}, 3000);
		} catch {
			restarting = false;
		}
	}
</script>

<div class="page">
	<div class="page-title-row">
		<div>
			<h1>DHCP & Static Leases</h1>
			<p class="subtitle">Manage static IP assignments and DNS records</p>
		</div>
		<button class="restart-btn" onclick={restartDhcp} disabled={restarting}>
			{restarting ? 'Restarting...' : 'Restart DHCP'}
		</button>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={tab === 'leases'} onclick={() => tab = 'leases'}>
			Static Leases <span class="tab-badge">{leases.length}</span>
		</button>
		<button class="tab" class:active={tab === 'unassigned'} onclick={() => tab = 'unassigned'}>
			Dynamic Leases {#if unassignedLeases().length > 0}<span class="tab-badge accent">{unassignedLeases().length}</span>{/if}
		</button>
		<button class="tab" class:active={tab === 'dns'} onclick={() => tab = 'dns'}>
			DNS Records <span class="tab-badge">{dnsRecords.length}</span>
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading configuration...</div>
	{:else if tab === 'leases'}
		<!-- Static Leases Tab -->
		<div class="section-card">
			<div class="section-header">
				<h2>Static Leases</h2>
				<div class="section-actions">
					<input
						type="text"
						class="search-input"
						placeholder="Search hostname, MAC, IP..."
						bind:value={searchQuery}
					/>
					<button class="btn btn-primary btn-sm" onclick={startAddLease}>Add Lease</button>
				</div>
			</div>

			<!-- Edit/Add uses the side panel now -->

			<!-- Leases Table -->
			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th class="sortable" onclick={() => toggleSort('name')}>Hostname{sortIndicator('name')}</th>
							<th class="sortable" onclick={() => toggleSort('mac')}>MAC Address{sortIndicator('mac')}</th>
							<th class="sortable" onclick={() => toggleSort('ip')}>IP Address{sortIndicator('ip')}</th>
							<th class="col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredLeases() as lease (lease.sectionName)}
							<tr>
								<td class="cell-name">{lease.name}</td>
								<td class="mono">{lease.mac}</td>
								<td class="mono">{lease.ip}</td>
								<td class="cell-actions">
									<button class="btn-icon" title="Edit" onclick={() => startEditLease(lease)}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => confirmDeleteLease(lease)}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									</button>
								</td>
							</tr>
						{:else}
							<tr><td colspan="4" class="empty-row">No leases match your search.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="table-footer">{filteredLeases().length} of {leases.length} entries</div>
		</div>

	{:else if tab === 'dns'}
		<!-- DNS Records Tab -->
		<div class="section-card">
			<div class="section-header">
				<h2>DNS Records</h2>
				<button class="btn btn-primary btn-sm" onclick={startAddDns}>Add Record</button>
			</div>

			{#if editingDns !== null}
				<div class="edit-card">
					<h3 class="edit-title">{editingDns === '__new__' ? 'Add DNS Record' : 'Edit DNS Record'}</h3>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Hostname</label>
							<input type="text" class="form-input" bind:value={dnsForm.name} placeholder="e.g. router.local" />
						</div>
						<div class="form-group">
							<label class="form-label">IP Address</label>
							<input type="text" class="form-input mono" bind:value={dnsForm.ip} placeholder="192.168.50.1" />
						</div>
					</div>
					<div class="edit-actions">
						<button class="btn btn-secondary btn-sm" onclick={cancelEditDns}>Cancel</button>
						<button class="btn btn-primary btn-sm" onclick={saveDns}>Save</button>
					</div>
				</div>
			{/if}

			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Hostname</th>
							<th>IP Address</th>
							<th class="col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each dnsRecords as rec (rec.sectionName)}
							<tr>
								<td class="cell-name">{rec.name}</td>
								<td class="mono">{rec.ip}</td>
								<td class="cell-actions">
									<button class="btn-icon" title="Edit" onclick={() => startEditDns(rec)}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => confirmDeleteDns(rec)}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
									</button>
								</td>
							</tr>
						{:else}
							<tr><td colspan="3" class="empty-row">No DNS records.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

	{:else if tab === 'unassigned'}
		<!-- Unassigned Clients Tab -->
		{#if unassignedLeases().length > 0}
			<div class="section-card">
				<div class="section-header">
					<h2>Unassigned DHCP Clients</h2>
					<span class="badge">{unassignedLeases().length}</span>
				</div>
				<p class="section-desc">Active DHCP clients without a static lease. Click "Make Static" to create a reservation.</p>
				<div class="table-wrap">
					<table class="data-table">
						<thead>
							<tr>
								<th>Hostname</th>
								<th>MAC Address</th>
								<th>IP Address</th>
								<th class="col-actions">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each unassignedLeases() as active}
								<tr>
									<td class="cell-name">{active.hostname === '*' ? '--' : active.hostname}</td>
									<td class="mono">{active.mac}</td>
									<td class="mono">{active.ip}</td>
									<td class="cell-actions">
										<button class="btn btn-accent btn-xs" onclick={() => makeStatic(active)}>Make Static</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else}
			<div class="section-card empty-section">
				<p>All active DHCP clients have static leases assigned.</p>
			</div>
		{/if}
	{/if}

	<!-- Delete Confirmation: Lease -->
	{#if deleteTarget}
		<div class="modal-overlay" role="presentation" onclick={cancelDelete}>
			<div class="modal" role="dialog" onclick={(e) => e.stopPropagation()}>
				<h3>Delete Static Lease</h3>
				<p>Remove the static lease for <strong>{deleteTarget.name || deleteTarget.mac}</strong> ({deleteTarget.ip})?</p>
				<div class="modal-actions">
					<button class="btn btn-secondary btn-sm" onclick={cancelDelete}>Cancel</button>
					<button class="btn btn-danger btn-sm" onclick={doDeleteLease}>Delete</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Delete Confirmation: DNS -->
	{#if deleteDnsTarget}
		<div class="modal-overlay" role="presentation" onclick={cancelDeleteDns}>
			<div class="modal" role="dialog" onclick={(e) => e.stopPropagation()}>
				<h3>Delete DNS Record</h3>
				<p>Remove the DNS record for <strong>{deleteDnsTarget.name}</strong> ({deleteDnsTarget.ip})?</p>
				<div class="modal-actions">
					<button class="btn btn-secondary btn-sm" onclick={cancelDeleteDns}>Cancel</button>
					<button class="btn btn-danger btn-sm" onclick={doDeleteDns}>Delete</button>
				</div>
			</div>
		</div>
	{/if}

</div>

<DetailPanel open={showAddPanel} title={editingLease && editingLease !== '__new__' ? 'Edit Static Lease' : 'Add Static Lease'} onClose={() => { showAddPanel = false; editingLease = null; }}>
	<div class="panel-form">
		<div class="pf-group">
			<label class="pf-label">Hostname</label>
			<input type="text" class="pf-input" bind:value={addPanelForm.name} placeholder="e.g. my-device" />
		</div>
		<div class="pf-group">
			<label class="pf-label">MAC Address</label>
			<input type="text" class="pf-input mono" bind:value={addPanelForm.mac} placeholder="AA:BB:CC:DD:EE:FF" />
		</div>
		<div class="pf-group">
			<label class="pf-label">IP Address</label>
			<input type="text" class="pf-input mono" bind:value={addPanelForm.ip} placeholder="192.168.50.x" />
		</div>
		<!-- Advanced toggle -->
		<button class="pf-advanced-toggle" onclick={() => showAdvanced = !showAdvanced}>
			{showAdvanced ? '▾' : '▸'} Advanced Options
		</button>

		{#if showAdvanced}
			<div class="pf-advanced">
				<div class="pf-group">
					<label class="pf-label">Lease Time</label>
					<select class="pf-input" bind:value={addPanelForm.leasetime}>
						<option value="">Default (use global)</option>
						<option value="1h">1 hour</option>
						<option value="6h">6 hours</option>
						<option value="12h">12 hours</option>
						<option value="24h">24 hours</option>
						<option value="7d">7 days</option>
						<option value="infinite">Infinite (never expires)</option>
					</select>
				</div>
				<div class="pf-group">
					<label class="pf-label">IPv6 Interface ID (hostid)</label>
					<input type="text" class="pf-input mono" bind:value={addPanelForm.hostid} placeholder="e.g. a1b2" />
				</div>
				<div class="pf-group">
					<label class="pf-label">DHCPv6 DUID</label>
					<input type="text" class="pf-input mono" bind:value={addPanelForm.duid} placeholder="Optional" />
				</div>
				<div class="pf-group">
					<label class="pf-label">DHCP Tag</label>
					<input type="text" class="pf-input" bind:value={addPanelForm.tag} placeholder="Optional tag for matching" />
				</div>
				<label class="pf-check">
					<input type="checkbox" bind:checked={addPanelForm.dns} />
					Create DNS entry for this host
				</label>
				<label class="pf-check">
					<input type="checkbox" bind:checked={addPanelForm.broadcast} />
					Use broadcast DHCP responses
				</label>
			</div>
		{/if}

		{#if panelMessage}
			<div class="pf-error">{panelMessage}</div>
		{/if}

		<button class="pf-save" onclick={saveFromPanel} disabled={panelSaving}>
			{#if panelSaving}
				Saving...
			{:else}
				{editingLease && editingLease !== '__new__' ? 'Save Changes' : 'Create Static Lease'}
			{/if}
		</button>
	</div>
</DetailPanel>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; padding-bottom: 80px; }

	.tabs {
		display: flex; gap: 0; border-bottom: 2px solid var(--color-surface-500);
	}
	.tab {
		padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent;
		margin-bottom: -2px; color: var(--color-text-muted); font-size: 14px; font-weight: 500;
		cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 8px;
		font-family: inherit;
	}
	.tab:hover { color: var(--color-text-primary); }
	.tab.active { color: var(--color-accent-light); border-bottom-color: var(--color-accent); }
	.tab-badge {
		font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px;
		background: var(--color-surface-600); color: var(--color-text-secondary);
	}
	.tab.active .tab-badge { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.tab-badge.accent { background: var(--color-warning-muted); color: var(--color-warning); }

	.empty-section { padding: 40px; text-align: center; color: var(--color-text-muted); }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Section cards */
	.section-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); padding: 20px;
	}
	.section-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
	}
	.section-header h2 { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.section-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.section-desc { font-size: 13px; color: var(--color-text-muted); margin: -8px 0 12px; }

	.badge {
		background: var(--color-accent-muted); color: var(--color-accent-light);
		font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-full);
	}

	/* Search */
	.search-input {
		padding: 6px 12px; width: 240px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 13px; outline: none; transition: border-color 0.15s;
	}
	.search-input:focus { border-color: var(--color-accent); }
	.search-input::placeholder { color: var(--color-text-muted); }

	/* Edit card */
	.edit-card {
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;
	}
	.edit-title { font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin: 0 0 12px; }
	.edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

	/* Form */
	.form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
	.form-group { margin-bottom: 8px; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-input {
		width: 100%; padding: 8px 12px;
		background: var(--color-surface-600); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
		box-sizing: border-box;
	}
	.form-input:focus { border-color: var(--color-accent); }

	/* Table */
	.table-wrap { overflow-x: auto; }
	.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
	.data-table thead th {
		text-align: left; padding: 8px 12px; font-weight: 600;
		color: var(--color-text-muted); border-bottom: 1px solid var(--color-surface-500);
		font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em;
		user-select: none; white-space: nowrap;
	}
	.data-table tbody td {
		padding: 8px 12px; border-bottom: 1px solid var(--color-surface-600);
		color: var(--color-text-primary);
	}
	.data-table tbody tr:hover { background: rgba(255,255,255,0.02); }
	.data-table tbody tr:last-child td { border-bottom: none; }

	.sortable { cursor: pointer; }
	.sortable:hover { color: var(--color-text-primary); }

	.col-actions { width: 90px; text-align: right; }
	.cell-name { font-weight: 600; }
	.cell-actions { text-align: right; white-space: nowrap; }
	.mono { font-family: var(--font-mono); font-size: 12px; }
	.empty-row { text-align: center; color: var(--color-text-muted); padding: 24px 12px !important; }
	.table-footer { font-size: 12px; color: var(--color-text-muted); margin-top: 8px; text-align: right; }

	/* Icon buttons */
	.btn-icon {
		background: none; border: none; cursor: pointer; padding: 4px 6px;
		color: var(--color-text-muted); border-radius: var(--radius-sm);
		transition: all 0.15s; display: inline-flex; align-items: center;
	}
	.btn-icon:hover { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-icon-danger:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

	/* Buttons */
	.btn {
		padding: 8px 20px; border-radius: var(--radius-sm); font-size: 14px;
		font-weight: 500; cursor: pointer; border: none; transition: background 0.15s;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-sm { padding: 6px 14px; font-size: 13px; }
	.btn-xs { padding: 4px 10px; font-size: 12px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }
	.btn-danger { background: #ef4444; color: white; }
	.btn-danger:hover:not(:disabled) { background: #dc2626; }
	.btn-accent { background: var(--color-accent-muted); color: var(--color-accent-light); border: 1px solid var(--color-accent); }
	.btn-accent:hover { background: var(--color-accent); color: white; }

	/* Modal */
	.modal-overlay {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200;
		display: flex; align-items: center; justify-content: center;
	}
	.modal {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); padding: 24px; max-width: 400px; width: 90%;
	}
	.modal h3 { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px; }
	.modal p { font-size: 14px; color: var(--color-text-secondary); margin: 0 0 20px; line-height: 1.5; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

	/* Apply bar */
	.apply-bar {
		position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
		background: var(--color-surface-800); border-top: 1px solid var(--color-surface-500);
		padding: 12px 24px; display: flex; align-items: center; justify-content: space-between;
	}
	.apply-text { font-size: 14px; color: var(--color-text-secondary); }
	.apply-actions { display: flex; gap: 8px; }

	.countdown-toast {
		position: fixed; bottom: 72px; right: 24px; z-index: 101;
		background: var(--color-info-muted); border: 1px solid var(--color-info);
		color: var(--color-text-primary); padding: 12px 20px;
		border-radius: var(--radius-md); font-size: 13px;
	}

	.page-title-row { display: flex; justify-content: space-between; align-items: flex-start; }
	.restart-btn {
		padding: 8px 16px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-secondary); font-size: 13px; font-weight: 500;
		cursor: pointer; font-family: inherit; white-space: nowrap;
		transition: all 0.15s;
	}
	.restart-btn:hover:not(:disabled) { background: var(--color-surface-600); color: var(--color-text-primary); }
	.restart-btn:disabled { opacity: 0.5; }

	/* Panel form */
	.panel-form { display: flex; flex-direction: column; gap: 16px; }
	.pf-group { display: flex; flex-direction: column; gap: 4px; }
	.pf-label { font-size: 13px; color: var(--color-text-secondary); }
	.pf-input {
		padding: 10px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 14px; font-family: inherit;
		outline: none; transition: border-color 0.15s;
	}
	.pf-input:focus { border-color: var(--color-accent); }
	.pf-input.mono { font-family: var(--font-mono); }
	.pf-save {
		padding: 12px; background: var(--color-accent); color: white;
		border: none; border-radius: 8px; font-size: 14px; font-weight: 500;
		cursor: pointer; font-family: inherit; margin-top: 8px;
	}
	.pf-save:hover:not(:disabled) { background: var(--color-accent-hover); }
	.pf-save:disabled { opacity: 0.6; cursor: wait; }
	.pf-error { font-size: 13px; color: var(--color-danger); }

	.pf-advanced-toggle {
		background: none; border: none; color: var(--color-text-muted); font-size: 13px;
		cursor: pointer; padding: 0; font-family: inherit; text-align: left;
		transition: color 0.15s;
	}
	.pf-advanced-toggle:hover { color: var(--color-text-primary); }
	.pf-advanced {
		display: flex; flex-direction: column; gap: 12px;
		padding: 14px; background: var(--color-surface-700); border-radius: 8px;
	}
	.pf-check {
		display: flex; align-items: center; gap: 8px;
		font-size: 13px; color: var(--color-text-secondary); cursor: pointer;
	}
</style>
