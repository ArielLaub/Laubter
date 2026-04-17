import { writable } from 'svelte/store';

// Sidebar pinned state — shared between Sidebar and Layout
export const sidebarPinned = writable(false);
