/** Simple toast notification store */
import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let nextId = 0;
export const toasts = writable<Toast[]>([]);

export function toast(message: string, type: Toast['type'] = 'info', duration = 3000) {
  const id = ++nextId;
  toasts.update(t => [...t, { id, message, type }]);
  setTimeout(() => toasts.update(t => t.filter(x => x.id !== id)), duration);
}
