<script lang="ts">
  import { onMount } from 'svelte';
  import { subscribe } from '$lib/stores/websocket';
  import { api } from '$lib/api/client';
  import { Plus, Pencil, Trash2 } from 'lucide-svelte';

  type Tab = 'rules' | 'forwards' | 'ipsets' | 'zones';
  type Section = Record<string, string | string[] | boolean>;

  let activeTab = $state<Tab>('rules');
  let loading = $state(true);
  let applying = $state(false);
  let dirty = $state(false);

  // Data
  let zones = $state<Section[]>([]);
  let rules = $state<Section[]>([]);
  let redirects = $state<Section[]>([]);
  let ipsets = $state<Section[]>([]);
  let dhcpHosts = $state<{ name: string; ip: string; mac: string }[]>([]);


  // Rule form
  let showRuleForm = $state(false);
  let editingSection = $state('');
  let ruleForm = $state(emptyRuleForm());

  function emptyRuleForm() {
    return { name: '', src: 'lan', dest: 'wan', src_ip: '', dest_ip: '', src_port: '', dest_port: '',
      proto: 'any', target: 'DROP', ipset: '', src_mac: '', family: '', enabled: '1' };
  }

  // Forward form
  let showFwdForm = $state(false);
  let editingFwd = $state('');
  let fwdForm = $state(emptyFwdForm());

  function emptyFwdForm() {
    return { name: '', proto: 'tcp', src_dport: '', dest_ip: '', dest_port: '', enabled: '1' };
  }

  // IP Set form
  let showIpsetForm = $state(false);
  let editingIpset = $state('');
  let ipsetForm = $state(emptyIpsetForm());

  function emptyIpsetForm() {
    return { name: '', match: 'src_ip', entries: '' };
  }

  // --- Load ---
  async function loadAll() {
    const [z, r, rd, ip, dh] = await Promise.all([
      api<Section[]>('/api/firewall/zones').catch(() => []),
      api<Section[]>('/api/firewall/rules').catch(() => []),
      api<Section[]>('/api/firewall/redirects').catch(() => []),
      api<Section[]>('/api/firewall/ipsets').catch(() => []),
      api<{ name: string; ip: string; mac: string }[]>('/api/firewall/dhcp-hosts').catch(() => []),
    ]);
    zones = z; rules = r; redirects = rd; ipsets = ip; dhcpHosts = dh;
    loading = false;
    dirty = false;
  }

  // --- Rule CRUD ---
  function startAddRule() {
    ruleForm = emptyRuleForm();
    editingSection = '';
    showRuleForm = true;
  }

  function startEditRule(rule: Section) {
    editingSection = rule['.name'] as string;
    ruleForm = {
      name: (rule.name as string) ?? '', src: (rule.src as string) ?? '', dest: (rule.dest as string) ?? '',
      src_ip: (rule.src_ip as string) ?? '', dest_ip: (rule.dest_ip as string) ?? '',
      src_port: (rule.src_port as string) ?? '', dest_port: (rule.dest_port as string) ?? '',
      proto: (rule.proto as string) || 'any', target: (rule.target as string) ?? 'DROP',
      ipset: (rule.ipset as string) ?? '', src_mac: Array.isArray(rule.src_mac) ? rule.src_mac.join(', ') : (rule.src_mac as string) ?? '',
      family: (rule.family as string) ?? '', enabled: rule.enabled === '0' ? '0' : '1'
    };
    showRuleForm = true;
  }

  async function saveRule() {
    if (!ruleForm.name) return;
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(ruleForm)) {
      if (v) body[k] = v;
    }
    if (editingSection) {
      await api(`/api/firewall/rules/${editingSection}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/firewall/rules', { method: 'POST', body: JSON.stringify(body) });
    }
    showRuleForm = false;
    dirty = true;
    await loadAll();
  }

  async function deleteRule(section: string) {
    await api(`/api/firewall/rules/${section}`, { method: 'DELETE' });
    dirty = true;
    await loadAll();
  }

  async function toggleRule(rule: Section) {
    const section = rule['.name'] as string;
    const newVal = rule.enabled === '0' ? '1' : '0';
    await api(`/api/firewall/rules/${section}`, { method: 'PUT', body: JSON.stringify({ enabled: newVal }) });
    dirty = true;
    await loadAll();
  }

  // --- Forward CRUD ---
  function startAddFwd() { fwdForm = emptyFwdForm(); editingFwd = ''; showFwdForm = true; }

  function startEditFwd(fwd: Section) {
    editingFwd = fwd['.name'] as string;
    fwdForm = {
      name: (fwd.name as string) ?? '', proto: (fwd.proto as string) ?? 'tcp',
      src_dport: (fwd.src_dport as string) ?? '', dest_ip: (fwd.dest_ip as string) ?? '',
      dest_port: (fwd.dest_port as string) ?? '', enabled: fwd.enabled === '0' ? '0' : '1'
    };
    showFwdForm = true;
  }

  async function saveFwd() {
    if (!fwdForm.name || !fwdForm.src_dport || !fwdForm.dest_ip) return;
    const body = { ...fwdForm, target: 'DNAT', src: 'wan', dest: 'lan', dest_port: fwdForm.dest_port || fwdForm.src_dport };
    if (editingFwd) {
      await api(`/api/firewall/redirects/${editingFwd}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/firewall/redirects', { method: 'POST', body: JSON.stringify(body) });
    }
    showFwdForm = false;
    dirty = true;
    await loadAll();
  }

  async function deleteFwd(section: string) {
    await api(`/api/firewall/redirects/${section}`, { method: 'DELETE' });
    dirty = true;
    await loadAll();
  }

  // --- IP Set CRUD ---
  function startAddIpset() { ipsetForm = emptyIpsetForm(); editingIpset = ''; showIpsetForm = true; }

  function startEditIpset(ipset: Section) {
    editingIpset = ipset['.name'] as string;
    const entries = Array.isArray(ipset.entry) ? ipset.entry : typeof ipset.entry === 'string' ? [ipset.entry] : [];
    ipsetForm = { name: (ipset.name as string) ?? '', match: (ipset.match as string) ?? 'src_ip', entries: entries.join('\n') };
    showIpsetForm = true;
  }

  async function saveIpset() {
    if (!ipsetForm.name) return;
    const entries = ipsetForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
    const body = { name: ipsetForm.name, match: ipsetForm.match, entry: entries };
    if (editingIpset) {
      await api(`/api/firewall/ipsets/${editingIpset}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/firewall/ipsets', { method: 'POST', body: JSON.stringify(body) });
    }
    showIpsetForm = false;
    dirty = true;
    await loadAll();
  }

  async function deleteIpset(section: string) {
    await api(`/api/firewall/ipsets/${section}`, { method: 'DELETE' });
    dirty = true;
    await loadAll();
  }

  // --- Apply / Revert ---
  async function applyChanges() {
    applying = true;
    await api('/api/firewall/apply', { method: 'POST' });
    applying = false;
    dirty = false;
  }

  async function revertChanges() {
    await api('/api/firewall/revert', { method: 'POST' });
    await loadAll();
  }

  // --- Helpers ---
  function actionBadge(target: string): string {
    switch (target?.toUpperCase()) {
      case 'ACCEPT': return 'bg-[rgba(34,197,94,0.15)] text-[#22c55e]';
      case 'DROP': return 'bg-[rgba(239,68,68,0.15)] text-[#ef4444]';
      case 'REJECT': return 'bg-[rgba(245,158,11,0.15)] text-[#f59e0b]';
      default: return 'bg-[var(--color-surface-600)] text-[#8b949e]';
    }
  }

  function zoneColor(name: string): string {
    if (name === 'lan') return '#22c55e';
    if (name === 'wan') return '#ef4444';
    return '#006fff';
  }

  const SYSTEM_PREFIXES = ['Allow-', 'Reject-', 'Drop-'];
  function isSystem(name: string): boolean { return SYSTEM_PREFIXES.some(p => name.startsWith(p)); }

  const btn = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
  const btnPrimary = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-light)]`;
  const btnSecondary = `${btn} bg-[var(--color-surface-600)] text-white hover:bg-[var(--color-surface-500)]`;
  const btnDanger = `${btn} bg-[rgba(239,68,68,0.15)] text-[#ef4444] hover:bg-[rgba(239,68,68,0.25)]`;
  const input = 'w-full px-3 py-2 bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] rounded-lg text-sm text-white outline-none focus:border-[var(--color-accent)]';
  const label = 'block text-[12px] text-[#8b949e] mb-1.5 font-medium';

  onMount(loadAll);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-white">Firewall</h1>
  </div>

  <!-- Tabs -->
  <div class="flex gap-0 border-b-2 border-[var(--color-surface-500)]">
    {#each [
      { id: 'rules', label: 'Traffic Rules', count: rules.length },
      { id: 'forwards', label: 'Port Forwards', count: redirects.length },
      { id: 'ipsets', label: 'IP Sets', count: ipsets.length },
      { id: 'zones', label: 'Zones', count: zones.length },
    ] as tab}
      <button class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors
        {activeTab === tab.id ? 'text-[var(--color-accent-light)] border-[var(--color-accent)]' : 'text-[#8b949e] border-transparent hover:text-white'}"
        onclick={() => activeTab = tab.id as Tab}>
        {tab.label} <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full {activeTab === tab.id ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-600)] text-[#8b949e]'}">{tab.count}</span>
      </button>
    {/each}
  </div>

  <!-- =================== TRAFFIC RULES =================== -->
  {#if activeTab === 'rules'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">Traffic Rules</h2>
        <button class={btnPrimary} onclick={startAddRule}><Plus size={14} class="inline -mt-0.5" /> Add Rule</button>
      </div>

      {#if showRuleForm}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <h3 class="text-sm font-semibold text-[#c9d1d9] mb-4">{editingSection ? 'Edit Rule' : 'New Rule'}</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label class={label}>Name</label><input class={input} bind:value={ruleForm.name} placeholder="e.g. Block IoT Internet" /></div>
            <div>
              <label class={label}>Action</label>
              <div class="flex gap-0 rounded-lg overflow-hidden border border-[var(--color-surface-500)]">
                {#each [['DROP', 'Block'], ['REJECT', 'Reject'], ['ACCEPT', 'Allow']] as [val, lbl]}
                  <button class="flex-1 py-2 text-xs font-semibold transition-colors
                    {ruleForm.target === val ? actionBadge(val) : 'bg-[var(--color-surface-700)] text-[#8b949e] hover:text-white'}"
                    onclick={() => ruleForm.target = val}>{lbl}</button>
                {/each}
              </div>
            </div>
            <div><label class={label}>Source Zone</label>
              <select class={input} bind:value={ruleForm.src}>
                <option value="">Any</option>
                {#each zones as z}<option value={z.name}>{(z.name as string).toUpperCase()}</option>{/each}
              </select>
            </div>
            <div><label class={label}>Dest Zone</label>
              <select class={input} bind:value={ruleForm.dest}>
                <option value="">Any</option>
                {#each zones as z}<option value={z.name}>{(z.name as string).toUpperCase()}</option>{/each}
              </select>
            </div>
            <div><label class={label}>Source IP / CIDR</label><input class="{input} font-mono text-xs" bind:value={ruleForm.src_ip} placeholder="e.g. 192.168.50.0/24" /></div>
            <div><label class={label}>Dest IP / CIDR</label><input class="{input} font-mono text-xs" bind:value={ruleForm.dest_ip} placeholder="e.g. 10.0.0.0/8" /></div>
            <div>
              <label class={label}>Protocol</label>
              <div class="flex gap-0 rounded-lg overflow-hidden border border-[var(--color-surface-500)]">
                {#each [['any', 'Any'], ['tcp', 'TCP'], ['udp', 'UDP'], ['tcp udp', 'Both']] as [val, lbl]}
                  <button class="flex-1 py-2 text-xs font-medium transition-colors
                    {ruleForm.proto === val ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-700)] text-[#8b949e] hover:text-white'}"
                    onclick={() => ruleForm.proto = val}>{lbl}</button>
                {/each}
              </div>
            </div>
            <div><label class={label}>Source Port</label><input class="{input} font-mono text-xs" bind:value={ruleForm.src_port} placeholder="any" /></div>
            <div><label class={label}>Dest Port</label><input class="{input} font-mono text-xs" bind:value={ruleForm.dest_port} placeholder="any" /></div>
            <div><label class={label}>Use IP Set</label>
              <select class={input} bind:value={ruleForm.ipset}>
                <option value="">None</option>
                {#each ipsets as g}<option value={g.name}>{g.name} ({Array.isArray(g.entry) ? g.entry.length : 0})</option>{/each}
              </select>
            </div>
            <div><label class={label}>Source MAC</label><input class="{input} font-mono text-xs" bind:value={ruleForm.src_mac} placeholder="AA:BB:CC:DD:EE:FF" /></div>
            <div><label class={label}>Address Family</label>
              <select class={input} bind:value={ruleForm.family}>
                <option value="">IPv4 + IPv6</option>
                <option value="ipv4">IPv4 only</option>
                <option value="ipv6">IPv6 only</option>
              </select>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <button class={btnSecondary} onclick={() => showRuleForm = false}>Cancel</button>
            <button class={btnPrimary} onclick={saveRule}>{editingSection ? 'Update' : 'Create'}</button>
          </div>
        </div>
      {/if}

      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--color-surface-500)]">
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Source</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Dest</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Proto</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Action</th>
            <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">On</th>
            <th class="w-20"></th>
          </tr>
        </thead>
        <tbody>
          {#each rules as rule (rule['.name'])}
            {@const name = (rule.name as string) ?? ''}
            {@const sys = isSystem(name)}
            <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02] transition-colors"
              class:opacity-40={rule.enabled === '0'}>
              <td class="px-4 py-2.5">
                <span class="font-medium text-white">{name || '(unnamed)'}</span>
                {#if sys}<span class="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-surface-600)] text-[#8b949e]">System</span>{/if}
                {#if rule.ipset}<span class="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)] font-mono">ipset:{rule.ipset}</span>{/if}
              </td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{rule.src || '*'}{rule.src_ip ? ` (${rule.src_ip})` : ''}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e]">{rule.dest || '*'}{rule.dest_ip ? ` (${rule.dest_ip})` : ''}</td>
              <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{rule.proto || 'any'}{rule.dest_port ? `:${rule.dest_port}` : ''}</td>
              <td class="px-4 py-2.5"><span class="text-[11px] font-semibold px-2 py-0.5 rounded-full {actionBadge(rule.target as string)}">{rule.target}</span></td>
              <td class="px-4 py-2.5">
                <button class="w-8 h-5 rounded-full transition-colors relative {rule.enabled !== '0' ? 'bg-[rgba(34,197,94,0.3)]' : 'bg-[var(--color-surface-500)]'}"
                  onclick={() => toggleRule(rule)}>
                  <span class="absolute top-0.5 w-4 h-4 rounded-full transition-all {rule.enabled !== '0' ? 'left-3.5 bg-[#22c55e]' : 'left-0.5 bg-[#8b949e]'}"></span>
                </button>
              </td>
              <td class="px-4 py-2.5 text-right">
                {#if !sys}
                  <button class="p-1 text-[#8b949e] hover:text-white" onclick={() => startEditRule(rule)}><Pencil size={13} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => deleteRule(rule['.name'] as string)}><Trash2 size={13} /></button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

  <!-- =================== PORT FORWARDS =================== -->
  {:else if activeTab === 'forwards'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">Port Forwards</h2>
        <button class={btnPrimary} onclick={startAddFwd}><Plus size={14} class="inline -mt-0.5" /> Add Forward</button>
      </div>

      {#if showFwdForm}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label class={label}>Name</label><input class={input} bind:value={fwdForm.name} placeholder="e.g. Home Assistant" /></div>
            <div>
              <label class={label}>Protocol</label>
              <div class="flex gap-0 rounded-lg overflow-hidden border border-[var(--color-surface-500)]">
                {#each [['tcp', 'TCP'], ['udp', 'UDP'], ['tcp udp', 'Both']] as [val, lbl]}
                  <button class="flex-1 py-2 text-xs font-medium transition-colors
                    {fwdForm.proto === val ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]' : 'bg-[var(--color-surface-700)] text-[#8b949e] hover:text-white'}"
                    onclick={() => fwdForm.proto = val}>{lbl}</button>
                {/each}
              </div>
            </div>
            <div><label class={label}>External Port</label><input class="{input} font-mono text-xs" bind:value={fwdForm.src_dport} placeholder="8123" /></div>
            <div><label class={label}>Destination Device</label>
              <select class={input} bind:value={fwdForm.dest_ip}>
                <option value="">Select...</option>
                {#each dhcpHosts as h}<option value={h.ip}>{h.name || h.mac} ({h.ip})</option>{/each}
              </select>
            </div>
            <div><label class={label}>Internal Port</label><input class="{input} font-mono text-xs" bind:value={fwdForm.dest_port} placeholder={fwdForm.src_dport || 'Same'} /></div>
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <button class={btnSecondary} onclick={() => showFwdForm = false}>Cancel</button>
            <button class={btnPrimary} onclick={saveFwd}>{editingFwd ? 'Update' : 'Create'}</button>
          </div>
        </div>
      {/if}

      {#if redirects.length === 0 && !showFwdForm}
        <div class="py-12 text-center text-[#8b949e] text-sm">No port forwards configured</div>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--color-surface-500)]">
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Proto</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Ext Port</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Destination</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Int Port</th>
              <th class="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {#each redirects as fwd (fwd['.name'])}
              <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
                <td class="px-4 py-2.5 font-medium text-white">{fwd.name || '(unnamed)'}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{(fwd.proto as string)?.toUpperCase()}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{fwd.src_dport}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#58a6ff]">{fwd.dest_ip}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#c9d1d9]">{fwd.dest_port || fwd.src_dport}</td>
                <td class="px-4 py-2.5 text-right">
                  <button class="p-1 text-[#8b949e] hover:text-white" onclick={() => startEditFwd(fwd)}><Pencil size={13} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => deleteFwd(fwd['.name'] as string)}><Trash2 size={13} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

  <!-- =================== IP SETS =================== -->
  {:else if activeTab === 'ipsets'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-surface-500)]">
        <h2 class="text-sm font-semibold text-white">IP Sets</h2>
        <button class={btnPrimary} onclick={startAddIpset}><Plus size={14} class="inline -mt-0.5" /> Add IP Set</button>
      </div>

      {#if showIpsetForm}
        <div class="p-5 border-b border-[var(--color-surface-500)] bg-[var(--color-surface-700)]/50">
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div><label class={label}>Name</label><input class={input} bind:value={ipsetForm.name} placeholder="e.g. no-internet" /></div>
            <div><label class={label}>Match Type</label>
              <select class={input} bind:value={ipsetForm.match}>
                <option value="src_ip">Source IP</option>
                <option value="dest_ip">Destination IP</option>
                <option value="src_mac">Source MAC</option>
              </select>
            </div>
          </div>
          <div>
            <label class={label}>Members</label>
            <!-- Device picker -->
            {#if ipsetForm.match !== 'src_mac'}
              <select class="{input} mb-2" onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val) {
                  const entries = ipsetForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
                  if (!entries.includes(val)) { entries.push(val); ipsetForm.entries = entries.join('\n'); }
                  (e.target as HTMLSelectElement).value = '';
                }
              }}>
                <option value="">-- Pick a device --</option>
                {#each dhcpHosts.filter(h => h.ip) as h}
                  <option value={ipsetForm.match.includes('mac') ? h.mac : h.ip}>{h.name || '?'} - {ipsetForm.match.includes('mac') ? h.mac : h.ip}</option>
                {/each}
              </select>
            {/if}
            <!-- Entries as tags -->
            <div class="flex flex-wrap gap-1.5 mb-2">
              {#each ipsetForm.entries.split('\n').filter(Boolean) as entry, i}
                {@const hostName = dhcpHosts.find(h => h.ip === entry || h.mac === entry.toUpperCase())?.name}
                <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--color-surface-700)] border border-[var(--color-surface-500)] text-xs">
                  <span class="font-mono text-white">{entry}</span>
                  {#if hostName}<span class="text-[#8b949e]">{hostName}</span>{/if}
                  <button class="text-[#8b949e] hover:text-[#ef4444]" onclick={() => {
                    const entries = ipsetForm.entries.split('\n').filter(Boolean);
                    entries.splice(i, 1);
                    ipsetForm.entries = entries.join('\n');
                  }}>x</button>
                </span>
              {/each}
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-3">
            <button class={btnSecondary} onclick={() => showIpsetForm = false}>Cancel</button>
            <button class={btnPrimary} onclick={saveIpset}>{editingIpset ? 'Update' : 'Create'}</button>
          </div>
        </div>
      {/if}

      {#if ipsets.length === 0 && !showIpsetForm}
        <div class="py-12 text-center text-[#8b949e] text-sm">No IP sets defined. Create one to use in firewall rules.</div>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--color-surface-500)]">
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Name</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Type</th>
              <th class="text-left px-4 py-2.5 text-[11px] font-semibold text-[#8b949e] uppercase">Entries</th>
              <th class="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {#each ipsets as ipset (ipset['.name'])}
              {@const entries = Array.isArray(ipset.entry) ? ipset.entry : typeof ipset.entry === 'string' ? [ipset.entry] : []}
              <tr class="border-b border-[var(--color-surface-600)]/50 hover:bg-white/[0.02]">
                <td class="px-4 py-2.5 font-medium text-white">{ipset.name}</td>
                <td class="px-4 py-2.5"><span class="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">{(ipset.match as string)?.replace('_', ' ')}</span></td>
                <td class="px-4 py-2.5 font-mono text-xs text-[#8b949e] max-w-[300px] truncate">{entries.join(', ') || '(empty)'}</td>
                <td class="px-4 py-2.5 text-right">
                  <button class="p-1 text-[#8b949e] hover:text-white" onclick={() => startEditIpset(ipset)}><Pencil size={13} /></button>
                  <button class="p-1 text-[#8b949e] hover:text-[#ef4444]" onclick={() => deleteIpset(ipset['.name'] as string)}><Trash2 size={13} /></button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

  <!-- =================== ZONES =================== -->
  {:else if activeTab === 'zones'}
    <div class="bg-[var(--color-surface-800)] border border-[var(--color-surface-500)] rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-4">Zones</h2>
      <div class="space-y-3">
        {#each zones as zone}
          <div class="border-l-[3px] pl-4 py-3 bg-[var(--color-surface-700)] rounded-r-lg" style="border-color: {zoneColor(zone.name as string)}">
            <div class="flex items-center justify-between">
              <div>
                <span class="font-bold text-white text-sm uppercase">{zone.name}</span>
                {#if zone.masq === '1'}<span class="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-light)]">NAT</span>{/if}
              </div>
              <span class="text-[11px] text-[#8b949e] font-mono">
                {Array.isArray(zone.network) ? zone.network.join(', ') : zone.network ?? ''}
              </span>
            </div>
            <div class="flex gap-4 mt-2 text-[12px] text-[#8b949e]">
              <span>Input: <b class="text-white">{zone.input}</b></span>
              <span>Output: <b class="text-white">{zone.output}</b></span>
              <span>Forward: <b class="text-white">{zone.forward}</b></span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Apply bar -->
{#if dirty}
  <div class="fixed bottom-0 left-56 right-0 bg-[var(--color-surface-800)] border-t border-[var(--color-surface-500)] px-6 py-3 flex items-center justify-between z-30">
    <span class="text-sm text-[#8b949e]">You have unsaved changes</span>
    <div class="flex gap-2">
      <button class={btnSecondary} onclick={revertChanges}>Discard</button>
      <button class={btnPrimary} onclick={applyChanges} disabled={applying}>
        {applying ? 'Applying...' : 'Apply Changes'}
      </button>
    </div>
  </div>
{/if}
