<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { init, connected } from '$lib/stores/websocket';
  import { onMount } from 'svelte';
  import { LayoutDashboard, Wifi, Users, Shield, Settings, Server } from 'lucide-svelte';

  let { children } = $props();

  onMount(() => init());

  const nav = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/mesh', label: 'WiFi Mesh', icon: Wifi },
    { href: '/clients', label: 'Clients', icon: Users },
    { href: '/dhcp', label: 'DHCP & DNS', icon: Server },
    { href: '/firewall', label: 'Firewall', icon: Shield },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
</script>

<div class="flex h-screen overflow-hidden">
  <!-- Sidebar -->
  <nav class="w-56 flex-shrink-0 bg-[var(--color-surface-800)] border-r border-[var(--color-surface-500)] flex flex-col">
    <div class="px-5 py-5 border-b border-[var(--color-surface-500)]">
      <div class="text-xl font-bold text-[var(--color-accent-light)] tracking-tight">Laubter</div>
      <div class="text-[10px] text-[#8b949e] mt-0.5 tracking-wider uppercase">Router Management</div>
    </div>

    <div class="flex-1 py-3 flex flex-col gap-0.5 px-2">
      {#each nav as item}
        {@const active = page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href))}
        <a href={item.href}
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
            {active
              ? 'bg-[var(--color-accent)] text-white shadow-md shadow-[var(--color-accent)]/20'
              : 'text-[#8b949e] hover:text-white hover:bg-[var(--color-surface-700)]'}">
          <item.icon size={18} strokeWidth={1.75} />
          {item.label}
        </a>
      {/each}
    </div>

    <div class="px-4 py-3 border-t border-[var(--color-surface-500)] text-[11px] text-[#8b949e]">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full {$connected ? 'bg-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[var(--color-danger)]'}"></div>
        {$connected ? 'Live' : 'Connecting...'}
      </div>
    </div>
  </nav>

  <main class="flex-1 overflow-y-auto bg-[var(--color-surface-900)]">
    <div class="max-w-7xl mx-auto p-6">
      {@render children()}
    </div>
  </main>
</div>
