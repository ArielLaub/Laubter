/**
 * Wireless provider registry.
 * Maps provider names to implementations.
 */

import type { WirelessProvider } from './types';
import { asusProvider } from './asus';
import { openwrtProvider } from './openwrt';

const providers: Record<string, WirelessProvider> = {
	asus: asusProvider,
	openwrt: openwrtProvider
};

export function getProvider(name: string): WirelessProvider {
	return providers[name] ?? openwrtProvider;
}

export function getProviderList(): { name: string; label: string }[] {
	return Object.values(providers).map((p) => ({ name: p.name, label: p.label }));
}

export { asusProvider, openwrtProvider };
