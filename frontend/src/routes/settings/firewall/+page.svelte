<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as uci from '$openwrt/uci';
	import { call } from '$api/ubus';
	import { formatRelativeTime } from '$utils/format';

	type Tab = 'general' | 'forwards' | 'rules' | 'nat' | 'groups' | 'activity';
	let activeTab = $state<Tab>('general');

	let loading = $state(true);
	let saving = $state(false);

	// --- General Settings (defaults + zones) ---
	interface FwDefaults {
		section: string;
		input: string;
		output: string;
		forward: string;
		synFlood: boolean;
	}
	interface FwZone {
		section: string;
		name: string;
		input: string;
		output: string;
		forward: string;
		masq: boolean;
		mtuFix: boolean;
		networks: string[];
	}
	interface FwForwarding {
		section: string;
		src: string;
		dest: string;
	}
	let defaults = $state<FwDefaults>({ section: '', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', synFlood: true });
	let zones = $state<FwZone[]>([]);
	let forwardings = $state<FwForwarding[]>([]);

	// --- NAT Rules ---
	interface NatRule {
		section: string;
		name: string;
		src: string;
		src_ip: string;
		dest_ip: string;
		snat_ip: string;
		proto: string;
		target: string;
		enabled: boolean;
	}
	let natRules = $state<NatRule[]>([]);
	let showAddNat = $state(false);
	let natForm = $state({ name: '', src: 'lan', src_ip: '', snat_ip: '', proto: 'all', target: 'SNAT' });
	let applyCountdown = $state(0);

	// --- DHCP hosts for device dropdown ---
	interface DhcpHost {
		name: string;
		ip: string;
		mac: string;
	}
	let dhcpHosts = $state<DhcpHost[]>([]);

	// --- Port Forwards (redirects) ---
	interface PortForward {
		section: string;
		name: string;
		proto: string;
		src_dport: string;
		dest_ip: string;
		dest_port: string;
		enabled: boolean;
	}

	let redirects = $state<PortForward[]>([]);
	let showAddForward = $state(false);
	let forwardForm = $state({
		name: '',
		proto: 'tcp',
		src_dport: '',
		dest_device: '',
		dest_ip_custom: '',
		dest_port: ''
	});

	// --- Firewall Rules ---
	interface FwRule {
		section: string;
		name: string;
		src: string;
		dest: string;
		src_ip: string;
		dest_ip: string;
		src_port: string;
		proto: string;
		dest_port: string;
		src_mac: string[];
		ipset: string;
		family: string;
		target: string;
		enabled: boolean;
		isSystem: boolean;
		weekdays: string;
		start_time: string;
		stop_time: string;
		log: boolean;
	}

	const SYSTEM_RULE_PREFIXES = ['Allow-', 'Reject-', 'Drop-'];

	// Human-readable descriptions for system rules
	const RULE_DESCRIPTIONS: Record<string, string> = {
		'Allow-DHCP-Renew': 'Lets your router renew its WAN IP address from your ISP. Not exposed to the internet.',
		'Allow-Ping': 'Allows ping (ICMP) from the internet to check if router is online. Disable to be invisible.',
		'Allow-IGMP': 'Multicast group management. Only needed for IPTV from your ISP.',
		'Allow-DHCPv6': 'Lets your router get an IPv6 address from your ISP.',
		'Allow-MLD': 'IPv6 multicast listener discovery. Required for IPv6 networks.',
		'Allow-ICMPv6-Input': 'IPv6 ping and network discovery to the router. Required for IPv6.',
		'Allow-ICMPv6-Forward': 'IPv6 network discovery forwarded through the router. Required for IPv6.',
		'Allow-IPSec-ESP': 'IPSec VPN protocol. Not needed — you use WireGuard instead.',
		'Allow-ISAKMP': 'IPSec key exchange. Not needed — you use WireGuard instead.',
		'Allow-WireGuard': 'Your WireGuard VPN server port. Required for VPN access from outside.',
	};

	let rules = $state<FwRule[]>([]);
	let showAddRule = $state(false);
	let editingRule = $state<string | null>(null);
	let ruleForm = $state({
		name: '',
		src: '',
		dest: '',
		src_ip: '',
		dest_ip: '',
		src_port: '',
		proto: 'any',
		dest_port: '',
		src_mac: '',
		ipset: '',
		family: '',
		target: 'DROP',
		weekdays: '',
		start_time: '',
		stop_time: '',
		log: false
	});

	// --- IP Groups (ipset) ---
	interface IpGroup {
		section: string;
		name: string;
		match: string;  // src_ip, dest_ip, src_mac, src_port, dest_port
		entries: string[];
	}

	let groups = $state<IpGroup[]>([]);
	let showAddGroup = $state(false);
	let editingGroup = $state<string | null>(null);
	let groupForm = $state({ name: '', match: 'src_ip', entries: '' });

	// --- General settings helpers ---
	function saveDefaults() {
		if (!defaults.section) return;
		uci.set('firewall', defaults.section, 'input', defaults.input);
		uci.set('firewall', defaults.section, 'output', defaults.output);
		uci.set('firewall', defaults.section, 'forward', defaults.forward);
		uci.set('firewall', defaults.section, 'syn_flood', defaults.synFlood ? '1' : '0');
	}

	function saveZone(zone: FwZone) {
		uci.set('firewall', zone.section, 'input', zone.input);
		uci.set('firewall', zone.section, 'output', zone.output);
		uci.set('firewall', zone.section, 'forward', zone.forward);
		uci.set('firewall', zone.section, 'masq', zone.masq ? '1' : '0');
		uci.set('firewall', zone.section, 'mtu_fix', zone.mtuFix ? '1' : '0');
	}

	// --- NAT helpers ---
	function addNatRule() {
		if (!natForm.name) return;
		const sid = uci.add('firewall', 'nat');
		uci.set('firewall', sid, 'name', natForm.name);
		uci.set('firewall', sid, 'src', natForm.src);
		if (natForm.src_ip) uci.set('firewall', sid, 'src_ip', natForm.src_ip);
		if (natForm.snat_ip) uci.set('firewall', sid, 'snat_ip', natForm.snat_ip);
		uci.set('firewall', sid, 'proto', natForm.proto);
		uci.set('firewall', sid, 'target', natForm.target);
		natForm = { name: '', src: 'lan', src_ip: '', snat_ip: '', proto: 'all', target: 'SNAT' };
		showAddNat = false;
		loadFirewall();
	}

	function deleteNat(section: string) {
		uci.remove('firewall', section);
		loadFirewall();
	}

	// --- Entry picker ---
	let pickerValue = $state('');
	let customEntry = $state('');

	const groupFormEntries = $derived(
		groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean)
	);

	const availableDevices = $derived.by(() => {
		const existing = new Set(groupFormEntries.map(e => e.toUpperCase()));
		const isMac = groupForm.match.includes('mac');
		return dhcpHosts
			.filter(h => {
				if (isMac) return h.mac && !existing.has(h.mac.toUpperCase());
				return h.ip && !existing.has(h.ip.toUpperCase());
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	function entryLabel(entry: string): string {
		const upper = entry.toUpperCase();
		const host = dhcpHosts.find(h => h.ip === entry || h.mac === upper);
		return host?.name || '';
	}

	function addFromPicker() {
		if (!pickerValue) return;
		const entries = groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
		if (!entries.includes(pickerValue)) {
			entries.push(pickerValue);
			groupForm.entries = entries.join('\n');
		}
		pickerValue = '';
	}

	function addCustomEntry() {
		if (!customEntry.trim()) return;
		const entries = groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
		if (!entries.includes(customEntry.trim())) {
			entries.push(customEntry.trim());
			groupForm.entries = entries.join('\n');
		}
		customEntry = '';
	}

	function removeEntry(index: number) {
		const entries = groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
		entries.splice(index, 1);
		groupForm.entries = entries.join('\n');
	}

	// --- Activity ---
	let recentBlocks = $state<any[]>([]);
	let conntrackCount = $state(0);
	let conntrackMax = $state(0);
	let activityLoading = $state(true);
	let activityTimer: ReturnType<typeof setInterval> | undefined;

	// --- Delete confirmation ---
	let deleteTarget = $state<{ type: 'forward' | 'rule'; section: string; name: string } | null>(null);

	// --- Derived ---
	const pendingChanges = $derived(uci.hasChanges('firewall'));

	const systemRuleCount = $derived(rules.filter(r => r.isSystem).length);

	const resolvedDestIp = $derived(() => {
		if (forwardForm.dest_device === '__custom__') return forwardForm.dest_ip_custom;
		return forwardForm.dest_device;
	});

	// --- Data loading ---
	function loadDhcpHosts() {
		const hosts = uci.sections('dhcp', 'host');
		dhcpHosts = hosts.map(h => {
			const mac = Array.isArray(h.mac) ? (h.mac[0] as string) : (h.mac as string) ?? '';
			return {
				name: (h.name as string) ?? '',
				ip: (h.ip as string) ?? '',
				mac: mac.toUpperCase()
			};
		}).filter(h => h.ip);
	}

	function loadFirewall() {
		// Defaults
		const defSec = uci.sections('firewall', 'defaults')[0];
		if (defSec) {
			defaults = {
				section: defSec['.name'] as string,
				input: (defSec.input as string) ?? 'REJECT',
				output: (defSec.output as string) ?? 'ACCEPT',
				forward: (defSec.forward as string) ?? 'REJECT',
				synFlood: defSec.syn_flood === '1'
			};
		}

		// Zones
		zones = uci.sections('firewall', 'zone').map(sec => ({
			section: sec['.name'] as string,
			name: (sec.name as string) ?? '',
			input: (sec.input as string) ?? 'DROP',
			output: (sec.output as string) ?? 'DROP',
			forward: (sec.forward as string) ?? 'DROP',
			masq: sec.masq === '1',
			mtuFix: sec.mtu_fix === '1',
			networks: Array.isArray(sec.network) ? sec.network as string[] :
				typeof sec.network === 'string' ? [sec.network] : []
		}));

		// Forwardings
		forwardings = uci.sections('firewall', 'forwarding').map(sec => ({
			section: sec['.name'] as string,
			src: (sec.src as string) ?? '',
			dest: (sec.dest as string) ?? ''
		}));

		// NAT rules
		natRules = uci.sections('firewall', 'nat').map(sec => ({
			section: sec['.name'] as string,
			name: (sec.name as string) ?? '',
			src: (sec.src as string) ?? '',
			src_ip: (sec.src_ip as string) ?? '',
			dest_ip: (sec.dest_ip as string) ?? '',
			snat_ip: (sec.snat_ip as string) ?? '',
			proto: (sec.proto as string) ?? 'all',
			target: (sec.target as string) ?? 'SNAT',
			enabled: sec.enabled !== '0'
		}));

		redirects = uci.sections('firewall', 'redirect').map(sec => ({
			section: sec['.name'] as string,
			name: (sec.name as string) ?? '',
			proto: (sec.proto as string) ?? 'tcp',
			src_dport: (sec.src_dport as string) ?? '',
			dest_ip: (sec.dest_ip as string) ?? '',
			dest_port: (sec.dest_port as string) ?? '',
			enabled: sec.enabled !== '0' && sec.enabled !== 0
		}));

		rules = uci.sections('firewall', 'rule').map(sec => {
			const name = (sec.name as string) ?? '';
			const srcMac = Array.isArray(sec.src_mac) ? sec.src_mac as string[] :
				typeof sec.src_mac === 'string' ? [sec.src_mac] : [];
			return {
				section: sec['.name'] as string,
				name,
				src: (sec.src as string) ?? '',
				dest: (sec.dest as string) ?? '',
				src_ip: (sec.src_ip as string) ?? '',
				dest_ip: (sec.dest_ip as string) ?? '',
				src_port: (sec.src_port as string) ?? '',
				proto: (sec.proto as string) ?? 'any',
				dest_port: (sec.dest_port as string) ?? '',
				src_mac: srcMac,
				ipset: (sec.ipset as string) ?? '',
				family: (sec.family as string) ?? '',
				target: (sec.target as string) ?? 'ACCEPT',
				enabled: sec.enabled !== '0' && sec.enabled !== 0,
				isSystem: SYSTEM_RULE_PREFIXES.some(p => name.startsWith(p)),
				weekdays: Array.isArray(sec.weekdays) ? (sec.weekdays as string[]).join(' ') : (sec.weekdays as string) ?? '',
				start_time: (sec.start_time as string) ?? '',
				stop_time: (sec.stop_time as string) ?? '',
				log: sec.extra === '--log-prefix' || sec.log === '1'
			};
		});

		groups = uci.sections('firewall', 'ipset').map(sec => ({
			section: sec['.name'] as string,
			name: (sec.name as string) ?? '',
			match: (sec.match as string) ?? 'src_ip',
			entries: Array.isArray(sec.entry) ? sec.entry as string[] :
				typeof sec.entry === 'string' ? [sec.entry] : []
		}));
	}

	function addGroup() {
		if (!groupForm.name) return;
		const sid = uci.add('firewall', 'ipset');
		uci.set('firewall', sid, 'name', groupForm.name);
		uci.set('firewall', sid, 'match', groupForm.match);
		const entries = groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
		for (const entry of entries) {
			uci.set('firewall', sid, 'entry', entries);
		}
		groupForm = { name: '', match: 'src_ip', entries: '' };
		showAddGroup = false;
		loadFirewall();
	}

	function startEditGroup(group: IpGroup) {
		editingGroup = group.section;
		groupForm = {
			name: group.name,
			match: group.match,
			entries: group.entries.join('\n')
		};
	}

	function saveEditGroup() {
		if (!editingGroup || !groupForm.name) return;
		uci.set('firewall', editingGroup, 'name', groupForm.name);
		uci.set('firewall', editingGroup, 'match', groupForm.match);
		const entries = groupForm.entries.split('\n').map(e => e.trim()).filter(Boolean);
		uci.set('firewall', editingGroup, 'entry', entries);
		editingGroup = null;
		loadFirewall();
	}

	function deleteGroup(section: string) {
		uci.remove('firewall', section);
		loadFirewall();
	}

	// --- Device name lookup ---
	function deviceName(ip: string): string {
		const host = dhcpHosts.find(h => h.ip === ip);
		return host?.name || '';
	}

	// --- Direction mapping ---
	function getDirection(src: string, dest: string): string {
		if (src === 'wan') return 'Inbound';
		if (src === 'lan' && dest === 'wan') return 'Outbound';
		if (src === 'lan' && dest === 'lan') return 'Internal';
		if (src && dest) return 'Forward';
		return 'Any';
	}

	function directionClass(dir: string): string {
		switch (dir) {
			case 'Inbound': return 'dir-inbound';
			case 'Outbound': return 'dir-outbound';
			case 'Forward': return 'dir-forward';
			case 'Internal': return 'dir-internal';
			default: return 'dir-any';
		}
	}

	// --- Action display ---
	function actionLabel(target: string): string {
		switch (target.toUpperCase()) {
			case 'ACCEPT': return 'Allow';
			case 'DROP': return 'Block';
			case 'REJECT': return 'Reject';
			default: return target;
		}
	}

	function actionClass(target: string): string {
		switch (target.toUpperCase()) {
			case 'ACCEPT': return 'action-allow';
			case 'DROP': return 'action-block';
			case 'REJECT': return 'action-reject';
			default: return '';
		}
	}

	// --- Protocol display ---
	function protoLabel(proto: string): string {
		const p = proto.toLowerCase();
		if (p === 'tcp udp' || p === 'tcp+udp') return 'Both';
		if (p === 'tcp') return 'TCP';
		if (p === 'udp') return 'UDP';
		if (p === 'icmp') return 'ICMP';
		return proto.toUpperCase();
	}

	function protoClass(proto: string): string {
		const p = proto.toLowerCase();
		if (p === 'tcp') return 'proto-tcp';
		if (p === 'udp') return 'proto-udp';
		if (p === 'tcp udp' || p === 'tcp+udp') return 'proto-both';
		return 'proto-other';
	}

	// --- Port Forward CRUD ---
	function resetForwardForm() {
		forwardForm = { name: '', proto: 'tcp', src_dport: '', dest_device: '', dest_ip_custom: '', dest_port: '' };
		showAddForward = false;
	}

	function saveForward() {
		const destIp = resolvedDestIp();
		if (!forwardForm.name || !forwardForm.src_dport || !destIp) return;
		const dp = forwardForm.dest_port || forwardForm.src_dport;
		const sid = uci.add('firewall', 'redirect');
		uci.set('firewall', sid, {
			name: forwardForm.name,
			target: 'DNAT',
			src: 'wan',
			dest: 'lan',
			proto: forwardForm.proto,
			src_dport: forwardForm.src_dport,
			dest_ip: destIp,
			dest_port: dp,
			enabled: '1'
		});
		resetForwardForm();
		loadFirewall();
	}

	function toggleForward(fwd: PortForward) {
		uci.set('firewall', fwd.section, 'enabled', fwd.enabled ? '0' : '1');
		loadFirewall();
	}

	function removeForward(section: string) {
		uci.remove('firewall', section);
		loadFirewall();
		deleteTarget = null;
	}

	// --- Rule CRUD ---
	function resetRuleForm() {
		ruleForm = { name: '', src: '', dest: '', src_ip: '', dest_ip: '', src_port: '', proto: 'any', dest_port: '', src_mac: '', ipset: '', family: '', target: 'DROP', weekdays: '', start_time: '', stop_time: '', log: false };
		showAddRule = false;
		editingRule = null;
	}

	function startEditRule(rule: FwRule) {
		editingRule = rule.section;
		ruleForm = {
			name: rule.name,
			src: rule.src,
			dest: rule.dest,
			src_ip: rule.src_ip,
			dest_ip: rule.dest_ip,
			src_port: rule.src_port,
			proto: rule.proto || 'any',
			dest_port: rule.dest_port,
			src_mac: rule.src_mac.join(', '),
			ipset: rule.ipset,
			family: rule.family,
			target: rule.target,
			weekdays: rule.weekdays,
			start_time: rule.start_time,
			stop_time: rule.stop_time,
			log: rule.log
		};
		showAddRule = true;
	}

	function applyRuleForm(sid: string) {
		const vals: Record<string, string | string[] | undefined> = {
			name: ruleForm.name,
			src: ruleForm.src || undefined,
			dest: ruleForm.dest || undefined,
			src_ip: ruleForm.src_ip || undefined,
			dest_ip: ruleForm.dest_ip || undefined,
			src_port: ruleForm.src_port || undefined,
			proto: ruleForm.proto === 'any' ? undefined : ruleForm.proto,
			dest_port: ruleForm.dest_port || undefined,
			ipset: ruleForm.ipset || undefined,
			family: ruleForm.family || undefined,
			target: ruleForm.target,
			enabled: '1',
			weekdays: ruleForm.weekdays || undefined,
			start_time: ruleForm.start_time || undefined,
			stop_time: ruleForm.stop_time || undefined
		};
		// Handle src_mac as list
		const macs = ruleForm.src_mac.split(/[,\s]+/).map(m => m.trim()).filter(Boolean);
		if (macs.length > 0) vals.src_mac = macs;

		for (const [key, val] of Object.entries(vals)) {
			if (val !== undefined) {
				uci.set('firewall', sid, key, val as string);
			} else {
				// Clear the field if it was previously set
				try { uci.set('firewall', sid, key, ''); } catch {}
			}
		}
	}

	function saveRule() {
		if (!ruleForm.name) return;
		if (editingRule) {
			applyRuleForm(editingRule);
		} else {
			const sid = uci.add('firewall', 'rule');
			applyRuleForm(sid);
		}
		resetRuleForm();
		loadFirewall();
	}

	function toggleRule(rule: FwRule) {
		uci.set('firewall', rule.section, 'enabled', rule.enabled ? '0' : '1');
		loadFirewall();
	}

	function removeRule(section: string) {
		uci.remove('firewall', section);
		loadFirewall();
		deleteTarget = null;
	}

	// --- Activity ---
	async function fetchActivity() {
		try {
			const [blocks, conntrack] = await Promise.all([
				call<{ events: any[] }>('laubter-firewall', 'get_recent_blocks', { count: 50 }),
				call<{ count: number; max: number }>('laubter-firewall', 'get_conntrack', {})
			]);
			recentBlocks = blocks.events || [];
			conntrackCount = conntrack.count || 0;
			conntrackMax = conntrack.max || 65536;
		} catch (err) {
			console.error('Failed to fetch activity:', err);
		} finally {
			activityLoading = false;
		}
	}

	function switchTab(tab: Tab) {
		activeTab = tab;
		if (tab === 'activity') {
			activityLoading = true;
			fetchActivity();
			activityTimer = setInterval(fetchActivity, 5000);
		}
		if (tab !== 'activity' && activityTimer) {
			clearInterval(activityTimer);
			activityTimer = undefined;
		}
	}

	// --- Apply / Discard ---
	async function handleApply() {
		saving = true;
		try {
			await uci.save();
			await uci.apply(30);
			applyCountdown = 30;
			const timer = setInterval(() => {
				applyCountdown--;
				if (applyCountdown <= 0) clearInterval(timer);
			}, 1000);
			setTimeout(async () => {
				try { await uci.confirm(); } catch {}
			}, 5000);
		} catch (e) {
			console.error('Failed to apply firewall settings:', e);
		} finally {
			saving = false;
		}
	}

	async function handleDiscard() {
		uci.revert('firewall');
		await uci.load('firewall');
		loadFirewall();
		resetForwardForm();
		resetRuleForm();
	}

	// --- Lifecycle ---
	onMount(async () => {
		try {
			await Promise.all([uci.load('firewall'), uci.load('dhcp')]);
			loadDhcpHosts();
			loadFirewall();
		} catch (e) {
			console.error('Failed to load config:', e);
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		if (activityTimer) clearInterval(activityTimer);
	});
</script>

<div class="page">
	<h1>Firewall & Security</h1>
	<p class="subtitle">Manage port forwarding, firewall rules, and monitor network activity</p>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'general'} onclick={() => switchTab('general')}>General</button>
		<button class="tab" class:active={activeTab === 'forwards'} onclick={() => switchTab('forwards')}>
			Port Forwards <span class="tab-badge">{redirects.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'rules'} onclick={() => switchTab('rules')}>
			Traffic Rules <span class="tab-badge">{rules.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'nat'} onclick={() => switchTab('nat')}>
			NAT <span class="tab-badge">{natRules.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'groups'} onclick={() => switchTab('groups')}>
			IP Sets <span class="tab-badge">{groups.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'activity'} onclick={() => switchTab('activity')}>Activity</button>
	</div>

	{#if loading}
		<div class="loading">Loading configuration...</div>

	<!-- ===================== GENERAL TAB ===================== -->
	{:else if activeTab === 'general'}
		<div class="section-card">
			<h3 class="card-heading">Default Policies</h3>
			<p class="card-desc">Global firewall policies applied when no specific rule matches.</p>
			<div class="defaults-grid">
				<div class="default-item">
					<label class="form-label">Input</label>
					<select class="form-input" bind:value={defaults.input} onchange={saveDefaults}>
						<option value="ACCEPT">Accept</option>
						<option value="REJECT">Reject</option>
						<option value="DROP">Drop</option>
					</select>
				</div>
				<div class="default-item">
					<label class="form-label">Output</label>
					<select class="form-input" bind:value={defaults.output} onchange={saveDefaults}>
						<option value="ACCEPT">Accept</option>
						<option value="REJECT">Reject</option>
						<option value="DROP">Drop</option>
					</select>
				</div>
				<div class="default-item">
					<label class="form-label">Forward</label>
					<select class="form-input" bind:value={defaults.forward} onchange={saveDefaults}>
						<option value="ACCEPT">Accept</option>
						<option value="REJECT">Reject</option>
						<option value="DROP">Drop</option>
					</select>
				</div>
				<div class="default-item">
					<label class="form-label toggle-row">
						<input type="checkbox" bind:checked={defaults.synFlood} onchange={saveDefaults} />
						SYN Flood Protection
					</label>
				</div>
			</div>
		</div>

		<!-- Zones -->
		<div class="section-card">
			<h3 class="card-heading">Zones</h3>
			<p class="card-desc">Network zones group interfaces and define default traffic policies.</p>
			{#each zones as zone (zone.section)}
				<div class="zone-card" style="border-left: 3px solid {zone.name === 'lan' ? '#22c55e' : zone.name === 'wan' ? '#ef4444' : zone.name === 'wg' ? '#006fff' : '#8b949e'}">
					<div class="zone-header">
						<span class="zone-name">{zone.name.toUpperCase()}</span>
						<span class="zone-nets">{zone.networks.join(', ')}</span>
						{#if zone.masq}<span class="zone-badge masq">NAT</span>{/if}
						{#if zone.mtuFix}<span class="zone-badge">MTU Fix</span>{/if}
					</div>
					<div class="zone-policies">
						<div class="zone-policy">
							<label>Input</label>
							<select bind:value={zone.input} onchange={() => saveZone(zone)}>
								<option value="ACCEPT">Accept</option>
								<option value="REJECT">Reject</option>
								<option value="DROP">Drop</option>
							</select>
						</div>
						<div class="zone-policy">
							<label>Output</label>
							<select bind:value={zone.output} onchange={() => saveZone(zone)}>
								<option value="ACCEPT">Accept</option>
								<option value="REJECT">Reject</option>
								<option value="DROP">Drop</option>
							</select>
						</div>
						<div class="zone-policy">
							<label>Forward</label>
							<select bind:value={zone.forward} onchange={() => saveZone(zone)}>
								<option value="ACCEPT">Accept</option>
								<option value="REJECT">Reject</option>
								<option value="DROP">Drop</option>
							</select>
						</div>
						<label class="zone-toggle">
							<input type="checkbox" bind:checked={zone.masq} onchange={() => saveZone(zone)} />
							Masquerading
						</label>
					</div>
				</div>
			{/each}
		</div>

		<!-- Forwardings -->
		<div class="section-card">
			<h3 class="card-heading">Zone Forwardings</h3>
			<div class="fwd-list">
				{#each forwardings as fwd (fwd.section)}
					<div class="fwd-item">
						<span class="fwd-zone" style="color: {fwd.src === 'lan' ? '#22c55e' : fwd.src === 'wg' ? '#006fff' : '#f59e0b'}">{fwd.src}</span>
						<span class="fwd-arrow">→</span>
						<span class="fwd-zone" style="color: {fwd.dest === 'wan' ? '#ef4444' : fwd.dest === 'lan' ? '#22c55e' : '#006fff'}">{fwd.dest}</span>
					</div>
				{/each}
			</div>
		</div>

	<!-- ===================== PORT FORWARDING TAB ===================== -->
	{:else if activeTab === 'forwards'}
		<div class="section-card">
			<div class="section-header">
				<h2>Port Forwards</h2>
				<button class="btn btn-primary btn-sm" onclick={() => { resetForwardForm(); showAddForward = !showAddForward; }}>
					{showAddForward ? 'Cancel' : 'Add Port Forward'}
				</button>
			</div>

			{#if showAddForward}
				<div class="edit-card">
					<h3 class="edit-title">Add Port Forward</h3>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Service Name</label>
							<input type="text" class="form-input" bind:value={forwardForm.name} placeholder="e.g. Home Assistant, Plex" />
						</div>
						<div class="form-group">
							<label class="form-label">Protocol</label>
							<div class="segmented">
								<button class="seg-btn" class:seg-active={forwardForm.proto === 'tcp'} onclick={() => forwardForm.proto = 'tcp'}>TCP</button>
								<button class="seg-btn" class:seg-active={forwardForm.proto === 'udp'} onclick={() => forwardForm.proto = 'udp'}>UDP</button>
								<button class="seg-btn" class:seg-active={forwardForm.proto === 'tcp udp'} onclick={() => forwardForm.proto = 'tcp udp'}>Both</button>
							</div>
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">External Port</label>
							<input type="number" class="form-input mono" bind:value={forwardForm.src_dport} placeholder="8123" />
						</div>
						<div class="form-group">
							<label class="form-label">Destination Device</label>
							<select class="form-input" bind:value={forwardForm.dest_device}>
								<option value="">Select a device...</option>
								{#each dhcpHosts as host}
									<option value={host.ip}>{host.name} ({host.ip})</option>
								{/each}
								<option value="__custom__">Other...</option>
							</select>
							{#if forwardForm.dest_device === '__custom__'}
								<input type="text" class="form-input mono" style="margin-top: 8px;" bind:value={forwardForm.dest_ip_custom} placeholder="192.168.1.100" />
							{/if}
						</div>
						<div class="form-group">
							<label class="form-label">Internal Port</label>
							<input type="number" class="form-input mono" bind:value={forwardForm.dest_port} placeholder={forwardForm.src_dport || 'Same as external'} />
						</div>
					</div>
					<div class="edit-actions">
						<button class="btn btn-secondary btn-sm" onclick={resetForwardForm}>Cancel</button>
						<button class="btn btn-primary btn-sm" onclick={saveForward}>Save</button>
					</div>
				</div>
			{/if}

			{#if redirects.length === 0 && !showAddForward}
				<div class="empty-state">
					<div class="empty-icon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
					</div>
					<p class="empty-title">No port forwards configured</p>
					<p class="empty-desc">Forward a port to make an internal service accessible from the internet.</p>
				</div>
			{:else if redirects.length > 0}
				<div class="table-wrap">
					<table class="data-table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Protocol</th>
								<th>External Port</th>
								<th>Destination</th>
								<th>Internal Port</th>
								<th>Enabled</th>
								<th class="col-actions"></th>
							</tr>
						</thead>
						<tbody>
							{#each redirects as fwd (fwd.section)}
								<tr class:disabled-row={!fwd.enabled}>
									<td class="cell-name">{fwd.name || '(unnamed)'}</td>
									<td><span class="proto-badge {protoClass(fwd.proto)}">{protoLabel(fwd.proto)}</span></td>
									<td class="mono">{fwd.src_dport}</td>
									<td>
										{#if deviceName(fwd.dest_ip)}
											<span class="cell-name">{deviceName(fwd.dest_ip)}</span>
											<span class="dest-ip">{fwd.dest_ip}</span>
										{:else}
											<span class="mono">{fwd.dest_ip}</span>
										{/if}
									</td>
									<td class="mono">{fwd.dest_port || fwd.src_dport}</td>
									<td>
										<button class="toggle-btn" class:on={fwd.enabled} onclick={() => toggleForward(fwd)}>
											<span class="toggle-track"><span class="toggle-knob"></span></span>
										</button>
									</td>
									<td class="cell-actions">
										<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => deleteTarget = { type: 'forward', section: fwd.section, name: fwd.name }}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

	<!-- ===================== RULES TAB ===================== -->
	{:else if activeTab === 'rules'}
		<div class="section-card">
			<div class="section-header">
				<h2>Firewall Rules</h2>
				<button class="btn btn-primary btn-sm" onclick={() => { resetRuleForm(); showAddRule = !showAddRule; }}>
					{showAddRule ? 'Cancel' : 'Add Rule'}
				</button>
			</div>

			{#if showAddRule}
				<div class="edit-card">
					<h3 class="edit-title">{editingRule ? 'Edit Rule' : 'Add Firewall Rule'}</h3>

					<!-- Row 1: Name + Action -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Name</label>
							<input type="text" class="form-input" bind:value={ruleForm.name} placeholder="e.g. Block IoT Internet" />
						</div>
						<div class="form-group">
							<label class="form-label">Action</label>
							<div class="segmented">
								<button class="seg-btn seg-allow" class:seg-active={ruleForm.target === 'ACCEPT'} onclick={() => ruleForm.target = 'ACCEPT'}>Allow</button>
								<button class="seg-btn seg-block" class:seg-active={ruleForm.target === 'DROP'} onclick={() => ruleForm.target = 'DROP'}>Block</button>
								<button class="seg-btn seg-reject" class:seg-active={ruleForm.target === 'REJECT'} onclick={() => ruleForm.target = 'REJECT'}>Reject</button>
							</div>
						</div>
					</div>

					<!-- Row 2: Source zone + Dest zone -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Source Zone</label>
							<select class="form-input" bind:value={ruleForm.src}>
								<option value="">Any</option>
								{#each zones as z}<option value={z.name}>{z.name.toUpperCase()}</option>{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label">Destination Zone</label>
							<select class="form-input" bind:value={ruleForm.dest}>
								<option value="">Any</option>
								{#each zones as z}<option value={z.name}>{z.name.toUpperCase()}</option>{/each}
							</select>
						</div>
					</div>

					<!-- Row 3: Source IP + Dest IP -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Source IP / CIDR <span class="form-hint">(optional)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.src_ip} placeholder="e.g. 192.168.50.100 or 192.168.50.0/24" />
						</div>
						<div class="form-group">
							<label class="form-label">Destination IP / CIDR <span class="form-hint">(optional)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.dest_ip} placeholder="e.g. 10.0.0.0/8" />
						</div>
					</div>

					<!-- Row 4: Protocol + Ports -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Protocol</label>
							<div class="segmented">
								<button class="seg-btn" class:seg-active={ruleForm.proto === 'tcp'} onclick={() => ruleForm.proto = 'tcp'}>TCP</button>
								<button class="seg-btn" class:seg-active={ruleForm.proto === 'udp'} onclick={() => ruleForm.proto = 'udp'}>UDP</button>
								<button class="seg-btn" class:seg-active={ruleForm.proto === 'tcp udp'} onclick={() => ruleForm.proto = 'tcp udp'}>Both</button>
								<button class="seg-btn" class:seg-active={ruleForm.proto === 'any'} onclick={() => ruleForm.proto = 'any'}>Any</button>
							</div>
						</div>
						<div class="form-group">
							<label class="form-label">Source Port <span class="form-hint">(optional)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.src_port} placeholder="any" />
						</div>
						<div class="form-group">
							<label class="form-label">Dest Port <span class="form-hint">(optional)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.dest_port} placeholder="any" />
						</div>
					</div>

					<!-- Row 5: IP Set + Source MAC -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Use IP Set <span class="form-hint">(optional)</span></label>
							<select class="form-input" bind:value={ruleForm.ipset}>
								<option value="">None</option>
								{#each groups as g}
									<option value={g.name}>{g.name} ({g.entries.length} entries)</option>
								{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label">Source MAC <span class="form-hint">(optional, comma-separated)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.src_mac} placeholder="e.g. AA:BB:CC:DD:EE:FF" />
						</div>
					</div>

					<!-- Row 6: Address family + Schedule -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Address Family</label>
							<select class="form-input" bind:value={ruleForm.family}>
								<option value="">IPv4 and IPv6</option>
								<option value="ipv4">IPv4 only</option>
								<option value="ipv6">IPv6 only</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label">Week Days <span class="form-hint">(optional)</span></label>
							<input type="text" class="form-input" bind:value={ruleForm.weekdays} placeholder="e.g. Mon Tue Wed" />
						</div>
					</div>

					<!-- Row 7: Time range -->
					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Start Time <span class="form-hint">(hh:mm:ss)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.start_time} placeholder="e.g. 22:00:00" />
						</div>
						<div class="form-group">
							<label class="form-label">Stop Time <span class="form-hint">(hh:mm:ss)</span></label>
							<input type="text" class="form-input mono" bind:value={ruleForm.stop_time} placeholder="e.g. 07:00:00" />
						</div>
					</div>

					<div class="edit-actions">
						<label class="toggle-row" style="margin-right: auto">
							<input type="checkbox" bind:checked={ruleForm.log} />
							Log matched packets
						</label>
						<button class="btn btn-secondary btn-sm" onclick={resetRuleForm}>Cancel</button>
						<button class="btn btn-primary btn-sm" onclick={saveRule}>{editingRule ? 'Update' : 'Save'}</button>
					</div>
				</div>
			{/if}

			{#if rules.length === 0}
				<div class="empty-state">
					<p class="empty-title">No firewall rules</p>
					<p class="empty-desc">Add rules to control what traffic is allowed or blocked.</p>
				</div>
			{:else}
				<div class="table-wrap">
					<table class="data-table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Direction</th>
								<th>Match</th>
								<th>Action</th>
								<th>Enabled</th>
								<th class="col-actions"></th>
							</tr>
						</thead>
						<tbody>
							{#each rules as rule (rule.section)}
								{@const dir = getDirection(rule.src, rule.dest)}
								<tr class:disabled-row={!rule.enabled}>
									<td class="cell-name">
										<div class="rule-name-wrap">
											<span>
												{rule.name || '(unnamed)'}
												{#if rule.isSystem}
													<span class="system-badge">System</span>
												{/if}
											</span>
											{#if RULE_DESCRIPTIONS[rule.name]}
												<span class="rule-desc">{RULE_DESCRIPTIONS[rule.name]}</span>
											{:else}
												<span class="rule-desc">
													{#if rule.ipset}<span class="rule-detail-badge">ipset: {rule.ipset}</span>{/if}
													{#if rule.src_ip}<span class="rule-detail-badge">src: {rule.src_ip}</span>{/if}
													{#if rule.dest_ip}<span class="rule-detail-badge">dst: {rule.dest_ip}</span>{/if}
													{#if rule.weekdays}<span class="rule-detail-badge">schedule</span>{/if}
												</span>
											{/if}
										</div>
									</td>
									<td><span class="dir-badge {directionClass(dir)}">{dir}</span></td>
									<td>
										<span class="proto-badge {protoClass(rule.proto)}">{protoLabel(rule.proto)}</span>
										{#if rule.dest_port}<span class="mono rule-port">:{rule.dest_port}</span>{/if}
									</td>
									<td><span class="action-badge {actionClass(rule.target)}">{actionLabel(rule.target)}</span></td>
									<td>
										<button class="toggle-btn" class:on={rule.enabled} onclick={() => toggleRule(rule)}>
											<span class="toggle-track"><span class="toggle-knob"></span></span>
										</button>
									</td>
									<td class="cell-actions">
										{#if !rule.isSystem}
											<button class="btn-icon" title="Edit" onclick={() => startEditRule(rule)}>✎</button>
											<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => deleteTarget = { type: 'rule', section: rule.section, name: rule.name }}>
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="table-footer">
					{systemRuleCount} system rules are active (DHCP, DNS, ICMP, etc.)
				</div>
			{/if}
		</div>

	<!-- ===================== NAT TAB ===================== -->
	{:else if activeTab === 'nat'}
		<div class="section-card">
			<div class="groups-header">
				<p class="section-desc">Source NAT (SNAT) rules for outbound traffic address translation.</p>
				<button class="btn-primary btn-sm" onclick={() => { showAddNat = true; }}>Add NAT Rule</button>
			</div>

			{#if showAddNat}
				<div class="edit-card">
					<h3 class="edit-title">New NAT Rule</h3>
					<div class="form-row-2">
						<div class="form-group">
							<label class="form-label">Name</label>
							<input type="text" class="form-input" bind:value={natForm.name} placeholder="e.g. SNAT-to-WAN" />
						</div>
						<div class="form-group">
							<label class="form-label">Source Zone</label>
							<select class="form-input" bind:value={natForm.src}>
								{#each zones as z}<option value={z.name}>{z.name}</option>{/each}
							</select>
						</div>
					</div>
					<div class="form-row-2">
						<div class="form-group">
							<label class="form-label">Source IP (optional)</label>
							<input type="text" class="form-input mono" bind:value={natForm.src_ip} placeholder="e.g. 192.168.50.0/24" />
						</div>
						<div class="form-group">
							<label class="form-label">SNAT IP (rewrite to)</label>
							<input type="text" class="form-input mono" bind:value={natForm.snat_ip} placeholder="e.g. WAN IP" />
						</div>
					</div>
					<div class="form-row-2">
						<div class="form-group">
							<label class="form-label">Protocol</label>
							<select class="form-input" bind:value={natForm.proto}>
								<option value="all">All</option>
								<option value="tcp">TCP</option>
								<option value="udp">UDP</option>
								<option value="tcp udp">TCP+UDP</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label">Target</label>
							<select class="form-input" bind:value={natForm.target}>
								<option value="SNAT">SNAT</option>
								<option value="MASQUERADE">MASQUERADE</option>
							</select>
						</div>
					</div>
					<div class="edit-actions">
						<button class="btn-secondary btn-sm" onclick={() => { showAddNat = false; }}>Cancel</button>
						<button class="btn-primary btn-sm" onclick={addNatRule}>Create</button>
					</div>
				</div>
			{/if}

			{#if natRules.length > 0}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Source</th>
								<th>Source IP</th>
								<th>SNAT IP</th>
								<th>Proto</th>
								<th>Target</th>
								<th class="col-actions">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each natRules as nat (nat.section)}
								<tr>
									<td class="cell-name">{nat.name || '(unnamed)'}</td>
									<td>{nat.src}</td>
									<td class="mono">{nat.src_ip || '*'}</td>
									<td class="mono">{nat.snat_ip || 'masquerade'}</td>
									<td>{nat.proto}</td>
									<td><span class="match-badge">{nat.target}</span></td>
									<td class="cell-actions">
										<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => deleteNat(nat.section)}>✕</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if !showAddNat}
				<p class="empty-msg">No NAT rules. Masquerading is configured per-zone in the General tab.</p>
			{/if}
		</div>

	<!-- ===================== IP GROUPS TAB ===================== -->
	{:else if activeTab === 'groups'}
		<div class="section-card">
			<div class="groups-header">
				<p class="section-desc">Create named groups of IPs, MACs, or ports to use in firewall rules.</p>
				<button class="btn-primary btn-sm" onclick={() => { showAddGroup = true; groupForm = { name: '', match: 'src_ip', entries: '' }; }}>Add Group</button>
			</div>

			{#if showAddGroup || editingGroup}
				<div class="edit-card">
					<h3 class="edit-title">{editingGroup ? 'Edit Group' : 'New IP Group'}</h3>
					<div class="form-row-2">
						<div class="form-group">
							<label class="form-label">Group Name</label>
							<input type="text" class="form-input" bind:value={groupForm.name} placeholder="e.g. iot-devices, blocked-ips" />
						</div>
						<div class="form-group">
							<label class="form-label">Match Type</label>
							<select class="form-input" bind:value={groupForm.match}>
								<option value="src_ip">IP Addresses (source)</option>
								<option value="dest_ip">IP Addresses (destination)</option>
								<option value="src_mac">MAC Addresses</option>
								<option value="src_port">Ports (source)</option>
								<option value="dest_port">Ports (destination)</option>
							</select>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label">Members</label>
						<!-- Already added entries -->
						<div class="entry-list">
							{#each groupFormEntries as entry, i}
								<div class="entry-tag">
									<span class="entry-val">{entry}</span>
									<span class="entry-name">{entryLabel(entry)}</span>
									<button class="entry-remove" onclick={() => removeEntry(i)}>✕</button>
								</div>
							{/each}
						</div>
						<!-- Add from known devices or type custom -->
						<div class="entry-add">
							{#if groupForm.match.includes('ip') || groupForm.match.includes('mac')}
								<select class="form-input entry-select" bind:value={pickerValue} onchange={() => addFromPicker()}>
									<option value="">— Pick a device —</option>
									{#each availableDevices as dev}
										<option value={groupForm.match.includes('mac') ? dev.mac : dev.ip}>
											{dev.name || '(unknown)'} — {groupForm.match.includes('mac') ? dev.mac : dev.ip}
										</option>
									{/each}
								</select>
							{/if}
							<div class="entry-custom">
								<input type="text" class="form-input" bind:value={customEntry}
									placeholder={groupForm.match.includes('ip') ? 'Or type IP...' :
										groupForm.match.includes('mac') ? 'Or type MAC...' : 'Type port...'}
									onkeydown={(e) => { if (e.key === 'Enter') addCustomEntry(); }}
								/>
								<button class="btn-primary btn-sm" onclick={addCustomEntry}>Add</button>
							</div>
						</div>
					</div>
					<div class="edit-actions">
						<button class="btn-secondary btn-sm" onclick={() => { showAddGroup = false; editingGroup = null; }}>Cancel</button>
						<button class="btn-primary btn-sm" onclick={() => editingGroup ? saveEditGroup() : addGroup()}>
							{editingGroup ? 'Save' : 'Create Group'}
						</button>
					</div>
				</div>
			{/if}

			{#if groups.length > 0}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Type</th>
								<th>Entries</th>
								<th class="col-actions">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each groups as group (group.section)}
								<tr>
									<td class="cell-name">{group.name}</td>
									<td><span class="match-badge">{group.match.replace('_', ' ')}</span></td>
									<td class="mono entries-cell">{group.entries.join(', ') || '(empty)'}</td>
									<td class="cell-actions">
										<button class="btn-icon" title="Edit" onclick={() => startEditGroup(group)}>✎</button>
										<button class="btn-icon btn-icon-danger" title="Delete" onclick={() => deleteGroup(group.section)}>✕</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if !showAddGroup}
				<p class="empty-msg">No IP groups defined. Create a group to use in firewall rules.</p>
			{/if}
		</div>

	<!-- ===================== ACTIVITY TAB ===================== -->
	{:else if activeTab === 'activity'}
		<div class="section-card">
			<div class="conntrack-header">
				<span class="conntrack-label">Active Connections</span>
				<span class="conntrack-count">
					<span class="conntrack-value">{conntrackCount.toLocaleString()}</span>
					<span class="conntrack-max">/ {conntrackMax.toLocaleString()}</span>
				</span>
			</div>
			<div class="conntrack-progress">
				<div class="conntrack-fill" style="width: {Math.min(100, (conntrackCount / conntrackMax) * 100)}%"></div>
			</div>
		</div>

		<div class="section-card">
			<h2 class="section-title">Recent Blocked Connections</h2>
			{#if activityLoading}
				<div class="loading">Loading activity...</div>
			{:else if recentBlocks.length === 0}
				<div class="empty-state">
					<div class="empty-icon empty-icon-shield">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
					</div>
					<p class="empty-title">No recent blocked connections</p>
					<p class="empty-desc">Your firewall is quietly protecting your network.</p>
				</div>
			{:else}
				<div class="activity-feed">
					{#each recentBlocks as block}
						<div class="block-event">
							<div class="block-route">
								<span class="mono">{block.src || 'unknown'}</span>
								<span class="block-arrow">&rarr;</span>
								<span class="mono">{block.dst || 'unknown'}{block.dport ? ':' + block.dport : ''}</span>
							</div>
							<div class="block-meta">
								<span class="proto-badge {protoClass(block.proto || 'tcp')}">{(block.proto || 'TCP').toUpperCase()}</span>
								{#if block.dport}
									<span class="block-port">Port {block.dport}</span>
								{/if}
								<span class="block-time">{block.timestamp ? formatRelativeTime(block.timestamp) : ''}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Delete Confirmation Modal -->
	{#if deleteTarget}
		<div class="modal-overlay" role="presentation" onclick={() => deleteTarget = null}>
			<div class="modal" role="dialog" onclick={(e) => e.stopPropagation()}>
				<h3>Delete {deleteTarget.type === 'forward' ? 'Port Forward' : 'Rule'}</h3>
				<p>Remove <strong>{deleteTarget.name || '(unnamed)'}</strong>? This cannot be undone after applying.</p>
				<div class="modal-actions">
					<button class="btn btn-secondary btn-sm" onclick={() => deleteTarget = null}>Cancel</button>
					<button class="btn btn-danger btn-sm" onclick={() => {
						if (deleteTarget?.type === 'forward') removeForward(deleteTarget.section);
						else if (deleteTarget) removeRule(deleteTarget.section);
					}}>Delete</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Apply Bar -->
	{#if pendingChanges}
		<div class="apply-bar">
			<span class="apply-text">You have unsaved changes</span>
			<div class="apply-actions">
				<button class="btn btn-secondary" onclick={handleDiscard} disabled={saving}>Discard</button>
				<button class="btn btn-primary" onclick={handleApply} disabled={saving}>
					{#if saving}Applying...{:else}Apply Changes{/if}
				</button>
			</div>
		</div>
	{/if}

	{#if applyCountdown > 0}
		<div class="countdown-toast">Changes applied. Auto-confirming in {applyCountdown}s...</div>
	{/if}
</div>

<style>
	.page { display: flex; flex-direction: column; gap: 20px; padding-bottom: 80px; }

	/* ===== Tabs (copied from DHCP page) ===== */
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

	/* ===== Typography ===== */
	h1 { font-size: 24px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.subtitle { font-size: 14px; color: var(--color-text-muted); margin: 0 0 8px; }
	.loading { color: var(--color-text-secondary); padding: 40px 0; text-align: center; }

	/* ===== Section cards ===== */
	.section-card {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 12px; padding: 20px;
	}
	.section-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
	}
	.section-header h2 { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.section-title { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 16px; }

	/* ===== Edit card (form container) ===== */
	.edit-card {
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); padding: 16px; margin-bottom: 16px;
	}
	.edit-title { font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin: 0 0 12px; }
	.edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }

	/* ===== Form ===== */
	.form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
	.form-group { margin-bottom: 8px; }
	.form-label { display: block; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; }
	.form-hint { color: var(--color-text-muted); font-weight: 400; }
	.form-input {
		width: 100%; padding: 8px 12px;
		background: var(--color-surface-600); border: 1px solid var(--color-surface-500);
		border-radius: var(--radius-sm); color: var(--color-text-primary);
		font-size: 14px; outline: none; transition: border-color 0.15s;
		box-sizing: border-box;
	}
	.form-input:focus { border-color: var(--color-accent); }
	select.form-input { cursor: pointer; appearance: auto; }

	/* ===== Segmented buttons ===== */
	.segmented {
		display: flex; gap: 0; border-radius: var(--radius-sm); overflow: hidden;
		border: 1px solid var(--color-surface-500);
	}
	.seg-btn {
		padding: 7px 14px; background: var(--color-surface-600); border: none;
		color: var(--color-text-muted); font-size: 13px; font-weight: 500;
		cursor: pointer; transition: all 0.15s; flex: 1; text-align: center;
		font-family: inherit;
	}
	.seg-btn:not(:last-child) { border-right: 1px solid var(--color-surface-500); }
	.seg-btn:hover { color: var(--color-text-primary); background: var(--color-surface-500); }
	.seg-btn.seg-active {
		background: var(--color-accent-muted); color: var(--color-accent-light);
	}
	.seg-btn.seg-allow.seg-active { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
	.seg-btn.seg-block.seg-active { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
	.seg-btn.seg-reject.seg-active { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

	/* ===== Table ===== */
	.table-wrap { overflow-x: auto; }
	.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
	.data-table thead th {
		text-align: left; padding: 8px 12px; font-weight: 600;
		color: var(--color-text-muted); border-bottom: 1px solid var(--color-surface-500);
		font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em;
		user-select: none; white-space: nowrap;
	}
	.data-table tbody td {
		padding: 10px 12px; border-bottom: 1px solid var(--color-surface-600);
		color: var(--color-text-primary);
	}
	.data-table tbody tr:hover { background: rgba(255,255,255,0.02); }
	.data-table tbody tr:last-child td { border-bottom: none; }
	.data-table tbody tr.disabled-row td { opacity: 0.4; }

	.col-actions { width: 60px; text-align: right; }
	.cell-name { font-weight: 600; }
	.cell-actions { text-align: right; white-space: nowrap; }
	.mono { font-family: var(--font-mono); font-size: 12px; }
	.dest-ip { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); margin-left: 6px; }
	.table-footer { font-size: 12px; color: var(--color-text-muted); margin-top: 12px; padding: 0 4px; }

	/* ===== Protocol badges ===== */
	.proto-badge {
		display: inline-block; padding: 2px 8px; border-radius: var(--radius-full);
		font-size: 11px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap;
	}
	.proto-tcp { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
	.proto-udp { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
	.proto-both { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
	.proto-other { background: var(--color-surface-600); color: var(--color-text-secondary); }

	/* ===== Direction badges ===== */
	.dir-badge {
		display: inline-block; padding: 2px 8px; border-radius: var(--radius-full);
		font-size: 11px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap;
	}
	.dir-inbound { background: rgba(34, 211, 238, 0.15); color: #22d3ee; }
	.dir-outbound { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
	.dir-forward { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
	.dir-internal { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
	.dir-any { background: var(--color-surface-600); color: var(--color-text-secondary); }

	/* ===== Action badges ===== */
	.action-badge {
		display: inline-block; padding: 2px 10px; border-radius: var(--radius-full);
		font-size: 11px; font-weight: 600; letter-spacing: 0.03em; white-space: nowrap;
	}
	.action-allow { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
	.action-block { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
	.action-reject { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

	/* ===== Rule name with description ===== */
	.rule-name-wrap { display: flex; flex-direction: column; gap: 2px; }
	.rule-desc { font-size: 11px; color: var(--color-text-muted); font-weight: 400; line-height: 1.3; display: flex; gap: 4px; flex-wrap: wrap; }
	.rule-detail-badge {
		display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px;
		background: var(--color-surface-600); color: var(--color-text-secondary);
		font-family: var(--font-mono);
	}
	.rule-port { font-size: 12px; color: var(--color-text-secondary); margin-left: 2px; }

	/* ===== System badge ===== */
	.system-badge {
		display: inline-block; padding: 1px 6px; border-radius: var(--radius-full);
		font-size: 10px; font-weight: 600; letter-spacing: 0.03em;
		background: var(--color-surface-600); color: var(--color-text-muted);
		margin-left: 6px; vertical-align: middle;
	}

	/* ===== Toggle switch ===== */
	.toggle-btn {
		background: none; border: none; cursor: pointer; padding: 2px;
		display: inline-flex; align-items: center;
	}
	.toggle-track {
		display: block; width: 36px; height: 20px; border-radius: 10px;
		background: var(--color-surface-500); position: relative;
		transition: background 0.2s ease;
	}
	.toggle-knob {
		display: block; width: 16px; height: 16px; border-radius: 50%;
		background: var(--color-text-muted); position: absolute;
		top: 2px; left: 2px; transition: all 0.2s ease;
	}
	.toggle-btn.on .toggle-track { background: rgba(34, 197, 94, 0.3); }
	.toggle-btn.on .toggle-knob { background: #22c55e; left: 18px; }

	/* ===== Icon buttons ===== */
	.btn-icon {
		background: none; border: none; cursor: pointer; padding: 4px 6px;
		color: var(--color-text-muted); border-radius: var(--radius-sm);
		transition: all 0.15s; display: inline-flex; align-items: center;
	}
	.btn-icon:hover { background: var(--color-surface-600); color: var(--color-text-primary); }
	.btn-icon-danger:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

	/* ===== Conntrack bar ===== */
	.conntrack-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 10px;
	}
	.conntrack-label { font-size: 14px; color: var(--color-text-secondary); font-weight: 500; }
	.conntrack-count { display: flex; align-items: baseline; gap: 4px; }
	.conntrack-value { font-size: 20px; font-weight: 600; color: var(--color-text-primary); font-family: var(--font-mono); }
	.conntrack-max { font-size: 13px; color: var(--color-text-muted); font-family: var(--font-mono); }
	.conntrack-progress {
		width: 100%; height: 6px; background: var(--color-surface-600);
		border-radius: 3px; overflow: hidden;
	}
	.conntrack-fill {
		height: 100%; background: var(--color-accent); border-radius: 3px;
		transition: width 0.3s ease;
	}

	/* ===== Activity feed ===== */
	.activity-feed { display: flex; flex-direction: column; gap: 0; }
	.block-event {
		display: flex; align-items: center; justify-content: space-between;
		padding: 10px 0; border-bottom: 1px solid var(--color-surface-600);
		border-left: 3px solid #ef4444; padding-left: 12px; gap: 12px;
	}
	.block-event:last-child { border-bottom: none; }
	.block-route { display: flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
	.block-arrow { color: var(--color-text-muted); }
	.block-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
	.block-port { font-size: 12px; color: var(--color-text-muted); }
	.block-time { font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); }

	/* ===== Empty state ===== */
	.empty-state { text-align: center; padding: 40px 16px; }
	.empty-icon { color: var(--color-text-muted); margin-bottom: 12px; opacity: 0.4; }
	.empty-icon-shield { color: #22c55e; opacity: 0.5; }
	.empty-title { font-size: 15px; color: var(--color-text-secondary); margin: 0 0 6px; font-weight: 500; }
	.empty-desc { font-size: 13px; color: var(--color-text-muted); margin: 0; }

	/* ===== Buttons ===== */
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
	.btn-danger { background: #ef4444; color: white; }
	.btn-danger:hover:not(:disabled) { background: #dc2626; }

	/* ===== Modal ===== */
	.modal-overlay {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200;
		display: flex; align-items: center; justify-content: center;
	}
	.modal {
		background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 12px; padding: 24px; max-width: 400px; width: 90%;
	}
	.modal h3 { font-size: 16px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 12px; }
	.modal p { font-size: 14px; color: var(--color-text-secondary); margin: 0 0 20px; line-height: 1.5; }
	.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

	/* ===== Apply bar ===== */
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
		border-radius: 12px; font-size: 13px;
	}

	/* IP Groups */
	.groups-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
	.section-desc { font-size: 13px; color: var(--color-text-muted); margin: 0; }
	.form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
	.form-textarea {
		width: 100%; padding: 10px 12px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 13px; font-family: var(--font-mono);
		resize: vertical; outline: none;
	}
	.form-textarea:focus { border-color: var(--color-accent); }
	.match-badge {
		font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 8px;
		background: var(--color-accent-muted); color: var(--color-accent-light);
		text-transform: capitalize;
	}
	.entries-cell { font-size: 12px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.empty-msg { text-align: center; color: var(--color-text-muted); padding: 32px; font-size: 14px; }

	/* General tab */
	.card-heading { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin: 0 0 4px; }
	.card-desc { font-size: 12px; color: var(--color-text-muted); margin: 0 0 16px; }
	.defaults-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
	.default-item select { width: 100%; }
	.toggle-row { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--color-text-secondary); }

	.zone-card {
		background: var(--color-surface-700); border-radius: 8px; padding: 12px 16px;
		margin-bottom: 8px;
	}
	.zone-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
	.zone-name { font-size: 14px; font-weight: 700; color: var(--color-text-primary); }
	.zone-nets { font-size: 12px; color: var(--color-text-muted); font-family: var(--font-mono); }
	.zone-badge {
		font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
		background: var(--color-surface-600); color: var(--color-text-secondary);
	}
	.zone-badge.masq { background: var(--color-accent-muted); color: var(--color-accent-light); }
	.zone-policies { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
	.zone-policy { display: flex; flex-direction: column; gap: 2px; }
	.zone-policy label { font-size: 11px; color: var(--color-text-muted); }
	.zone-policy select {
		padding: 4px 8px; background: var(--color-surface-800); border: 1px solid var(--color-surface-500);
		border-radius: 6px; color: var(--color-text-primary); font-size: 12px; font-family: inherit;
	}
	.zone-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; margin-left: auto; }

	.fwd-list { display: flex; flex-wrap: wrap; gap: 12px; }
	.fwd-item { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
	.fwd-arrow { color: var(--color-text-muted); }

	/* Entry list + picker */
	.entry-list {
		display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; min-height: 8px;
	}
	.entry-tag {
		display: inline-flex; align-items: center; gap: 6px;
		background: var(--color-surface-700); border: 1px solid var(--color-surface-500);
		border-radius: 8px; padding: 4px 8px 4px 10px; font-size: 12px;
	}
	.entry-val { font-family: var(--font-mono); color: var(--color-text-primary); }
	.entry-name { color: var(--color-text-muted); font-size: 11px; }
	.entry-remove {
		background: none; border: none; color: var(--color-text-muted); cursor: pointer;
		font-size: 12px; padding: 0 2px; line-height: 1;
	}
	.entry-remove:hover { color: var(--color-danger); }

	.entry-add { display: flex; flex-direction: column; gap: 8px; }
	.entry-select {
		width: 100%; padding: 8px 10px; background: var(--color-surface-700);
		border: 1px solid var(--color-surface-500); border-radius: 8px;
		color: var(--color-text-primary); font-size: 13px; font-family: inherit;
	}
	.entry-select:focus { border-color: var(--color-accent); outline: none; }
	.entry-custom { display: flex; gap: 6px; }
	.entry-custom .form-input { flex: 1; }
</style>
