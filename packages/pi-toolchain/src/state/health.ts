import { lstat } from 'node:fs/promises';
import type { InstallationManifest } from '../catalog/types';

export interface Health {
	state: 'missing' | 'healthy' | 'degraded';
	reason?: string;
}
export async function manifestHealth(manifest?: InstallationManifest): Promise<Health> {
	if (!manifest) return { state: 'missing' };
	if (manifest.status === 'degraded') return { state: 'degraded', reason: 'manifest records degraded state' };
	for (const path of manifest.ownedPaths) {
		try {
			await lstat(path);
		} catch {
			return { state: 'degraded', reason: `owned path is missing: ${path}` };
		}
	}
	return { state: 'healthy' };
}
