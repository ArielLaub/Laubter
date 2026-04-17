<script lang="ts">
	import { call } from '$api/ubus';
	import { onMount } from 'svelte';

	interface LogEntry {
		msg: string;
		id: number;
		priority: number;
		source: number;
		time: number;
	}

	type SeverityLevel = 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug';

	const SEVERITY_NAMES: SeverityLevel[] = ['emerg', 'alert', 'crit', 'error', 'warning', 'notice', 'info', 'debug'];
	const SEVERITY_LABELS: Record<SeverityLevel, string> = {
		emerg: 'Emergency',
		alert: 'Alert',
		crit: 'Critical',
		error: 'Error',
		warning: 'Warning',
		notice: 'Notice',
		info: 'Info',
		debug: 'Debug'
	};

	let logEntries = $state<LogEntry[]>([]);
	let severityFilter = $state<'all' | 'error' | 'warning' | 'info' | 'debug'>('all');
	let searchQuery = $state('');
	let autoScroll = $state(true);
	let loading = $state(true);
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let logContainer: HTMLElement | undefined;

	function getSeverity(priority: number): SeverityLevel {
		const sev = priority >> 3;
		return SEVERITY_NAMES[sev] ?? 'info';
	}

	function getSeverityGroup(severity: SeverityLevel): 'error' | 'warning' | 'info' | 'debug' {
		switch (severity) {
			case 'emerg':
			case 'alert':
			case 'crit':
			case 'error':
				return 'error';
			case 'warning':
				return 'warning';
			case 'debug':
				return 'debug';
			default:
				return 'info';
		}
	}

	function formatTime(timeMs: number): string {
		const d = new Date(timeMs);
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	const filteredEntries = $derived.by(() => {
		let entries = logEntries;

		if (severityFilter !== 'all') {
			entries = entries.filter((entry) => getSeverityGroup(getSeverity(entry.priority)) === severityFilter);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			entries = entries.filter((entry) => entry.msg.toLowerCase().includes(q));
		}

		return entries;
	});

	$effect(() => {
		if (autoScroll && logContainer && filteredEntries.length > 0) {
			requestAnimationFrame(() => {
				if (logContainer) {
					logContainer.scrollTop = logContainer.scrollHeight;
				}
			});
		}
	});

	async function fetchLogs() {
		try {
			const result = await call<{ log: LogEntry[] }>('log', 'read', { lines: 200, stream: false });
			if (result?.log && Array.isArray(result.log)) {
				logEntries = result.log;
			}
		} catch (err) {
			console.error('Failed to fetch logs:', err);
		} finally {
			loading = false;
		}
	}

	function clearLogs() {
		logEntries = [];
	}

	function exportLogs() {
		const lines = filteredEntries.map(entry => {
			const time = formatTime(entry.time);
			const sev = getSeverity(entry.priority).toUpperCase();
			return `${time} [${sev}] ${entry.msg}`;
		});
		const text = lines.join('\n');
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `openwrt-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	onMount(() => {
		fetchLogs();
		pollTimer = setInterval(fetchLogs, 3000);
		return () => {
			if (pollTimer) clearInterval(pollTimer);
		};
	});
</script>

<div class="log-page">
	<div class="page-header">
		<h1>System Log</h1>
		<div class="header-actions">
			<label class="auto-scroll-toggle">
				<input type="checkbox" bind:checked={autoScroll} />
				Auto-scroll
			</label>
			<button class="btn secondary" onclick={clearLogs}>Clear</button>
			<button class="btn secondary" onclick={exportLogs}>Export</button>
		</div>
	</div>

	<div class="toolbar">
		<input
			type="text"
			class="search-input"
			placeholder="Search log messages..."
			bind:value={searchQuery}
		/>
		<div class="filter-buttons">
			<button class:active={severityFilter === 'all'} onclick={() => (severityFilter = 'all')}>All</button>
			<button class:active={severityFilter === 'error'} onclick={() => (severityFilter = 'error')}>Error</button>
			<button class:active={severityFilter === 'warning'} onclick={() => (severityFilter = 'warning')}>Warning</button>
			<button class:active={severityFilter === 'info'} onclick={() => (severityFilter = 'info')}>Info</button>
			<button class:active={severityFilter === 'debug'} onclick={() => (severityFilter = 'debug')}>Debug</button>
		</div>
	</div>

	<div class="log-count">
		<span class="text-muted">{filteredEntries.length} of {logEntries.length} entries</span>
	</div>

	<div class="log-container" bind:this={logContainer}>
		{#if loading}
			<div class="loading">Loading logs...</div>
		{:else if filteredEntries.length === 0}
			<div class="empty-state">No log entries found</div>
		{:else}
			<div class="log-content">
				{#each filteredEntries as entry (entry.id)}
					{@const severity = getSeverity(entry.priority)}
					{@const group = getSeverityGroup(severity)}
					<div class="log-line {group}">
						<span class="log-timestamp">{formatTime(entry.time)}</span>
						<span class="log-severity {group}">{severity.toUpperCase()}</span>
						<span class="log-message">{entry.msg}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.log-page {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 1400px;
		height: calc(100vh - 120px);
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}

	.page-header h1 {
		font-size: 24px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.auto-scroll-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
		cursor: pointer;
		user-select: none;
	}

	.auto-scroll-toggle input {
		accent-color: var(--color-accent);
	}

	.btn {
		padding: 6px 14px;
		border: none;
		border-radius: var(--radius-md);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn.secondary {
		background: var(--color-surface-700);
		color: var(--color-text-secondary);
	}

	.btn.secondary:hover {
		background: var(--color-surface-600, var(--color-surface-500));
		color: var(--color-text-primary);
	}

	.toolbar {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
		padding: 8px 12px;
		background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-size: 14px;
		outline: none;
		transition: all 0.2s ease;
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.search-input:focus {
		border-color: var(--color-accent);
	}

	.filter-buttons {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.filter-buttons button {
		padding: 8px 16px;
		background: var(--color-surface-800);
		border: none;
		color: var(--color-text-secondary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.filter-buttons button:not(:last-child) {
		border-right: 1px solid var(--color-surface-500);
	}

	.filter-buttons button.active {
		background: var(--color-accent-muted);
		color: var(--color-accent-light);
	}

	.filter-buttons button:hover:not(.active) {
		background: var(--color-surface-700);
	}

	.log-count {
		font-size: 12px;
	}

	.text-muted {
		color: var(--color-text-muted);
	}

	.log-container {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		background: #0a0c10;
		border: 1px solid var(--color-surface-500);
		border-radius: 10px;
	}

	.log-content {
		padding: 8px 0;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.6;
	}

	.log-line {
		display: flex;
		gap: 12px;
		padding: 3px 16px;
		border-left: 3px solid transparent;
		transition: background 0.15s ease;
	}

	.log-line:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.log-line.error {
		border-left-color: #ef4444;
	}

	.log-line.warning {
		border-left-color: #f59e0b;
	}

	.log-line.info {
		border-left-color: #3b82f6;
	}

	.log-line.debug {
		border-left-color: #6b7280;
	}

	.log-timestamp {
		color: #6b7280;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.log-severity {
		white-space: nowrap;
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		min-width: 56px;
	}

	.log-severity.error { color: #ef4444; }
	.log-severity.warning { color: #f59e0b; }
	.log-severity.info { color: #3b82f6; }
	.log-severity.debug { color: #6b7280; }

	.log-message {
		color: var(--color-text-secondary);
		word-break: break-all;
		white-space: pre-wrap;
	}

	.log-line.error .log-message {
		color: #ef4444;
	}

	.log-line.warning .log-message {
		color: #f59e0b;
	}

	.log-line.debug .log-message {
		color: #6b7280;
	}

	.loading,
	.empty-state {
		padding: 40px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 14px;
	}
</style>
