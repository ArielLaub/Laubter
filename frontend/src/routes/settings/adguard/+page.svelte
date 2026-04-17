<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';

	type Tab = 'dashboard' | 'filters' | 'querylog';
	let activeTab = $state<Tab>('dashboard');
	let loading = $state(true);

	// --- DHCP hostname resolution ---
	let dhcpMap = $state<Record<string, string>>({});

	// --- Dashboard state ---
	interface Stats {
		num_dns_queries: number;
		num_blocked_filtering: number;
		avg_processing_time: number;
		top_queried_domains: Record<string, number>[];
		top_blocked_domains: Record<string, number>[];
		top_clients: Record<string, number>[];
		dns_queries: number[];
		blocked_filtering: number[];
	}

	interface Status {
		version: string;
		dns_addresses: string[];
		protection_enabled: boolean;
	}

	let stats = $state<Stats | null>(null);
	let status = $state<Status | null>(null);
	let protectionEnabled = $state(true);
	let togglingProtection = $state(false);

	// --- Query Log Config ---
	let qlEnabled = $state(true);
	let qlInterval = $state(86400000); // default 24h

	async function loadQlConfig() {
		try {
			const cfg = await call<{ enabled: boolean; interval: number }>('laubter-adguard', 'get_querylog_config', {});
			qlEnabled = cfg.enabled ?? true;
			qlInterval = cfg.interval ?? 86400000;
		} catch {}
	}

	async function saveQlConfig() {
		try {
			await call('laubter-adguard', 'set_querylog_config', {
				enabled: qlEnabled,
				interval: qlInterval,
				anonymize_client_ip: false
			});
		} catch (e) {
			console.error('Failed to save query log config:', e);
		}
	}

	// --- Filters state ---
	interface Filter {
		url: string;
		name: string;
		last_updated: string;
		rules_count: number;
		enabled: boolean;
	}

	interface FilteringConfig {
		filters: Filter[];
		user_rules: string[];
		enabled: boolean;
		interval: number;
	}

	let filtering = $state<FilteringConfig | null>(null);
	let filteringEnabled = $state(true);
	let showAddFilter = $state(false);
	let addFilterForm = $state({ url: '', name: '' });
	let userRulesText = $state('');
	let savingFilter = $state(false);

	// --- Query Log state ---
	interface QueryEntry {
		answer: any;
		client: string;
		client_id: string;
		client_info: any;
		elapsedMs: string;
		question: { name: string; type: string };
		reason: string;
		status: string;
		time: string;
	}

	let queryLog = $state<QueryEntry[]>([]);
	let querySearch = $state('');
	let queryLogLoading = $state(false);

	// --- Intervals ---
	let statsInterval: ReturnType<typeof setInterval> | undefined;
	let queryLogInterval: ReturnType<typeof setInterval> | undefined;

	// --- Derived ---
	const totalQueries = $derived(stats?.num_dns_queries ?? 0);
	const blockedQueries = $derived(stats?.num_blocked_filtering ?? 0);
	const blockedPercent = $derived(totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) : '0.0');
	const avgTime = $derived(stats?.avg_processing_time ? (stats.avg_processing_time * 1000).toFixed(1) : '0.0');
	const activeFilterCount = $derived(filtering?.filters?.filter((f) => f.enabled).length ?? 0);

	const topQueried = $derived(() => {
		if (!stats?.top_queried_domains) return [];
		return stats.top_queried_domains.slice(0, 10).map((d) => {
			const key = Object.keys(d)[0];
			return { domain: key, count: d[key] };
		});
	});

	const topBlocked = $derived(() => {
		if (!stats?.top_blocked_domains) return [];
		return stats.top_blocked_domains.slice(0, 10).map((d) => {
			const key = Object.keys(d)[0];
			return { domain: key, count: d[key] };
		});
	});

	const topClients = $derived(() => {
		if (!stats?.top_clients) return [];
		return stats.top_clients.slice(0, 10).map((c) => {
			const key = Object.keys(c)[0];
			return { ip: key, count: c[key], hostname: dhcpMap[key] || '' };
		});
	});

	const filteredQueryLog = $derived(() => {
		if (!querySearch) return queryLog;
		const q = querySearch.toLowerCase();
		return queryLog.filter(
			(e) =>
				e.question?.name?.toLowerCase().includes(q) ||
				e.client?.toLowerCase().includes(q) ||
				(dhcpMap[e.client] || '').toLowerCase().includes(q)
		);
	});

	// --- Sparkline helpers ---
	function sparklinePath(data: number[], width: number, height: number): string {
		if (!data || data.length === 0) return '';
		const max = Math.max(...data, 1);
		const step = width / (data.length - 1 || 1);
		return data.map((v, i) => {
			const x = i * step;
			const y = height - (v / max) * height;
			return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		}).join(' ');
	}

	// --- Data loading ---
	async function loadDhcpHosts() {
		try {
			const result = await call<{ data: string }>('file', 'read', { path: '/tmp/dhcp.leases' });
			if (result?.data) {
				const lines = result.data.trim().split('\n').filter(Boolean);
				const map: Record<string, string> = {};
				for (const line of lines) {
					const parts = line.split(/\s+/);
					const ip = parts[2] ?? '';
					const hostname = parts[3] ?? '';
					if (ip && hostname && hostname !== '*') {
						map[ip] = hostname;
					}
				}
				dhcpMap = map;
			}
		} catch { /* ignore */ }
	}

	async function loadStatus() {
		try {
			const res = await call<Status>('laubter-adguard', 'get_status', {});
			status = res;
			protectionEnabled = res.protection_enabled ?? true;
		} catch (e) {
			console.error('Failed to load AdGuard status:', e);
		}
	}

	async function loadStats() {
		try {
			const res = await call<Stats>('laubter-adguard', 'get_stats', {});
			stats = res;
		} catch (e) {
			console.error('Failed to load stats:', e);
		}
	}

	async function loadFiltering() {
		try {
			const res = await call<FilteringConfig>('laubter-adguard', 'get_filtering', {});
			filtering = res;
			filteringEnabled = res.enabled ?? true;
			userRulesText = (res.user_rules || []).join('\n');
		} catch (e) {
			console.error('Failed to load filtering:', e);
		}
	}

	async function loadQueryLog() {
		queryLogLoading = true;
		try {
			const res = await call<{ data: QueryEntry[] }>('laubter-adguard', 'get_querylog', { limit: 100 });
			queryLog = res.data || [];
		} catch (e) {
			console.error('Failed to load query log:', e);
		}
		queryLogLoading = false;
	}

	// --- Actions ---
	async function toggleProtection() {
		togglingProtection = true;
		try {
			await call('laubter-adguard', 'toggle_protection', { enabled: !protectionEnabled });
			protectionEnabled = !protectionEnabled;
		} catch (e) {
			console.error('Failed to toggle protection:', e);
		}
		togglingProtection = false;
	}

	async function toggleFilterEnabled(filter: Filter) {
		try {
			// Toggle individual filter — uses remove + re-add pattern or toggle_filtering
			// For now we toggle the global filtering
			await call('laubter-adguard', 'toggle_filtering', { enabled: !filteringEnabled });
			filteringEnabled = !filteringEnabled;
			await loadFiltering();
		} catch (e) {
			console.error('Failed to toggle filtering:', e);
		}
	}

	async function addFilter() {
		if (!addFilterForm.url || !addFilterForm.name) return;
		savingFilter = true;
		try {
			await call('laubter-adguard', 'add_filter', {
				url: addFilterForm.url,
				name: addFilterForm.name
			});
			addFilterForm = { url: '', name: '' };
			showAddFilter = false;
			await loadFiltering();
		} catch (e) {
			console.error('Failed to add filter:', e);
		}
		savingFilter = false;
	}

	async function removeFilter(url: string) {
		try {
			await call('laubter-adguard', 'remove_filter', { url });
			await loadFiltering();
		} catch (e) {
			console.error('Failed to remove filter:', e);
		}
	}

	// --- Tab switching ---
	function switchTab(tab: Tab) {
		activeTab = tab;
		clearIntervals();
		if (tab === 'dashboard') {
			startDashboardPolling();
		} else if (tab === 'querylog') {
			loadQueryLog();
			startQueryLogPolling();
		} else if (tab === 'filters') {
			loadFiltering();
		}
	}

	function startDashboardPolling() {
		loadStats();
		loadStatus();
		statsInterval = setInterval(() => {
			loadStats();
			loadStatus();
		}, 10000);
	}

	function startQueryLogPolling() {
		queryLogInterval = setInterval(loadQueryLog, 5000);
	}

	function clearIntervals() {
		if (statsInterval) { clearInterval(statsInterval); statsInterval = undefined; }
		if (queryLogInterval) { clearInterval(queryLogInterval); queryLogInterval = undefined; }
	}

	// --- Formatting ---
	function formatTime(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		} catch { return iso; }
	}

	function formatDate(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		} catch { return iso; }
	}

	function resolveClient(ip: string): string {
		return dhcpMap[ip] || ip;
	}

	function queryStatusLabel(reason: string): { text: string; cls: string } {
		if (!reason) return { text: 'Allowed', cls: 'allowed' };
		const r = reason.toLowerCase();
		if (r.includes('filtered') || r.includes('blocked') || r.includes('safebrowsing') || r.includes('parental')) {
			return { text: 'Blocked', cls: 'blocked' };
		}
		if (r.includes('rewrite') || r.includes('cached')) {
			return { text: 'Cached', cls: 'cached' };
		}
		return { text: 'Allowed', cls: 'allowed' };
	}

	function formatNumber(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return n.toLocaleString();
	}

	// --- Lifecycle ---
	onMount(async () => {
		await loadDhcpHosts();
		await Promise.all([loadStats(), loadStatus(), loadFiltering(), loadQlConfig()]);
		loading = false;
		startDashboardPolling();
	});

	onDestroy(() => {
		clearIntervals();
	});
</script>

<div class="page">
	<div class="page-header">
		<div>
			<h1>DNS Protection</h1>
			<p class="subtitle">AdGuard Home {status?.version ? `v${status.version}` : ''}</p>
		</div>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'dashboard'} onclick={() => switchTab('dashboard')}>
			Dashboard
		</button>
		<button class="tab" class:active={activeTab === 'filters'} onclick={() => switchTab('filters')}>
			Filters <span class="tab-badge">{activeFilterCount}</span>
		</button>
		<button class="tab" class:active={activeTab === 'querylog'} onclick={() => switchTab('querylog')}>
			Query Log
		</button>
	</div>

	{#if loading}
		<div class="loading">Loading DNS protection data...</div>
	{:else if activeTab === 'dashboard'}
		<!-- ==================== DASHBOARD TAB ==================== -->

		<!-- Stats Row -->
		<div class="stats-row">
			<div class="stat-card">
				<div class="stat-value">{formatNumber(totalQueries)}</div>
				<div class="stat-label">DNS Queries</div>
				{#if stats?.dns_queries && stats.dns_queries.length > 1}
					<svg class="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
						<path d={sparklinePath(stats.dns_queries, 80, 24)} fill="none" stroke="var(--color-accent)" stroke-width="1.5" />
					</svg>
				{/if}
			</div>
			<div class="stat-card stat-blocked">
				<div class="stat-value blocked-text">{formatNumber(blockedQueries)}</div>
				<div class="stat-label">Blocked <span class="blocked-pct">{blockedPercent}%</span></div>
				{#if stats?.blocked_filtering && stats.blocked_filtering.length > 1}
					<svg class="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
						<path d={sparklinePath(stats.blocked_filtering, 80, 24)} fill="none" stroke="#ef4444" stroke-width="1.5" />
					</svg>
				{/if}
			</div>
			<div class="stat-card">
				<div class="stat-value">{avgTime}<span class="stat-unit">ms</span></div>
				<div class="stat-label">Avg Response</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">{activeFilterCount}</div>
				<div class="stat-label">Active Filters</div>
			</div>
		</div>

		<!-- Protection Toggle -->
		<div class="protection-card" class:protection-on={protectionEnabled} class:protection-off={!protectionEnabled}>
			<div class="protection-info">
				<div class="protection-icon">{protectionEnabled ? '\u{1F6E1}' : '\u26A0'}</div>
				<div>
					<div class="protection-title">{protectionEnabled ? 'Protection Active' : 'Protection Disabled'}</div>
					<div class="protection-desc">
						{protectionEnabled
							? 'All DNS queries are being filtered and monitored.'
							: 'DNS filtering is currently turned off. Your network is not protected.'}
					</div>
				</div>
			</div>
			<button
				class="protection-toggle"
				class:toggle-on={protectionEnabled}
				class:toggle-off={!protectionEnabled}
				onclick={toggleProtection}
				disabled={togglingProtection}
			>
				<span class="toggle-track">
					<span class="toggle-thumb"></span>
				</span>
				<span class="toggle-label">{protectionEnabled ? 'ON' : 'OFF'}</span>
			</button>
		</div>

		<!-- Charts Row -->
		<div class="chart-grid">
			<div class="chart-card">
				<h2 class="chart-title">DNS Queries (24h)</h2>
				<div class="bar-chart">
					{#if stats?.dns_queries}
						{@const maxQ = Math.max(...stats.dns_queries, 1)}
						{#each stats.dns_queries as val, i}
							<div class="bar-col" title="{val} queries">
								<div class="bar" style="height: {(val / maxQ) * 100}%"></div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
			<div class="chart-card">
				<h2 class="chart-title">Blocked Queries (24h)</h2>
				<div class="bar-chart">
					{#if stats?.blocked_filtering}
						{@const maxB = Math.max(...stats.blocked_filtering, 1)}
						{#each stats.blocked_filtering as val, i}
							<div class="bar-col" title="{val} blocked">
								<div class="bar bar-red" style="height: {(val / maxB) * 100}%"></div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>

		<!-- Top Lists Row -->
		<div class="chart-grid">
			<div class="section-card">
				<h2 class="section-title">Top Queried Domains</h2>
				<div class="domain-list">
					{#each topQueried() as item, i}
						<div class="domain-row">
							<span class="domain-rank">{i + 1}</span>
							<span class="domain-name" title={item.domain}>{item.domain}</span>
							<span class="domain-count">{formatNumber(item.count)}</span>
						</div>
					{:else}
						<div class="empty-section">No data available</div>
					{/each}
				</div>
			</div>
			<div class="section-card">
				<h2 class="section-title">Top Blocked Domains</h2>
				<div class="domain-list">
					{#each topBlocked() as item, i}
						<div class="domain-row">
							<span class="domain-rank">{i + 1}</span>
							<span class="domain-name blocked-text" title={item.domain}>{item.domain}</span>
							<span class="domain-count blocked-text">{formatNumber(item.count)}</span>
						</div>
					{:else}
						<div class="empty-section">No data available</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Top Clients -->
		<div class="section-card">
			<h2 class="section-title">Top Clients</h2>
			<div class="domain-list">
				{#each topClients() as item, i}
					<div class="domain-row">
						<span class="domain-rank">{i + 1}</span>
						<span class="domain-name">
							{#if item.hostname}
								<span class="client-hostname">{item.hostname}</span>
								<span class="client-ip">{item.ip}</span>
							{:else}
								{item.ip}
							{/if}
						</span>
						<span class="domain-count">{formatNumber(item.count)}</span>
					</div>
				{:else}
					<div class="empty-section">No data available</div>
				{/each}
			</div>
		</div>

	{:else if activeTab === 'filters'}
		<!-- ==================== FILTERS TAB ==================== -->

		<div class="section-card">
			<div class="section-header">
				<h2>Filter Lists</h2>
				<div class="section-actions">
					<button class="btn btn-primary btn-sm" onclick={() => showAddFilter = !showAddFilter}>
						{showAddFilter ? 'Cancel' : 'Add Filter List'}
					</button>
				</div>
			</div>

			{#if showAddFilter}
				<div class="add-filter-form">
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Name</label>
							<input class="form-input" type="text" placeholder="My Filter List" bind:value={addFilterForm.name} />
						</div>
						<div class="form-group">
							<label class="form-label">URL</label>
							<input class="form-input" type="url" placeholder="https://example.com/list.txt" bind:value={addFilterForm.url} />
						</div>
						<div class="form-group form-group-btn">
							<button class="btn btn-primary" onclick={addFilter} disabled={savingFilter || !addFilterForm.url || !addFilterForm.name}>
								{savingFilter ? 'Adding...' : 'Add'}
							</button>
						</div>
					</div>
				</div>
			{/if}

			<div class="table-wrap">
				<table class="data-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>URL</th>
							<th>Rules</th>
							<th>Last Updated</th>
							<th>Status</th>
							<th class="col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filtering?.filters ?? [] as filter}
							<tr>
								<td class="cell-name">{filter.name}</td>
								<td class="cell-url" title={filter.url}>
									<span class="mono">{filter.url.length > 50 ? filter.url.slice(0, 50) + '...' : filter.url}</span>
								</td>
								<td class="mono">{filter.rules_count.toLocaleString()}</td>
								<td>{filter.last_updated ? formatDate(filter.last_updated) : 'Never'}</td>
								<td>
									<span class="badge" class:badge-green={filter.enabled} class:badge-muted={!filter.enabled}>
										{filter.enabled ? 'Enabled' : 'Disabled'}
									</span>
								</td>
								<td class="cell-actions">
									<button class="btn-icon btn-icon-danger" title="Remove filter" onclick={() => removeFilter(filter.url)}>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
									</button>
								</td>
							</tr>
						{:else}
							<tr><td colspan="6" class="empty-row">No filter lists configured</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Global Filtering Toggle -->
		<div class="section-card">
			<div class="section-header">
				<h2>Filtering</h2>
				<button
					class="btn btn-sm"
					class:btn-primary={!filteringEnabled}
					class:btn-secondary={filteringEnabled}
					onclick={toggleFilterEnabled}
				>
					{filteringEnabled ? 'Disable Filtering' : 'Enable Filtering'}
				</button>
			</div>
			<p class="section-desc">
				{filteringEnabled
					? 'DNS filtering is active. Queries matching filter rules will be blocked.'
					: 'DNS filtering is disabled. All queries will be allowed through.'}
			</p>
		</div>

		<!-- User Rules -->
		<div class="section-card">
			<div class="section-header">
				<h2>Custom Rules</h2>
			</div>
			<p class="section-desc">
				Add custom block or allow rules. One rule per line. Use <code>||domain.com^</code> to block, <code>@@||domain.com^</code> to allow.
			</p>
			<textarea
				class="user-rules-textarea"
				rows="10"
				placeholder="||ads.example.com^&#10;@@||allowed.example.com^"
				bind:value={userRulesText}
			></textarea>
		</div>

		<!-- Query Log Settings -->
		<div class="section-card">
			<div class="section-header">
				<h2>Query Log Settings</h2>
			</div>
			<div class="ql-settings">
				<div class="ql-row">
					<span class="ql-label">Log Retention</span>
					<select class="ql-select" bind:value={qlInterval} onchange={saveQlConfig}>
						<option value={21600000}>6 hours</option>
						<option value={86400000}>24 hours</option>
						<option value={259200000}>3 days</option>
						<option value={604800000}>7 days</option>
						<option value={2592000000}>30 days</option>
						<option value={7776000000}>90 days</option>
					</select>
				</div>
				<div class="ql-row">
					<span class="ql-label">Query Logging</span>
					<button class="ql-toggle" class:on={qlEnabled} onclick={() => { qlEnabled = !qlEnabled; saveQlConfig(); }}>
						{qlEnabled ? 'Enabled' : 'Disabled'}
					</button>
				</div>
				<p class="ql-hint">Lower retention uses less memory. 24 hours is recommended for most users.</p>
			</div>
		</div>

	{:else if activeTab === 'querylog'}
		<!-- ==================== QUERY LOG TAB ==================== -->

		<div class="section-card">
			<div class="section-header">
				<h2>Recent DNS Queries</h2>
				<div class="section-actions">
					<input
						type="text"
						class="search-input"
						placeholder="Search domain or client..."
						bind:value={querySearch}
					/>
					{#if queryLogLoading}
						<span class="poll-indicator">Updating...</span>
					{/if}
				</div>
			</div>

			<div class="table-wrap">
				<table class="data-table query-table">
					<thead>
						<tr>
							<th>Time</th>
							<th>Client</th>
							<th>Domain</th>
							<th>Type</th>
							<th>Status</th>
							<th>Response</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredQueryLog() as entry}
							{@const qs = queryStatusLabel(entry.reason)}
							<tr class:row-blocked={qs.cls === 'blocked'}>
								<td class="mono cell-time">{formatTime(entry.time)}</td>
								<td class="cell-client" title={entry.client}>
									{resolveClient(entry.client)}
								</td>
								<td class="cell-domain" title={entry.question?.name}>
									{entry.question?.name ?? ''}
								</td>
								<td class="mono">{entry.question?.type ?? ''}</td>
								<td>
									<span class="status-badge status-{qs.cls}">{qs.text}</span>
								</td>
								<td class="mono">{entry.elapsedMs ?? ''}ms</td>
							</tr>
						{:else}
							<tr><td colspan="6" class="empty-row">No queries logged</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; padding-bottom: 40px; }
	.page-header { display: flex; align-items: center; justify-content: space-between; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Tabs */
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

	/* Stats Cards */
	.stats-row {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
	}
	.stat-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 20px;
		display: flex; flex-direction: column; align-items: center; gap: 4px;
		position: relative; overflow: hidden;
	}
	.stat-value {
		font-size: 28px; font-weight: 700; color: var(--color-text-primary);
		font-family: var(--font-mono); line-height: 1.2;
	}
	.stat-unit {
		font-size: 14px; font-weight: 500; color: var(--color-text-muted); margin-left: 2px;
	}
	.stat-label {
		font-size: 11px; color: var(--color-text-muted); text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.blocked-text { color: #ef4444; }
	.blocked-pct {
		font-size: 11px; color: #ef4444; font-weight: 600; margin-left: 4px;
		background: rgba(239, 68, 68, 0.12); padding: 1px 6px; border-radius: 8px;
	}
	.stat-blocked { border-color: rgba(239, 68, 68, 0.25); }
	.sparkline { width: 100%; height: 24px; margin-top: 8px; opacity: 0.7; }

	/* Protection Toggle */
	.protection-card {
		display: flex; align-items: center; justify-content: space-between;
		padding: 20px 24px; border-radius: 12px;
		transition: all 0.3s ease; gap: 20px;
	}
	.protection-on {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(34, 197, 94, 0.03));
		border: 1px solid rgba(34, 197, 94, 0.25);
	}
	.protection-off {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.03));
		border: 1px solid rgba(239, 68, 68, 0.25);
	}
	.protection-info { display: flex; align-items: center; gap: 16px; }
	.protection-icon { font-size: 32px; }
	.protection-title {
		font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 4px;
	}
	.protection-desc { font-size: 13px; color: var(--color-text-muted); }

	/* Toggle Switch */
	.protection-toggle {
		display: flex; align-items: center; gap: 12px;
		background: none; border: none; cursor: pointer; padding: 8px;
		font-family: inherit;
	}
	.protection-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
	.toggle-track {
		width: 56px; height: 30px; border-radius: 15px;
		position: relative; transition: background 0.3s ease;
		display: block;
	}
	.toggle-on .toggle-track { background: #22c55e; }
	.toggle-off .toggle-track { background: #ef4444; }
	.toggle-thumb {
		position: absolute; top: 3px; width: 24px; height: 24px;
		border-radius: 50%; background: white; transition: left 0.3s ease;
		box-shadow: 0 2px 4px rgba(0,0,0,0.3);
	}
	.toggle-on .toggle-thumb { left: 29px; }
	.toggle-off .toggle-thumb { left: 3px; }
	.toggle-label {
		font-size: 14px; font-weight: 700; letter-spacing: 0.05em;
		min-width: 30px;
	}
	.toggle-on .toggle-label { color: #22c55e; }
	.toggle-off .toggle-label { color: #ef4444; }

	/* Bar Charts */
	.chart-grid {
		display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
	}
	.chart-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 16px;
	}
	.chart-title {
		font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px;
	}
	.bar-chart {
		display: flex; align-items: flex-end; gap: 1px; height: 120px;
		padding: 0; width: 100%;
	}
	.bar-col {
		flex: 1; display: flex; align-items: flex-end; height: 100%;
		min-width: 0;
	}
	.bar {
		width: 100%; min-height: 1px; border-radius: 2px 2px 0 0;
		background: var(--color-accent); opacity: 0.7;
		transition: opacity 0.15s;
	}
	.bar:hover { opacity: 1; }
	.bar-red { background: #ef4444; }

	/* Section Cards */
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
	.section-title {
		font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px;
	}
	.section-desc { font-size: 13px; color: var(--color-text-muted); margin: -8px 0 12px; }
	.section-desc code {
		background: var(--color-surface-600); padding: 1px 5px; border-radius: 3px;
		font-size: 12px; color: var(--color-accent-light);
	}
	.empty-section { padding: 24px; text-align: center; color: var(--color-text-muted); font-size: 13px; }

	/* Domain Lists */
	.domain-list { display: flex; flex-direction: column; gap: 0; }
	.domain-row {
		display: flex; align-items: center; gap: 12px; padding: 8px 4px;
		border-bottom: 1px solid var(--color-surface-600);
	}
	.domain-row:last-child { border-bottom: none; }
	.domain-rank {
		font-size: 11px; font-weight: 600; color: var(--color-text-muted);
		min-width: 20px; text-align: center;
	}
	.domain-name {
		flex: 1; font-size: 13px; color: var(--color-text-primary);
		font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis;
		white-space: nowrap;
	}
	.domain-count {
		font-size: 13px; font-weight: 600; color: var(--color-text-secondary);
		font-family: var(--font-mono);
	}
	.client-hostname {
		color: var(--color-text-primary); font-weight: 500;
	}
	.client-ip {
		color: var(--color-text-muted); font-size: 11px; margin-left: 6px;
	}

	/* Tables */
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
	.col-actions { width: 60px; text-align: right; }
	.cell-name { font-weight: 600; }
	.cell-url { max-width: 300px; }
	.cell-actions { text-align: right; white-space: nowrap; }
	.mono { font-family: var(--font-mono); font-size: 12px; }
	.empty-row { text-align: center; color: var(--color-text-muted); padding: 24px 12px !important; }

	/* Query Log Table */
	.query-table .cell-time { white-space: nowrap; color: var(--color-text-muted); }
	.query-table .cell-client {
		max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.query-table .cell-domain {
		max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		font-family: var(--font-mono); font-size: 12px;
	}
	.row-blocked { background: rgba(239, 68, 68, 0.06); }
	.row-blocked:hover { background: rgba(239, 68, 68, 0.1) !important; }

	/* Status Badges */
	.status-badge {
		font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-full);
		white-space: nowrap;
	}
	.status-allowed { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
	.status-blocked { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
	.status-cached { background: rgba(0, 111, 255, 0.12); color: #006fff; }

	.badge {
		font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-full);
	}
	.badge-green { background: rgba(34, 197, 94, 0.12); color: #22c55e; }
	.badge-muted { background: var(--color-surface-600); color: var(--color-text-muted); }

	/* Buttons */
	.btn {
		padding: 8px 20px; border-radius: var(--radius-sm); font-size: 14px;
		font-weight: 500; cursor: pointer; border: none; transition: background 0.15s;
		font-family: inherit;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-sm { padding: 6px 14px; font-size: 13px; }
	.btn-primary { background: var(--color-accent); color: white; }
	.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
	.btn-secondary { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-secondary:hover:not(:disabled) { background: var(--color-surface-500); }

	.btn-icon {
		background: none; border: none; cursor: pointer; padding: 4px 6px;
		color: var(--color-text-muted); border-radius: var(--radius-sm);
		transition: all 0.15s; display: inline-flex; align-items: center;
	}
	.btn-icon:hover { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-icon-danger:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

	/* Forms */
	.add-filter-form {
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;
	}
	.form-row {
		display: grid; grid-template-columns: 1fr 2fr auto; gap: 12px; align-items: end;
	}
	.form-group { margin-bottom: 0; }
	.form-group-btn { display: flex; align-items: flex-end; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-input {
		width: 100%; padding: 8px 12px;
		background: var(--color-surface-600); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
		box-sizing: border-box;
	}
	.form-input:focus { border-color: var(--color-accent); }
	.form-input::placeholder { color: var(--color-text-muted); }

	/* Search */
	.search-input {
		padding: 6px 12px; width: 240px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 13px; outline: none; transition: border-color 0.15s;
	}
	.search-input:focus { border-color: var(--color-accent); }
	.search-input::placeholder { color: var(--color-text-muted); }

	/* User Rules */
	.user-rules-textarea {
		width: 100%; padding: 12px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-family: var(--font-mono); font-size: 13px; line-height: 1.6;
		resize: vertical; outline: none; box-sizing: border-box;
	}
	.user-rules-textarea:focus { border-color: var(--color-accent); }
	.user-rules-textarea::placeholder { color: var(--color-text-muted); }

	/* Query Log Settings */
	.ql-settings { display: flex; flex-direction: column; gap: 12px; }
	.ql-row { display: flex; align-items: center; justify-content: space-between; }
	.ql-label { font-size: 14px; color: var(--color-text-primary); }
	.ql-select {
		padding: 8px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 13px; font-family: inherit;
	}
	.ql-select:focus { border-color: var(--color-accent); outline: none; }
	.ql-toggle {
		padding: 6px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
		border: none; cursor: pointer; font-family: inherit;
		background: var(--color-surface-600); color: var(--color-text-muted);
	}
	.ql-toggle.on { background: rgba(34,197,94,0.15); color: #22c55e; }
	.ql-hint { font-size: 12px; color: var(--color-text-muted); margin: 0; }

	/* Poll indicator */
	.poll-indicator {
		font-size: 11px; color: var(--color-text-muted); font-style: italic;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.stats-row { grid-template-columns: repeat(2, 1fr); }
		.chart-grid { grid-template-columns: 1fr; }
		.form-row { grid-template-columns: 1fr; }
		.protection-card { flex-direction: column; text-align: center; }
		.protection-info { flex-direction: column; }
	}

	@media (max-width: 600px) {
		.stats-row { grid-template-columns: 1fr; }
		.search-input { width: 100%; }
	}
</style>
