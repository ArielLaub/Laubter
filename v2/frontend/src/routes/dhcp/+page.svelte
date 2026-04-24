<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Plus, Pencil, Trash2, ArrowRight, Search } from 'lucide-svelte';

  type Tab = 'leases' | 'hosts' | 'dns' | 'pools' | 'settings';
  type Section = Record<string, string | string[] | boolean>;

  let activeTab = $state<Tab>('leases');
  let dirty = $state(false);
  let applying = $state(false);
  let search = $state('');

  // Data
  interface Lease { ts: number; mac: string; ip: string; hostname: string; }
  let hosts = $state<Section[]>([]);
  let domains = $state<Section[]>([]);
  let pools = $state<Section[]>([]);
  let dnsmasq = $state<Section>({});

  const leaseStream = subscribe<Lease[]>('dhcp:leases');
  const leases = $derived($leaseStream ?? []);

  // Static host form
  let showHostForm = $state(false);
  let editingHost = $state('');
  let hostForm = $state({ name: '', mac: '', ip: '', leasetime: '', dns: false });

  // DNS record form
  let showDnsForm = $state(false);
  let editingDns = $state('');
  let dnsForm = $state({ name: '', ip: '' });

  // Which leases have static hosts
  const staticMacs = $derived(new Set(hosts.map(h => {
    const mac = Array.isArray(h.mac) ? h.mac[0] : h.mac;
    return (mac as string)?.toUpperCase();
  }).filter(Boolean)));

  const dynamicLeases = $derived(leases.filter(l => !staticMacs.has(l.mac?.toUpperCase())));

  const filteredHosts = $derived.by(() => {
    if (!search.trim()) return hosts;
    const q = search.toLowerCase();
    return hosts.filter(h =>
      (h.name as string)?.toLowerCase().includes(q) ||
      (h.ip as string)?.toLowerCase().includes(q) ||
      String(h.mac).toLowerCase().includes(q)
    );
  });

  // --- Load ---
  async function loadAll() {
    const [h, d, p, dm] = await Promise.all([
      api<Section[]>('/api/dhcp/hosts').catch(() => []),
      api<Section[]>('/api/dhcp/domains').catch(() => []),
      api<Section[]>('/api/dhcp/pools').catch(() => []),
      api<Section>('/api/dhcp/dnsmasq').catch(() => ({})),
    ]);
    hosts = h; domains = d; pools = p; dnsmasq = dm;
    dirty = false;
  }

  // --- Host CRUD ---
  function startAddHost(lease?: Lease) {
    hostForm = { name: lease?.hostname ?? '', mac: lease?.mac ?? '', ip: lease?.ip ?? '', leasetime: '', dns: false };
    editingHost = '';
    showHostForm = true;
    activeTab = 'hosts';
  }

  function startEditHost(host: Section) {
    editingHost = host['.name'] as string;
    hostForm = {
      name: (host.name as string) ?? '',
      mac: Array.isArray(host.mac) ? host.mac[0] : (host.mac as string) ?? '',
      ip: (host.ip as string) ?? '',
      leasetime: (host.leasetime as string) ?? '',
      dns: host.dns === '1'
    };
    showHostForm = true;
  }

  async function saveHost() {
    if (!hostForm.mac || !hostForm.ip) return;
    const body: Record<string, string | string[]> = {
      name: hostForm.name,
      mac: [hostForm.mac],
      ip: hostForm.ip,
    };
    if (hostForm.leasetime) body.leasetime = hostForm.leasetime;
    if (hostForm.dns) body.dns = '1';

    if (editingHost) {
      await api(`/api/dhcp/hosts/${editingHost}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/dhcp/hosts', { method: 'POST', body: JSON.stringify(body) });
    }
    showHostForm = false;
    dirty = true;
    await loadAll();
  }

  async function deleteHost(section: string) {
    await api(`/api/dhcp/hosts/${section}`, { method: 'DELETE' });
    dirty = true;
    await loadAll();
  }

  // --- DNS Record CRUD ---
  function startAddDns() {
    dnsForm = { name: '', ip: '' };
    editingDns = '';
    showDnsForm = true;
  }

  function startEditDns(rec: Section) {
    editingDns = rec['.name'] as string;
    dnsForm = { name: (rec.name as string) ?? '', ip: (rec.ip as string) ?? '' };
    showDnsForm = true;
  }

  async function saveDns() {
    if (!dnsForm.name || !dnsForm.ip) return;
    if (editingDns) {
      await api(`/api/dhcp/domains/${editingDns}`, { method: 'PUT', body: JSON.stringify(dnsForm) });
    } else {
      await api('/api/dhcp/domains', { method: 'POST', body: JSON.stringify(dnsForm) });
    }
    showDnsForm = false;
    dirty = true;
    await loadAll();
  }

  async function deleteDns(section: string) {
    await api(`/api/dhcp/domains/${section}`, { method: 'DELETE' });
    dirty = true;
    await loadAll();
  }

  // --- Pool config ---
  async function savePool(pool: Section, field: string, value: string) {
    const section = pool['.name'] as string;
    await api(`/api/dhcp/pools/${section}`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
    dirty = true;
    await loadAll();
  }

  // --- dnsmasq config ---
  async function saveDnsmasq(field: string, value: string) {
    await api('/api/dhcp/dnsmasq', { method: 'PUT', body: JSON.stringify({ [field]: value }) });
    dirty = true;
    await loadAll();
  }

  // --- Apply / Revert ---
  async function applyChanges() {
    applying = true;
    await api('/api/dhcp/apply', { method: 'POST' });
    applying = false;
    dirty = false;
  }

  async function revertChanges() {
    await api('/api/dhcp/revert', { method: 'POST' });
    await loadAll();
  }

  const btn = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
  const btnPrimary = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)]`;
  const btnSecondary = `${btn} bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)]`;
  const input = 'w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]';
  const label = 'block text-[12px] text-[#8b949e] mb-1.5 font-medium';

  onMount(loadAll);
</script>

<div class="space-y-4">
  <h1 class="text-2xl font-bold text-white">DHCP & DNS</h1>

  <!-- Tabs -->
  <div class="flex gap-0 border-b-2 border-[var(--color-surface-500)] overflow-x-auto">
    {#each [
      { id: 'leases', label: 'Active Leases', count: leases.length },
      { id: 'hosts', label: 'Static Leases', count: hosts.length },
      { id: 'dns', label: 'DNS Records', count: domains.length },
      { id: 'pools', label: 'DHCP Pools', count: pools.length },
      { id: 'settings', label: 'Server Settings', count: 0 },
    ] as tab}
      <button class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors
        {activeTab === tab.id ? 'text-[var(--color-accent-light)] border-[var(--color-accent)]' : 'text-[#8b949e] border-transparent hover:text-white'}"
        onclick={() => activeTab = tab.id as Tab}>
        {tab.label}
        {#if tab.count > 0}<span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full {activeTab === tab.id ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}">{tab.count}</span>{/if}
      </button>
    {/each}
  </div>

  <!-- =================== ACTIVE LEASES =================== -->
  {#if activeTab === 'leases'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">{dynamicLeases.length} dynamic leases ({staticMacs.size} static)</h2>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--color-surface-500)]">
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Hostname</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">IP</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">MAC</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Expires</th>
            <th class="w-16"></th>
          </tr>
        </thead>
        <tbody>
          {#each dynamicLeases as lease (lease.mac)}
            <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
              <td class="px-4 py-2.5 font-medium text-white">{lease.hostname || '(unknown)'}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{lease.ip}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{lease.mac?.toUpperCase()}</td>
              <td class="px-4 py-2.5 text-xs text-[#8b949e]">{new Date(lease.ts * 1000).toLocaleString()}</td>
              <td class="px-4 py-2.5">
                <button class="text-[11px] px-2 py-1 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)] hover:bg-[var(--color-accent)] hover:text-white transition-colors"
                  onclick={() => startAddHost(lease)}>
                  Make Static
                </button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="px-4 py-12 text-center text-[#8b949e]">No dynamic leases</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- =================== STATIC LEASES =================== -->
  {:else if activeTab === 'hosts'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-white">Static Leases</h2>
          <div class="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg">
            <Search size={13} class="text-[#8b949e]" />
            <input type="text" bind:value={search} placeholder="Search..." class="bg-transparent border-none outline-none text-xs text-white w-32 placeholder:text-[#8b949e]" />
          </div>
        </div>
        <button class={btnPrimary} onclick={() => startAddHost()}><Plus size={14} class="inline -mt-0.5" /> Add Static Lease</button>
      </div>

      {#if showHostForm}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <h3 class="text-sm font-semibold text-[#c9d1d9] mb-3">{editingHost ? 'Edit' : 'New'} Static Lease</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label class={label}>Hostname</label><input class={input} bind:value={hostForm.name} placeholder="e.g. my-device" /></div>
            <div><label class={label}>MAC Address</label><input class="{input} font-mono text-xs" bind:value={hostForm.mac} placeholder="AA:BB:CC:DD:EE:FF" /></div>
            <div><label class={label}>IP Address</label><input class="{input} font-mono text-xs" bind:value={hostForm.ip} placeholder="192.168.50.100" /></div>
            <div><label class={label}>Lease Time</label>
              <select class={input} bind:value={hostForm.leasetime}>
                <option value="">Default</option>
                <option value="1h">1 hour</option>
                <option value="6h">6 hours</option>
                <option value="12h">12 hours</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="infinite">Infinite</option>
              </select>
            </div>
          </div>
          <div class="flex items-center justify-between mt-3">
            <label class="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer">
              <input type="checkbox" bind:checked={hostForm.dns} class="rounded" />
              Create DNS entry for this host
            </label>
            <div class="flex gap-2">
              <button class={btnSecondary} onclick={() => showHostForm = false}>Cancel</button>
              <button class={btnPrimary} onclick={saveHost}>{editingHost ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      {/if}

      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--color-surface-500)]">
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Hostname</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">MAC</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">IP</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Lease</th>
            <th class="w-20"></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredHosts as host (host['.name'])}
            <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
              <td class="px-4 py-2.5">
                <span class="font-medium text-white">{host.name || '(unnamed)'}</span>
                {#if host.dns === '1'}<span class="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">DNS</span>{/if}
              </td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{Array.isArray(host.mac) ? host.mac[0] : host.mac}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{host.ip}</td>
              <td class="px-4 py-2.5 text-xs text-[#8b949e]">{host.leasetime || 'default'}</td>
              <td class="px-4 py-2.5 text-right">
                <button class="p-1 text-[#8b949e] hover:text-white" onclick={() => startEditHost(host)}><Pencil size={13} /></button>
                <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => deleteHost(host['.name'] as string)}><Trash2 size={13} /></button>
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="px-4 py-12 text-center text-[#8b949e]">No static leases</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- =================== DNS RECORDS =================== -->
  {:else if activeTab === 'dns'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">DNS Records</h2>
        <button class={btnPrimary} onclick={startAddDns}><Plus size={14} class="inline -mt-0.5" /> Add Record</button>
      </div>

      {#if showDnsForm}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <div class="grid grid-cols-2 gap-3">
            <div><label class={label}>Hostname</label><input class={input} bind:value={dnsForm.name} placeholder="e.g. myservice.local" /></div>
            <div><label class={label}>IP Address</label><input class="{input} font-mono text-xs" bind:value={dnsForm.ip} placeholder="192.168.50.100" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button class={btnSecondary} onclick={() => showDnsForm = false}>Cancel</button>
            <button class={btnPrimary} onclick={saveDns}>{editingDns ? 'Update' : 'Create'}</button>
          </div>
        </div>
      {/if}

      {#if domains.length === 0 && !showDnsForm}
        <div class="py-12 text-center text-[#8b949e] text-sm">No custom DNS records</div>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--color-surface-500)]">
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Hostname</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">IP</th>
              <th class="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {#each domains as rec (rec['.name'])}
              <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
                <td class="px-4 py-2.5 font-medium text-white">{rec.name}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{rec.ip}</td>
                <td class="px-4 py-2.5 text-right">
                  <button class="p-1 text-[#8b949e] hover:text-white" onclick={() => startEditDns(rec)}><Pencil size={13} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => deleteDns(rec['.name'] as string)}><Trash2 size={13} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

  <!-- =================== DHCP POOLS =================== -->
  {:else if activeTab === 'pools'}
    <div class="space-y-4">
      {#each pools as pool (pool['.name'])}
        <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
          <div class="flex items-center gap-2 mb-4">
            <span class="font-bold text-white text-sm uppercase">{pool.interface}</span>
            {#if pool.ignore === '1'}<span class="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(239,68,68,0.15)] text-[#ef4444]">Disabled</span>{/if}
            {#if pool.dhcpv4 === 'server'}<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">DHCPv4</span>{/if}
            {#if pool.dhcpv6 === 'server'}<span class="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(139,92,246,0.15)] text-[#a78bfa]">DHCPv6</span>{/if}
            {#if pool.ra === 'server'}<span class="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(34,197,94,0.15)] text-[#22c55e]">RA</span>{/if}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label class={label}>Start Address</label>
              <input class="{input} font-mono text-xs" value={pool.start}
                onchange={(e) => savePool(pool, 'start', (e.target as HTMLInputElement).value)} />
            </div>
            <div>
              <label class={label}>Limit (# of IPs)</label>
              <input class="{input} font-mono text-xs" value={pool.limit}
                onchange={(e) => savePool(pool, 'limit', (e.target as HTMLInputElement).value)} />
            </div>
            <div>
              <label class={label}>Lease Time</label>
              <select class={input} value={pool.leasetime}
                onchange={(e) => savePool(pool, 'leasetime', (e.target as HTMLSelectElement).value)}>
                <option value="1h">1 hour</option>
                <option value="6h">6 hours</option>
                <option value="12h">12 hours</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
              </select>
            </div>
            <div>
              <label class={label}>IPv6 RA Mode</label>
              <select class={input} value={pool.ra}
                onchange={(e) => savePool(pool, 'ra', (e.target as HTMLSelectElement).value)}>
                <option value="">Disabled</option>
                <option value="server">Server</option>
                <option value="relay">Relay</option>
              </select>
            </div>
          </div>
          {#if Array.isArray(pool.dhcp_option) && pool.dhcp_option.length > 0}
            <div class="mt-3">
              <label class={label}>Custom DHCP Options</label>
              <div class="flex flex-wrap gap-1.5">
                {#each pool.dhcp_option as opt}
                  <span class="text-[11px] px-2 py-0.5 rounded bg-[var(--color-surface-700)] text-[#c9d1d9] font-mono">{opt}</span>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

  <!-- =================== SERVER SETTINGS =================== -->
  {:else if activeTab === 'settings'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5 space-y-4">
      <h2 class="text-sm font-semibold text-white">dnsmasq Configuration</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label class={label}>Local Domain</label>
          <input class={input} value={dnsmasq.domain ?? 'lan'}
            onchange={(e) => saveDnsmasq('domain', (e.target as HTMLInputElement).value)} />
        </div>
        <div>
          <label class={label}>Local Server</label>
          <input class="{input} font-mono text-xs" value={dnsmasq.local ?? '/lan/'}
            onchange={(e) => saveDnsmasq('local', (e.target as HTMLInputElement).value)} />
        </div>
        <div>
          <label class={label}>DNS Cache Size</label>
          <input class="{input} font-mono text-xs" type="number" value={dnsmasq.cachesize ?? '1000'}
            onchange={(e) => saveDnsmasq('cachesize', (e.target as HTMLInputElement).value)} />
        </div>
        <div>
          <label class={label}>DNS Port (0 = disabled)</label>
          <input class="{input} font-mono text-xs" type="number" value={dnsmasq.port ?? '0'}
            onchange={(e) => saveDnsmasq('port', (e.target as HTMLInputElement).value)} />
        </div>
        <div>
          <label class={label}>EDNS Packet Max</label>
          <input class="{input} font-mono text-xs" type="number" value={dnsmasq.ednspacket_max ?? '1232'}
            onchange={(e) => saveDnsmasq('ednspacket_max', (e.target as HTMLInputElement).value)} />
        </div>
        <div>
          <label class={label}>Lease File</label>
          <input class="{input} font-mono text-xs" value={dnsmasq.leasefile ?? '/tmp/dhcp.leases'} disabled />
        </div>
      </div>

      <h3 class="text-xs font-semibold text-[#8b949e] uppercase tracking-wider mt-4">Options</h3>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        {#each [
          { key: 'authoritative', label: 'Authoritative DHCP' },
          { key: 'domainneeded', label: 'Domain required (filter bad queries)' },
          { key: 'boguspriv', label: 'Bogus private reverse lookups' },
          { key: 'localise_queries', label: 'Localise queries' },
          { key: 'expandhosts', label: 'Expand hosts (add domain to names)' },
          { key: 'rebind_protection', label: 'DNS rebind protection' },
          { key: 'readethers', label: 'Read /etc/ethers' },
          { key: 'localservice', label: 'Local service only' },
          { key: 'nonegcache', label: 'No negative cache' },
          { key: 'filter_aaaa', label: 'Filter AAAA records' },
          { key: 'filter_a', label: 'Filter A records' },
        ] as opt}
          <label class="flex items-center gap-2 text-xs text-[#c9d1d9] cursor-pointer py-1">
            <input type="checkbox" checked={dnsmasq[opt.key] === '1'}
              onchange={(e) => saveDnsmasq(opt.key, (e.target as HTMLInputElement).checked ? '1' : '0')} />
            {opt.label}
          </label>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Apply bar -->
{#if dirty}
  <div class="fixed bottom-0 left-0 lg:left-56 right-0 bg-[var(--color-surface-800)] border-t border-[var(--color-surface-500)] px-4 lg:px-6 py-3 flex items-center justify-between z-30">
    <span class="text-sm text-[#8b949e]">You have unsaved DHCP changes</span>
    <div class="flex gap-2">
      <button class={btnSecondary} onclick={revertChanges}>Discard</button>
      <button class={btnPrimary} onclick={applyChanges} disabled={applying}>
        {applying ? 'Restarting DHCP...' : 'Apply & Restart'}
      </button>
    </div>
  </div>
{/if}
