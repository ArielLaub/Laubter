import { writable, get } from 'svelte/store';
import { login as ubusLogin, logout as ubusLogout, getSessionId, setSessionId, addInterceptor, UBUS_STATUS, call } from '$api/ubus';
import type { LoginResult } from '$api/ubus';

interface SessionState {
	authenticated: boolean;
	username: string;
	timeout: number;
}

export const session = writable<SessionState>({
	authenticated: false,
	username: '',
	timeout: 0
});

// Check for existing session in localStorage
const savedSession = typeof localStorage !== 'undefined' ? localStorage.getItem('owrt_session') : null;
if (savedSession) {
	try {
		const { sid, username } = JSON.parse(savedSession);
		setSessionId(sid);
		session.set({ authenticated: true, username, timeout: 300 });
	} catch {
		localStorage.removeItem('owrt_session');
	}
}

// Track consecutive access denied errors — only invalidate after multiple
let accessDeniedCount = 0;
const ACCESS_DENIED_THRESHOLD = 3;

addInterceptor((response: unknown) => {
	const resp = response as { result?: [number, unknown]; error?: { code?: number } };
	const isAccessDenied = resp?.error?.code === -32002;

	if (isAccessDenied) {
		accessDeniedCount++;
		// Only invalidate session after several consecutive access denied errors
		// This prevents a single ACL miss from logging the user out
		if (accessDeniedCount >= ACCESS_DENIED_THRESHOLD) {
			const current = get(session);
			if (current.authenticated) {
				session.set({ authenticated: false, username: '', timeout: 0 });
				localStorage.removeItem('owrt_session');
			}
		}
	} else {
		// Any successful response resets the counter
		accessDeniedCount = 0;
	}
});

export async function login(username: string, password: string): Promise<LoginResult> {
	const result = await ubusLogin(username, password);
	accessDeniedCount = 0;
	session.set({
		authenticated: true,
		username: result.data.username,
		timeout: result.timeout
	});
	localStorage.setItem(
		'owrt_session',
		JSON.stringify({ sid: result.ubus_rpc_session, username: result.data.username })
	);
	return result;
}

export async function logout(): Promise<void> {
	try {
		await ubusLogout();
	} catch { /* may already be expired */ }
	session.set({ authenticated: false, username: '', timeout: 0 });
	localStorage.removeItem('owrt_session');
}

/**
 * Validate an existing session by making a lightweight ubus call.
 * Returns true if session is still valid.
 */
export async function validateSession(): Promise<boolean> {
	try {
		await call('session', 'access', {
			scope: 'ubus',
			object: 'system',
			function: 'info'
		});
		return true;
	} catch {
		return false;
	}
}
