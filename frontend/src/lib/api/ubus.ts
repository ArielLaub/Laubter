/**
 * ubus JSON-RPC client with automatic request batching.
 * Ported from LuCI's rpc.declare() pattern.
 *
 * Multiple calls made in the same microtask are batched into a single HTTP request.
 */

const UBUS_URL = '/ubus';
const NULL_SESSION = '00000000000000000000000000000000';

// Error codes from ubus
export const UBUS_STATUS = {
	OK: 0,
	INVALID_COMMAND: 1,
	INVALID_ARGUMENT: 2,
	METHOD_NOT_FOUND: 3,
	NOT_FOUND: 4,
	NO_DATA: 5,
	PERMISSION_DENIED: 6,
	TIMEOUT: 7,
	NOT_SUPPORTED: 8,
	UNKNOWN: 9,
	CONNECTION_FAILED: 10
} as const;

export type UbusStatusCode = (typeof UBUS_STATUS)[keyof typeof UBUS_STATUS];

export class UbusError extends Error {
	constructor(
		public code: UbusStatusCode,
		message?: string
	) {
		super(message ?? `ubus error: ${code}`);
		this.name = 'UbusError';
	}
}

// --- Session management ---

let sessionId = NULL_SESSION;

export function getSessionId(): string {
	return sessionId;
}

export function setSessionId(sid: string): void {
	sessionId = sid;
}

export function clearSession(): void {
	sessionId = NULL_SESSION;
}

// --- Interceptors (for auth expiry detection) ---

type Interceptor = (response: unknown) => void;
const interceptors: Interceptor[] = [];

export function addInterceptor(fn: Interceptor): void {
	interceptors.push(fn);
}

export function removeInterceptor(fn: Interceptor): void {
	const idx = interceptors.indexOf(fn);
	if (idx !== -1) interceptors.splice(idx, 1);
}

// --- Batching engine ---

interface PendingCall {
	id: number;
	request: {
		jsonrpc: '2.0';
		id: number;
		method: 'call';
		params: [string, string, string, Record<string, unknown>];
	};
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

let nextId = 1;
let pendingBatch: PendingCall[] = [];
let batchScheduled = false;

function scheduleBatch(): void {
	if (batchScheduled) return;
	batchScheduled = true;
	// Use queueMicrotask so all sync calls in the same tick are batched
	queueMicrotask(flushBatch);
}

async function flushBatch(): Promise<void> {
	batchScheduled = false;
	const batch = pendingBatch;
	pendingBatch = [];

	if (batch.length === 0) return;

	const requests = batch.map((p) => p.request);
	const body = batch.length === 1 ? requests[0] : requests;

	try {
		const res = await fetch(UBUS_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			const err = new Error(`HTTP ${res.status}`);
			batch.forEach((p) => p.reject(err));
			return;
		}

		const json = await res.json();
		const results: unknown[] = Array.isArray(json) ? json : [json];

		// Run interceptors
		for (const result of results) {
			for (const fn of interceptors) {
				try {
					fn(result);
				} catch {
					/* interceptor errors don't block */
				}
			}
		}

		// Match responses to pending calls by id
		const byId = new Map<number, unknown>();
		for (const r of results) {
			if (r && typeof r === 'object' && 'id' in r) {
				byId.set((r as { id: number }).id, r);
			}
		}

		for (const pending of batch) {
			const resp = byId.get(pending.id) as
				| { result?: [number, unknown]; error?: unknown }
				| undefined;
			if (!resp) {
				pending.reject(new Error('No response for request ' + pending.id));
			} else if (resp.error) {
				const errObj = resp.error as { code?: number; message?: string };
				// -32002 is "Access denied" from rpcd (expired/invalid session)
				if (errObj.code === -32002) {
					pending.reject(new UbusError(UBUS_STATUS.PERMISSION_DENIED, errObj.message ?? 'Access denied'));
				} else {
					pending.reject(new UbusError(UBUS_STATUS.UNKNOWN, JSON.stringify(resp.error)));
				}
			} else if (resp.result) {
				const [code, data] = resp.result;
				if (code !== 0) {
					pending.reject(new UbusError(code as UbusStatusCode));
				} else {
					pending.resolve(data ?? {});
				}
			} else {
				pending.resolve({});
			}
		}
	} catch (err) {
		batch.forEach((p) => p.reject(err));
	}
}

// --- Core call function ---

export function call<T = Record<string, unknown>>(
	object: string,
	method: string,
	params: Record<string, unknown> = {}
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const id = nextId++;
		pendingBatch.push({
			id,
			request: {
				jsonrpc: '2.0',
				id,
				method: 'call',
				params: [sessionId, object, method, params]
			},
			resolve: resolve as (v: unknown) => void,
			reject
		});
		scheduleBatch();
	});
}

// --- Declare pattern (like LuCI's rpc.declare) ---

interface DeclareOptions<T, R = T> {
	object: string;
	method: string;
	params?: string[];
	expect?: Record<string, unknown>;
	filter?: (data: T) => R;
	/** If true, this call is NOT batched (for slow operations like wifi scan) */
	nobatch?: boolean;
}

/**
 * Declare a reusable RPC function, like LuCI's rpc.declare().
 *
 * @example
 * const getSystemInfo = declare({ object: 'system', method: 'info' });
 * const info = await getSystemInfo();
 */
export function declare<T = Record<string, unknown>, R = T>(
	opts: DeclareOptions<T, R>
): (...args: unknown[]) => Promise<R> {
	return (...args: unknown[]) => {
		// Map positional args to named params
		const params: Record<string, unknown> = {};
		if (opts.params) {
			opts.params.forEach((name, i) => {
				if (i < args.length && args[i] !== undefined) {
					params[name] = args[i];
				}
			});
		} else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
			Object.assign(params, args[0]);
		}

		if (opts.nobatch) {
			// Direct call, not batched
			return directCall<T>(opts.object, opts.method, params).then((data) => {
				const result = applyExpect(data, opts.expect);
				return opts.filter ? opts.filter(result as T) : (result as R);
			});
		}

		return call<T>(opts.object, opts.method, params).then((data) => {
			const result = applyExpect(data, opts.expect);
			return opts.filter ? opts.filter(result as T) : (result as R);
		});
	};
}

/** Direct (non-batched) call */
async function directCall<T>(
	object: string,
	method: string,
	params: Record<string, unknown>
): Promise<T> {
	const id = nextId++;
	const res = await fetch(UBUS_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method: 'call',
			params: [sessionId, object, method, params]
		})
	});

	const json = await res.json();

	for (const fn of interceptors) {
		try {
			fn(json);
		} catch {
			/* */
		}
	}

	if (json.error) throw new UbusError(UBUS_STATUS.UNKNOWN, JSON.stringify(json.error));
	if (json.result) {
		const [code, data] = json.result;
		if (code !== 0) throw new UbusError(code as UbusStatusCode);
		return (data ?? {}) as T;
	}
	return {} as T;
}

/** Apply the `expect` filter: select a subkey and provide defaults */
function applyExpect(
	data: unknown,
	expect?: Record<string, unknown>
): unknown {
	if (!expect || !data || typeof data !== 'object') return data;

	for (const [key, defaultValue] of Object.entries(expect)) {
		if (key === '') return data ?? defaultValue;
		const obj = data as Record<string, unknown>;
		return obj[key] ?? defaultValue;
	}
	return data;
}

// --- Auth ---

export interface LoginResult {
	ubus_rpc_session: string;
	timeout: number;
	expires: number;
	acls: Record<string, unknown>;
	data: { username: string };
}

export async function login(username: string, password: string): Promise<LoginResult> {
	// Login always uses null session, and must NOT be batched
	const id = nextId++;
	const res = await fetch(UBUS_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id,
			method: 'call',
			params: [NULL_SESSION, 'session', 'login', { username, password }]
		})
	});

	const json = await res.json();
	if (json.result) {
		const [code, data] = json.result;
		if (code !== 0) throw new UbusError(code as UbusStatusCode, 'Login failed');
		const result = data as LoginResult;
		setSessionId(result.ubus_rpc_session);
		return result;
	}
	throw new UbusError(UBUS_STATUS.UNKNOWN, 'Invalid login response');
}

export async function logout(): Promise<void> {
	try {
		await call('session', 'destroy', {});
	} finally {
		clearSession();
	}
}
