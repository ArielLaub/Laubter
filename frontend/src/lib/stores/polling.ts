/**
 * Centralized poll manager.
 * Manages periodic data fetching with configurable intervals.
 * Only polls when the page is visible (respects Page Visibility API).
 */

type PollFn = () => Promise<void>;

interface PollEntry {
	fn: PollFn;
	interval: number;
	timerId: ReturnType<typeof setInterval> | null;
	lastRun: number;
}

const polls = new Map<string, PollEntry>();
let visible = true;

if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', () => {
		visible = !document.hidden;
		if (visible) {
			// Resume all polls and run immediately
			for (const entry of polls.values()) {
				startPoll(entry);
			}
		} else {
			// Pause all polls
			for (const entry of polls.values()) {
				stopPoll(entry);
			}
		}
	});
}

function startPoll(entry: PollEntry): void {
	stopPoll(entry);
	// Run immediately if stale
	const now = Date.now();
	if (now - entry.lastRun >= entry.interval) {
		entry.fn().catch(console.error);
		entry.lastRun = now;
	}
	entry.timerId = setInterval(() => {
		entry.fn().catch(console.error);
		entry.lastRun = Date.now();
	}, entry.interval);
}

function stopPoll(entry: PollEntry): void {
	if (entry.timerId !== null) {
		clearInterval(entry.timerId);
		entry.timerId = null;
	}
}

/**
 * Register a poll function with an interval.
 * Automatically starts polling if the page is visible.
 */
export function register(name: string, fn: PollFn, intervalMs: number): void {
	// Unregister existing if present
	unregister(name);

	const entry: PollEntry = {
		fn,
		interval: intervalMs,
		timerId: null,
		lastRun: 0
	};
	polls.set(name, entry);

	if (visible) {
		startPoll(entry);
	}
}

export function unregister(name: string): void {
	const entry = polls.get(name);
	if (entry) {
		stopPoll(entry);
		polls.delete(name);
	}
}

export function unregisterAll(): void {
	for (const [name] of polls) {
		unregister(name);
	}
}
