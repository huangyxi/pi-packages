import { delimiter, join } from 'node:path';
import type { InstallationManifest } from '../catalog/types';

export function managedEnvironment(
	base: NodeJS.ProcessEnv,
	manifests: readonly InstallationManifest[],
	toolkitRoot: string,
): NodeJS.ProcessEnv {
	const bins = [join(toolkitRoot, 'bin')];
	for (const manifest of manifests)
		for (const command of manifest.commands) {
			const directory = command.executable.slice(0, command.executable.lastIndexOf('/'));
			if (!bins.includes(directory)) bins.push(directory);
		}
	return { ...base, PATH: [...bins, base.PATH ?? ''].join(delimiter), PI_TOOLCHAIN_ROOT: toolkitRoot };
}

function clearProxyPair(
	environment: NodeJS.ProcessEnv,
	key: 'http_proxy' | 'https_proxy' | 'no_proxy' | 'all_proxy',
): void {
	if (key === 'http_proxy') {
		delete environment.http_proxy;
		delete environment.HTTP_PROXY;
	} else if (key === 'https_proxy') {
		delete environment.https_proxy;
		delete environment.HTTPS_PROXY;
	} else if (key === 'no_proxy') {
		delete environment.no_proxy;
		delete environment.NO_PROXY;
	} else {
		delete environment.all_proxy;
		delete environment.ALL_PROXY;
	}
}

export function normalizeProxyEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const result = { ...base };
	for (const key of [
		'http_proxy',
		'https_proxy',
		'no_proxy',
		'all_proxy',
	] as const) {
		const upper = key.toUpperCase();
		const value = Object.hasOwn(base, key) ? base[key] : base[upper];
		if (value === undefined) continue;
		if (value === '') clearProxyPair(result, key);
		else {
			result[key] = value;
			result[upper] = value;
		}
	}
	return result;
}
