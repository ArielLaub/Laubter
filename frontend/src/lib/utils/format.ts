/** Format byte counts to human-readable strings */
export function formatBytes(bytes: number, decimals = 1): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/** Format bytes/sec to human-readable throughput */
export function formatSpeed(bytesPerSec: number): string {
	if (bytesPerSec === 0) return '0 bps';
	const bits = bytesPerSec * 8;
	const k = 1000;
	const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
	const i = Math.floor(Math.log(bits) / Math.log(k));
	return parseFloat((bits / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Format uptime seconds to human-readable duration */
export function formatUptime(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const mins = Math.floor((seconds % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (mins > 0) parts.push(`${mins}m`);
	return parts.join(' ') || '0m';
}

/** Format relative time (e.g., "3m ago", "Just now") */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now() / 1000;
	const diff = now - timestamp;
	if (diff < 60) return 'Just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

/** Format load average from fixed-point to float */
export function formatLoad(loadFixed: number): string {
	return (loadFixed / 65536).toFixed(2);
}

/** Format percentage */
export function formatPercent(value: number, total: number): string {
	if (total === 0) return '0%';
	return Math.round((value / total) * 100) + '%';
}

/** Format MAC address with colons */
export function formatMac(mac: string): string {
	return mac.toLowerCase().replace(/[:-]/g, ':');
}

/** Format signal strength to quality percentage */
export function signalToQuality(signal: number): number {
	if (signal >= -50) return 100;
	if (signal <= -100) return 0;
	return Math.round(2 * (signal + 100));
}

/** Get signal strength label */
export function signalLabel(signal: number): string {
	const q = signalToQuality(signal);
	if (q >= 80) return 'Excellent';
	if (q >= 60) return 'Good';
	if (q >= 40) return 'Fair';
	if (q >= 20) return 'Weak';
	return 'Very Weak';
}

/** WiFi generation number to marketing name */
export function wifiGenerationName(gen?: number): string {
	switch (gen) {
		case 4: return 'Wi-Fi 4';
		case 5: return 'Wi-Fi 5';
		case 6: return 'Wi-Fi 6';
		case 7: return 'Wi-Fi 7';
		default: return '';
	}
}

/** Frequency to band label */
export function freqToBand(freqMhz: number): string {
	if (freqMhz < 3000) return '2.4 GHz';
	if (freqMhz < 6000) return '5 GHz';
	return '6 GHz';
}
