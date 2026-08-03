import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { hostname } from 'node:os';
import { atomicWriteJson, readJson } from './json';
import type { PlatformIdentity } from '../catalog/types';

interface RootMarker {
	schemaVersion: 1;
	creator: '@hyxi/pi-toolchain';
	createdAt: string;
	hostname: string;
	platform: PlatformIdentity;
}
export async function ensureToolkitRoot(
	root: string,
	forbidden: readonly string[],
	platform: PlatformIdentity,
): Promise<void> {
	const target = resolve(root);
	if (target === parse(target).root || forbidden.map((entry) => resolve(entry)).includes(target))
		throw new Error(`refusing dangerous toolkit root: ${target}`);
	let exists = true;
	try {
		const stat = await lstat(target);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('toolkit root must be a real directory');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
		else throw error;
	}
	if (!exists) await mkdir(target, { recursive: true, mode: 0o700 });
	const markerPath = `${target}/.pi-toolchain-root.json`;
	const marker = await readJson(markerPath);
	if (marker === undefined) {
		const entries = (await readdir(target)).filter((entry) => entry !== '.pi-toolchain-root.json');
		if (entries.length > 0) throw new Error('refusing non-empty unmarked toolkit root');
		const value: RootMarker = {
			schemaVersion: 1,
			creator: '@hyxi/pi-toolchain',
			createdAt: new Date().toISOString(),
			hostname: hostname(),
			platform,
		};
		await atomicWriteJson(markerPath, value);
		return;
	}
	if (!isRootMarker(marker)) throw new Error('invalid toolkit root marker');
	if (
		marker.hostname !== hostname() ||
		marker.platform.platform !== platform.platform ||
		marker.platform.architecture !== platform.architecture
	)
		throw new Error('toolkit root belongs to another machine or platform');
	if ((await realpath(target)) === (await realpath(dirname(target))) && target === dirname(target))
		throw new Error('invalid toolkit root');
}
function isRootMarker(value: unknown): value is RootMarker {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Partial<RootMarker>;
	return (
		v.schemaVersion === 1 &&
		v.creator === '@hyxi/pi-toolchain' &&
		typeof v.createdAt === 'string' &&
		typeof v.hostname === 'string' &&
		v.platform !== undefined &&
		typeof v.platform.platform === 'string' &&
		typeof v.platform.architecture === 'string'
	);
}
