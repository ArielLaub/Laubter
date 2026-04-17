<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { call } from '$api/ubus';
	import { formatBytes } from '$utils/format';

	interface Process {
		pid: number;
		ppid: number;
		user: string;
		stat: string;
		vsz_kb: number;
		rss_kb: number;
		cpu: string;
		mem: string;
		cmd: string;
	}

	let processes = $state<Process[]>([]);
	let memUsedKb = $state(0);
	let memFreeKb = $state(0);
	let cpuUsr = $state(0);
	let cpuSys = $state(0);
	let cpuIdle = $state(0);
	let loading = $state(true);
	let sortColumn = $state<string>('rss');
	let sortAsc = $state(false);
	let searchQuery = $state('');
	let killTarget = $state<Process | null>(null);
	let killSignal = $state(15);

	async function fetchProcesses() {
		try {
			const data = await call<{
				mem_used_kb: number; mem_free_kb: number;
				cpu_usr: number; cpu_sys: number; cpu_idle: number;
				processes: Process[];
			}>('laubter-processes', 'get_all', {});

			processes = data.processes || [];
			memUsedKb = data.mem_used_kb || 0;
			memFreeKb = data.mem_free_kb || 0;
			cpuUsr = data.cpu_usr || 0;
			cpuSys = data.cpu_sys || 0;
			cpuIdle = data.cpu_idle || 0;
		} catch (e) {
			console.error('Failed to fetch processes:', e);
		} finally {
			loading = false;
		}
	}

	const filtered = $derived.by(() => {
		let list = processes.filter(p => p.pid > 0 && p.cmd);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(p =>
				p.cmd.toLowerCase().includes(q) ||
				p.user.toLowerCase().includes(q) ||
				String(p.pid).includes(q)
			);
		}
		return list;
	});

	const sorted = $derived.by(() => {
		const list = [...filtered];
		const dir = sortAsc ? 1 : -1;
		list.sort((a, b) => {
			switch (sortColumn) {
				case 'pid': return dir * (a.pid - b.pid);
				case 'user': return dir * a.user.localeCompare(b.user);
				case 'cpu': return dir * (parseFloat(a.cpu) - parseFloat(b.cpu));
				case 'mem': return dir * (parseFloat(a.mem) - parseFloat(b.mem));
				case 'rss': return dir * (a.rss_kb - b.rss_kb);
				case 'vsz': return dir * (a.vsz_kb - b.vsz_kb);
				case 'cmd': return dir * a.cmd.localeCompare(b.cmd);
				default: return 0;
			}
		});
		return list;
	});

	const totalMem = $derived(memUsedKb + memFreeKb);
	const memPercent = $derived(totalMem > 0 ? Math.round((memUsedKb / totalMem) * 100) : 0);
	const cpuPercent = $derived(100 - cpuIdle);

	function toggleSort(col: string) {
		if (sortColumn === col) sortAsc = !sortAsc;
		else { sortColumn = col; sortAsc = col === 'cmd' || col === 'user'; }
	}
	function si(col: string): string {
		if (sortColumn !== col) return '';
		return sortAsc ? ' ▲' : ' ▼';
	}

	function fmtKb(kb: number): string {
		if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
		if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
		return `${kb} KB`;
	}

	function shortCmd(cmd: string): string {
		// Extract just the binary name from the full command
		const parts = cmd.split(/\s+/);
		const bin = parts[0].split('/').pop() || parts[0];
		return bin;
	}

	async function confirmKill() {
		if (!killTarget) return;
		try {
			await call('laubter-processes', 'kill', { pid: killTarget.pid, signal: killSignal });
			killTarget = null;
			setTimeout(fetchProcesses, 1000);
		} catch (e) {
			console.error('Kill failed:', e);
		}
	}

	let timer: ReturnType<typeof setInterval>;
	onMount(() => {
		fetchProcesses();
		timer = setInterval(fetchProcesses, 3000);
	});
	onDestroy(() => clearInterval(timer));
</script>

<div class="page">
	<h1>Processes</h1>

	<!-- System summary bar -->
	<div class="summary-bar">
		<div class="sb-item">
			<span class="sb-label">CPU</span>
			<div class="sb-bar-wrap">
				<div class="sb-bar cpu" style="width: {cpuPercent}%"></div>
			</div>
			<span class="sb-val">{cpuPercent}%</span>
		</div>
		<div class="sb-item">
			<span class="sb-label">Memory</span>
			<div class="sb-bar-wrap">
				<div class="sb-bar mem" style="width: {memPercent}%"></div>
			</div>
			<span class="sb-val">{fmtKb(memUsedKb)} / {fmtKb(totalMem)}</span>
		</div>
		<div class="sb-item">
			<span class="sb-label">Processes</span>
			<span class="sb-val">{filtered.length}</span>
		</div>
	</div>

	<!-- Search -->
	<div class="toolbar">
		<input type="text" class="search" placeholder="Search by name, user, or PID..." bind:value={searchQuery} />
	</div>

	<!-- Process table -->
	<div class="table-card">
		<table>
			<thead>
				<tr>
					<th class="col-pid" onclick={() => toggleSort('pid')}>PID{si('pid')}</th>
					<th onclick={() => toggleSort('cmd')}>Process{si('cmd')}</th>
					<th onclick={() => toggleSort('user')}>User{si('user')}</th>
					<th class="col-num" onclick={() => toggleSort('cpu')}>CPU%{si('cpu')}</th>
					<th class="col-num" onclick={() => toggleSort('rss')}>Memory{si('rss')}</th>
					<th class="col-num" onclick={() => toggleSort('vsz')}>Virtual{si('vsz')}</th>
					<th class="col-stat">State</th>
					<th class="col-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as proc (proc.pid)}
					{@const isHeavy = proc.rss_kb > 50000}
					<tr class:heavy={isHeavy}>
						<td class="mono pid-cell">{proc.pid}</td>
						<td class="cmd-cell">
							<span class="cmd-name">{shortCmd(proc.cmd)}</span>
							<span class="cmd-full" title={proc.cmd}>{proc.cmd}</span>
						</td>
						<td class="user-cell">{proc.user}</td>
						<td class="mono num-cell">{proc.cpu}%</td>
						<td class="mono num-cell" class:warn={proc.rss_kb > 100000} class:crit={proc.rss_kb > 500000}>
							{fmtKb(proc.rss_kb)}
						</td>
						<td class="mono num-cell">{fmtKb(proc.vsz_kb)}</td>
						<td class="stat-cell">
							<span class="stat-badge" class:running={proc.stat.startsWith('R')} class:sleeping={proc.stat.startsWith('S')}>
								{proc.stat}
							</span>
						</td>
						<td class="actions-cell">
							{#if proc.pid > 1}
								<button class="kill-btn" title="Send signal" onclick={() => { killTarget = proc; killSignal = 15; }}>
									✕
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- Kill confirmation modal -->
{#if killTarget}
	<div class="modal-backdrop" role="presentation" onclick={() => { killTarget = null; }}>
		<div class="modal" role="dialog" onclick={(e) => e.stopPropagation()}>
			<h3>Send Signal to Process</h3>
			<p class="modal-desc">
				<strong>{shortCmd(killTarget.cmd)}</strong> (PID {killTarget.pid})
			</p>
			<div class="modal-field">
				<label>Signal</label>
				<select bind:value={killSignal}>
					<option value={15}>SIGTERM (15) — Graceful stop</option>
					<option value={9}>SIGKILL (9) — Force kill</option>
					<option value={1}>SIGHUP (1) — Reload config</option>
					<option value={2}>SIGINT (2) — Interrupt</option>
				</select>
			</div>
			<div class="modal-actions">
				<button class="btn-cancel" onclick={() => { killTarget = null; }}>Cancel</button>
				<button class="btn-danger" onclick={confirmKill}>Send Signal</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page { display: flex; flex-direction: column; gap: 16px; max-width: 1400px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0; }

	/* Summary bar */
	.summary-bar {
		display: flex; gap: 24px; align-items: center;
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; padding: 14px 20px;
	}
	.sb-item { display: flex; align-items: center; gap: 10px; flex: 1; }
	.sb-item:last-child { flex: 0; }
	.sb-label { font-size: 12px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; white-space: nowrap; }
	.sb-bar-wrap { flex: 1; height: 6px; background: var(--color-surface-600); border-radius: 3px; min-width: 80px; }
	.sb-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
	.sb-bar.cpu { background: #22c55e; }
	.sb-bar.mem { background: #a855f7; }
	.sb-val { font-size: 13px; font-family: var(--font-mono); color: var(--color-text-primary); white-space: nowrap; }

	/* Toolbar */
	.toolbar { display: flex; }
	.search {
		flex: 1; padding: 8px 14px; background: var(--color-surface-800);
		border: 1px solid var(--color-surface-500); border-radius: 10px;
		color: var(--color-text-primary); font-size: 14px; font-family: inherit; outline: none;
	}
	.search:focus { border-color: var(--color-accent); }
	.search::placeholder { color: var(--color-text-muted); }

	/* Table */
	.table-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 10px; overflow-x: auto;
	}
	table { width: 100%; border-collapse: collapse; }
	thead th {
		text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600;
		color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;
		border-bottom: 1px solid var(--color-surface-500);
		cursor: pointer; user-select: none; white-space: nowrap;
	}
	thead th:hover { color: var(--color-text-secondary); }
	tbody td { padding: 8px 12px; font-size: 13px; color: var(--color-text-primary); border-bottom: 1px solid var(--color-surface-700); }
	tbody tr:last-child td { border-bottom: none; }
	tbody tr:hover td { background: rgba(255,255,255,0.03); }
	tbody tr.heavy td { background: rgba(168,85,247,0.04); }

	.col-pid { width: 60px; }
	.col-num { width: 90px; text-align: right; }
	.col-stat { width: 50px; }
	.col-actions { width: 40px; }

	.mono { font-family: var(--font-mono); font-size: 12px; }
	.pid-cell { color: var(--color-text-muted); }
	.num-cell { text-align: right; }
	.num-cell.warn { color: #f59e0b; }
	.num-cell.crit { color: #ef4444; font-weight: 600; }

	.cmd-cell { max-width: 300px; overflow: hidden; }
	.cmd-name { font-weight: 600; color: var(--color-text-primary); display: block; }
	.cmd-full { font-size: 11px; color: var(--color-text-muted); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.user-cell { font-size: 12px; color: var(--color-text-secondary); }

	.stat-badge {
		font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
		background: var(--color-surface-600); color: var(--color-text-muted);
	}
	.stat-badge.running { background: rgba(34,197,94,0.15); color: #22c55e; }
	.stat-badge.sleeping { background: var(--color-surface-600); color: var(--color-text-muted); }

	.kill-btn {
		background: none; border: 1px solid var(--color-surface-500); border-radius: 6px;
		color: var(--color-text-muted); cursor: pointer; width: 26px; height: 26px;
		display: flex; align-items: center; justify-content: center; font-size: 12px;
	}
	.kill-btn:hover { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.3); }

	/* Kill modal */
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200;
		display: flex; align-items: center; justify-content: center;
		backdrop-filter: blur(2px);
	}
	.modal {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 14px; padding: 24px; width: 400px; max-width: 90vw;
	}
	.modal h3 { font-size: 17px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 8px; }
	.modal-desc { font-size: 13px; color: var(--color-text-muted); margin: 0 0 16px; }
	.modal-field { margin-bottom: 16px; }
	.modal-field label { font-size: 13px; color: var(--color-text-secondary); display: block; margin-bottom: 6px; }
	.modal-field select {
		width: 100%; padding: 10px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 13px; font-family: inherit;
	}
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-cancel {
		padding: 8px 16px; background: var(--color-surface-600); color: var(--color-text-primary);
		border: none; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px;
	}
	.btn-danger {
		padding: 8px 16px; background: #ef4444; color: white;
		border: none; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px;
	}
</style>
