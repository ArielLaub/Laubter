<script lang="ts">
	import { onMount } from 'svelte';
	import { call } from '$api/ubus';

	interface Package {
		name: string;
		version: string;
	}

	let loading = $state(true);
	let packages = $state<Package[]>([]);
	let searchQuery = $state('');
	let sortBy = $state<'name' | 'version'>('name');
	let sortAsc = $state(true);

	const filteredPackages = $derived.by(() => {
		let result = packages;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			result = result.filter(p => p.name.toLowerCase().includes(q) || p.version.toLowerCase().includes(q));
		}
		result = [...result].sort((a, b) => {
			const cmp = a[sortBy].localeCompare(b[sortBy]);
			return sortAsc ? cmp : -cmp;
		});
		return result;
	});

	onMount(async () => {
		try {
			const result = await call<{ packages: Record<string, string> }>('rpc-sys', 'packagelist', { all: false });
			if (result?.packages) {
				packages = Object.entries(result.packages).map(([name, version]) => ({ name, version }));
			}
		} catch (e) {
			console.error('Failed to load packages:', e);
		}
		loading = false;
	});

	function toggleSort(col: 'name' | 'version') {
		if (sortBy === col) {
			sortAsc = !sortAsc;
		} else {
			sortBy = col;
			sortAsc = true;
		}
	}

	function sortIndicator(col: 'name' | 'version'): string {
		if (sortBy !== col) return '';
		return sortAsc ? ' \u2191' : ' \u2193';
	}
</script>

<div class="page">
	<h1>Packages</h1>
	<p class="subtitle">Installed software packages</p>

	{#if loading}
		<div class="loading">Loading packages...</div>
	{:else}
		<div class="toolbar">
			<div class="search-box">
				<input
					type="text"
					class="search-input"
					bind:value={searchQuery}
					placeholder="Search packages..."
				/>
			</div>
			<span class="package-count">{filteredPackages.length} of {packages.length} packages</span>
		</div>

		<div class="table-card">
			<div class="table-container">
				<div class="table-header">
					<button class="col-name header-btn" onclick={() => toggleSort('name')}>
						Name{sortIndicator('name')}
					</button>
					<button class="col-version header-btn" onclick={() => toggleSort('version')}>
						Version{sortIndicator('version')}
					</button>
				</div>
				<div class="table-body">
					{#each filteredPackages as pkg (pkg.name)}
						<div class="table-row">
							<span class="col-name">{pkg.name}</span>
							<span class="col-version mono">{pkg.version}</span>
						</div>
					{:else}
						<div class="table-empty">
							{searchQuery ? 'No packages match your search.' : 'No packages installed.'}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 16px; }
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* Toolbar */
	.toolbar {
		display: flex; align-items: center; justify-content: space-between; gap: 16px;
	}
	.search-box { flex: 1; max-width: 400px; }
	.search-input {
		width: 100%; padding: 8px 12px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
	}
	.search-input:focus { border-color: var(--color-accent); }
	.search-input::placeholder { color: var(--color-text-muted); }
	.package-count { font-size: 13px; color: var(--color-text-muted); white-space: nowrap; }

	/* Table */
	.table-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-md); overflow: hidden;
	}
	.table-container { max-height: 600px; overflow-y: auto; }

	.table-header, .table-row {
		display: grid; grid-template-columns: 1fr 1fr;
		align-items: center; padding: 8px 16px;
	}
	.table-header {
		font-size: 12px; color: var(--color-text-muted); text-transform: uppercase;
		border-bottom: 1px solid var(--color-surface-600);
		position: sticky; top: 0; background: var(--color-surface-800); z-index: 1;
	}
	.header-btn {
		background: none; border: none; color: var(--color-text-muted);
		font-size: 12px; text-transform: uppercase; cursor: pointer;
		text-align: left; padding: 4px 0;
	}
	.header-btn:hover { color: var(--color-text-primary); }

	.table-row {
		font-size: 13px; color: var(--color-text-primary);
		border-bottom: 1px solid var(--color-surface-700);
	}
	.table-row:hover { background: var(--color-surface-700); }
	.table-row:last-child { border-bottom: none; }

	.mono { font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary); }

	.table-empty {
		padding: 32px; text-align: center; color: var(--color-text-muted); font-size: 14px;
	}

	@media (max-width: 600px) {
		.table-header, .table-row {
			grid-template-columns: 1.5fr 1fr;
		}
	}
</style>
