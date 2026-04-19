import { writable, derived } from 'svelte/store';
import { call } from '$api/ubus';

export interface Feature {
	id: string;
	label: string;
	description: string;
	packages: string;
	enabled: boolean;
}

export const features = writable<Feature[]>([]);

export const enabledFeatures = derived(features, ($f) =>
	new Set($f.filter((f) => f.enabled).map((f) => f.id))
);

export async function fetchFeatures(): Promise<void> {
	try {
		const res = await call<{ features: Feature[] }>('laubter-update', 'get_features', {});
		features.set(res.features ?? []);
	} catch {
		// Plugin may not be installed yet — treat all as disabled
		features.set([]);
	}
}

export async function enableFeature(id: string): Promise<string | null> {
	try {
		const res = await call<{ success: boolean; error?: string }>(
			'laubter-update', 'enable_feature', { id }
		);
		if (res.success) {
			await fetchFeatures();
			return null;
		}
		return res.error ?? 'Failed to enable feature';
	} catch (e) {
		return e instanceof Error ? e.message : 'Failed to enable feature';
	}
}

export async function disableFeature(id: string): Promise<string | null> {
	try {
		const res = await call<{ success: boolean; error?: string }>(
			'laubter-update', 'disable_feature', { id }
		);
		if (res.success) {
			await fetchFeatures();
			return null;
		}
		return res.error ?? 'Failed to disable feature';
	} catch (e) {
		return e instanceof Error ? e.message : 'Failed to disable feature';
	}
}
