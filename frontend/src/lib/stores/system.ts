import { writable } from 'svelte/store';
import { declare } from '$api/ubus';
import type { SystemBoard, SystemInfo } from '$api/types';

const callSystemBoard = declare<SystemBoard>({ object: 'system', method: 'board' });
const callSystemInfo = declare<SystemInfo>({ object: 'system', method: 'info' });

export const systemBoard = writable<SystemBoard | null>(null);
export const systemInfo = writable<SystemInfo | null>(null);

export async function fetchSystemData(): Promise<void> {
	const [board, info] = await Promise.all([callSystemBoard(), callSystemInfo()]);
	systemBoard.set(board);
	systemInfo.set(info);
}
