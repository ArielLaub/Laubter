<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { init, connected } from '$lib/stores/websocket';
  import { onMount } from 'svelte';
  import { LayoutDashboard, Wifi, Users, Shield, ShieldCheck, Lock, Settings, Server, Menu, X, BarChart3, ScrollText } from 'lucide-svelte';
  import { toasts } from '$lib/stores/toast';

  let { children } = $props();
  let mobileOpen = $state(false);

  onMount(() => init());

  const nav = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/statistics', label: 'Statistics', icon: BarChart3 },
    { href: '/mesh', label: 'ASUS AiMesh', icon: Wifi },
    { href: '/clients', label: 'Clients', icon: Users },
    { href: '/dhcp', label: 'DHCP & DNS', icon: Server },
    { href: '/adguard', label: 'AdGuard DNS', icon: ShieldCheck },
    { href: '/firewall', label: 'Firewall', icon: Shield },
    { href: '/vpn', label: 'VPN', icon: Lock },
    { href: '/log', label: 'System Log', icon: ScrollText },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  // Close sidebar on navigation
  $effect(() => {
    page.url.pathname;
    mobileOpen = false;
  });
</script>

<div class="flex h-screen overflow-hidden">
  <!-- Mobile header -->
  <div class="fixed top-0 left-0 right-0 h-14 bg-[var(--color-surface-800)] border-b border-[var(--color-surface-500)] flex items-center px-4 gap-3 z-40 lg:hidden">
    <button class="p-1 text-[#8b949e]" onclick={() => mobileOpen = !mobileOpen}>
      {#if mobileOpen}<X size={22} />{:else}<Menu size={22} />{/if}
    </button>
    <span class="text-base font-bold text-[var(--color-accent-light)]">Laubter</span>
    <div class="ml-auto flex items-center gap-2 text-[11px] text-[#8b949e]">
      <div class="w-2 h-2 rounded-full {$connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}"></div>
      {$connected ? 'Live' : '...'}
    </div>
  </div>

  <!-- Sidebar backdrop (mobile) -->
  {#if mobileOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 bg-black/50 z-40 lg:hidden" onclick={() => mobileOpen = false}></div>
  {/if}

  <!-- Sidebar -->
  <nav class="fixed lg:static top-0 left-0 bottom-0 w-56 flex-shrink-0 bg-[var(--color-surface-800)] border-r border-[var(--color-surface-500)] flex flex-col z-50
    transition-transform duration-200 {mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0">
    <div class="px-5 py-5 border-b border-[var(--color-surface-500)]">
      <div class="text-xl font-bold text-[var(--color-accent-light)] tracking-tight">Laubter</div>
      <div class="text-[10px] text-[#8b949e] mt-0.5 tracking-wider uppercase">Router Management</div>
    </div>

    <div class="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
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

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto bg-[var(--color-surface-900)] pt-14 lg:pt-0">
    <div class="max-w-7xl mx-auto p-4 lg:p-6">
      {@render children()}
    </div>
  </main>
</div>

<!-- Toast notifications -->
{#if $toasts.length > 0}
  <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
    {#each $toasts as t (t.id)}
      <div class="px-4 py-3 rounded-lg shadow-lg text-sm font-medium min-w-[200px] animate-slide-up
        {t.type === 'success' ? 'bg-[#22c55e] text-white' : t.type === 'error' ? 'bg-[#ef4444] text-white' : 'bg-[var(--color-surface-700)] text-white border border-[var(--color-surface-500)]'}">
        {t.message}
      </div>
    {/each}
  </div>
{/if}

<style>
  @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .animate-slide-up { animation: slide-up 200ms ease-out; }
</style>
