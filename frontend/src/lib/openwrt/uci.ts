/**
 * UCI data layer — ported from LuCI.uci.
 *
 * 3-phase commit model:
 *   1. load()  → fetch configs from ubus, cache locally
 *   2. set()   → modify local cache, track deltas
 *   3. save()  → submit deltas to rpcd staging
 *   4. apply() → commit with rollback timer
 *   5. confirm() → cancel rollback (user can still reach UI)
 */

import { call } from '$api/ubus';
import type { UciSection } from '$api/types';

// --- Types ---

export type ChangeOp = 'add' | 'set' | 'remove' | 'order' | 'list-add' | 'list-del' | 'rename';
export type ChangeRecord = [ChangeOp, string, string?, unknown?];

interface SectionData extends Record<string, unknown> {
	'.anonymous': boolean;
	'.type': string;
	'.name': string;
	'.index': number;
}

// --- State ---

/** Local config cache: config name → section name → section data */
const cache = new Map<string, Map<string, SectionData>>();

/** Pending local deltas per config */
const deltas = new Map<string, ChangeRecord[]>();

/** Set of loaded config names */
const loaded = new Set<string>();

/** Counter for generating temporary section IDs */
let newSectionCounter = 0;

// --- Loading ---

export async function load(configs: string | string[]): Promise<void> {
	const names = Array.isArray(configs) ? configs : [configs];
	const toLoad = names.filter((n) => !loaded.has(n));
	if (toLoad.length === 0) return;

	// Batch all config loads (they'll be auto-batched by ubus.ts)
	const results = await Promise.all(
		toLoad.map((config) =>
			call<{ values: Record<string, Record<string, unknown>> }>('uci', 'get', { config })
		)
	);

	for (let i = 0; i < toLoad.length; i++) {
		const config = toLoad[i];
		const data = results[i]?.values ?? {};
		const sections = new Map<string, SectionData>();

		let index = 0;
		for (const [name, values] of Object.entries(data)) {
			if (typeof values !== 'object' || values === null) continue;
			sections.set(name, {
				...values,
				'.anonymous': (values as Record<string, unknown>)['.anonymous'] as boolean ?? false,
				'.type': (values as Record<string, unknown>)['.type'] as string ?? '',
				'.name': name,
				'.index': index++
			});
		}

		cache.set(config, sections);
		loaded.add(config);
	}
}

export function unload(configs: string | string[]): void {
	const names = Array.isArray(configs) ? configs : [configs];
	for (const name of names) {
		cache.delete(name);
		deltas.delete(name);
		loaded.delete(name);
	}
}

// --- Reading (synchronous from cache) ---

export function get(config: string, section: string): SectionData | undefined;
export function get(config: string, section: string, option: string): unknown;
export function get(config: string, section: string, option?: string): unknown {
	const sections = cache.get(config);
	if (!sections) return undefined;

	const sec = sections.get(section);
	if (!sec) return undefined;
	if (option === undefined) return sec;
	return sec[option];
}

export function getFirst(config: string, type: string, option?: string): unknown {
	const sections = cache.get(config);
	if (!sections) return undefined;

	for (const sec of sections.values()) {
		if (sec['.type'] === type) {
			return option ? sec[option] : sec;
		}
	}
	return undefined;
}

export function sections(config: string, type?: string): SectionData[] {
	const sectionsMap = cache.get(config);
	if (!sectionsMap) return [];

	const result = Array.from(sectionsMap.values());
	const filtered = type ? result.filter((s) => s['.type'] === type) : result;
	return filtered.sort((a, b) => a['.index'] - b['.index']);
}

export function configs(): string[] {
	return Array.from(loaded);
}

// --- Writing (modifies local cache + tracks deltas) ---

function addDelta(config: string, record: ChangeRecord): void {
	let list = deltas.get(config);
	if (!list) {
		list = [];
		deltas.set(config, list);
	}
	list.push(record);
}

export function set(config: string, section: string, option: string, value: unknown): void;
export function set(
	config: string,
	section: string,
	values: Record<string, unknown>
): void;
export function set(
	config: string,
	section: string,
	optionOrValues: string | Record<string, unknown>,
	value?: unknown
): void {
	const sections = cache.get(config);
	if (!sections) return;

	const sec = sections.get(section);
	if (!sec) return;

	if (typeof optionOrValues === 'string') {
		const option = optionOrValues;
		if (value === undefined || value === null) {
			delete sec[option];
			addDelta(config, ['remove', section, option]);
		} else {
			sec[option] = value;
			addDelta(config, ['set', section, option, value]);
		}
	} else {
		for (const [key, val] of Object.entries(optionOrValues)) {
			if (val === undefined || val === null) {
				delete sec[key];
				addDelta(config, ['remove', section, key]);
			} else {
				sec[key] = val;
				addDelta(config, ['set', section, key, val]);
			}
		}
	}
}

export function add(config: string, type: string, name?: string): string {
	const sections = cache.get(config);
	if (!sections) throw new Error(`Config ${config} not loaded`);

	const sid = name ?? `new${++newSectionCounter}`;
	const maxIndex = Math.max(0, ...Array.from(sections.values()).map((s) => s['.index']));

	sections.set(sid, {
		'.anonymous': !name,
		'.type': type,
		'.name': sid,
		'.index': maxIndex + 1
	});

	addDelta(config, ['add', sid, type]);
	return sid;
}

export function remove(config: string, section: string): void {
	const sections = cache.get(config);
	if (!sections) return;

	sections.delete(section);
	addDelta(config, ['remove', section]);
}

// --- Saving & Applying ---

export function hasChanges(config?: string): boolean {
	if (config) return (deltas.get(config)?.length ?? 0) > 0;
	for (const list of deltas.values()) {
		if (list.length > 0) return true;
	}
	return false;
}

export function getChanges(): Map<string, ChangeRecord[]> {
	return new Map(deltas);
}

export function revert(config: string): void {
	deltas.delete(config);
	// Reload from router to reset cache
	loaded.delete(config);
	cache.delete(config);
}

export async function save(): Promise<void> {
	// Track temporary section ID → real server-assigned ID
	const sectionIdMap = new Map<string, string>();

	for (const [config, records] of deltas) {
		for (const record of records) {
			const [op, section, param, value] = record;
			// Resolve temp IDs to real server IDs
			const resolvedSection = sectionIdMap.get(section) || section;

			switch (op) {
				case 'add': {
					const result = await call<{ section: string }>('uci', 'add', { config, type: param });
					// Map the temp ID to the real server-assigned ID
					if (result?.section) {
						sectionIdMap.set(section, result.section);
					}
					break;
				}
				case 'set':
					await call('uci', 'set', {
						config,
						section: resolvedSection,
						values: { [param!]: value }
					});
					break;
				case 'remove':
					if (param) {
						await call('uci', 'delete', { config, section: resolvedSection, option: param });
					} else {
						await call('uci', 'delete', { config, section: resolvedSection });
					}
					break;
				case 'order':
					await call('uci', 'order', { config, sections: value });
					break;
				case 'list-add':
					await call('uci', 'set', {
						config,
						section: resolvedSection,
						values: { [param!]: value }
					});
					break;
				case 'list-del':
					await call('uci', 'delete', {
						config,
						section: resolvedSection,
						option: param
					});
					break;
				case 'rename':
					await call('uci', 'rename', { config, section, name: value });
					break;
			}
		}
	}

	// Commit all modified configs
	const modifiedConfigs = new Set(deltas.keys());
	deltas.clear();

	for (const config of modifiedConfigs) {
		await call('uci', 'commit', { config });
	}

	// Reload configs to resync cache
	const configNames = Array.from(loaded);
	loaded.clear();
	cache.clear();
	await load(configNames);
}

/**
 * Apply changes with rollback protection.
 * If confirm() is not called within `timeout` seconds, changes auto-revert.
 */
export async function apply(timeout = 30): Promise<void> {
	await call('uci', 'apply', { timeout, rollback: true });
}

/** Confirm applied changes (cancels rollback timer). */
export async function confirm(): Promise<void> {
	await call('uci', 'confirm', {});
}

/** Revert applied-but-unconfirmed changes on the server side. */
export async function rollback(): Promise<void> {
	await call('uci', 'revert', {});
}

/**
 * Full save + apply workflow with automatic confirmation.
 * Shows the countdown UI for the user to confirm connectivity.
 */
export async function saveAndApply(timeout = 30): Promise<void> {
	await save();
	await apply(timeout);
}
