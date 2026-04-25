/** Auth store — manages login state */
import { writable, get } from 'svelte/store';
import { api } from '$lib/api/client';

export const authenticated = writable(false);
export const username = writable('');

export async function checkAuth(): Promise<boolean> {
  try {
    const status = await fetch('/api/auth/status', { credentials: 'include' }).then(r => r.json());
    authenticated.set(status.authenticated);
    username.set(status.username ?? '');
    return status.authenticated;
  } catch {
    authenticated.set(false);
    return false;
  }
}

export async function login(user: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: user, password })
    });
    const data = await res.json();
    if (res.ok) {
      authenticated.set(true);
      username.set(data.username);
      return { ok: true };
    }
    return { ok: false, error: data.error ?? 'Login failed' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  authenticated.set(false);
  username.set('');
}
