import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchJson } from './network';

interface GitHubAsset {
	name: string;
	browser_download_url: string;
	size?: number;
}
export interface GitHubRelease {
	tag: string;
	assets: GitHubAsset[];
}
export async function latestGitHubRelease(
	repository: string,
	signal: AbortSignal | undefined,
	environment: NodeJS.ProcessEnv,
): Promise<GitHubRelease> {
	const raw = await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`, {
		signal,
		environment,
		maxBytes: 2 * 1024 * 1024,
		allowedHosts: ['api.github.com'],
	});
	if (raw === null || typeof raw !== 'object') throw new Error('invalid GitHub release metadata');
	const value = raw as { tag_name?: unknown; assets?: unknown };
	if (typeof value.tag_name !== 'string' || !Array.isArray(value.assets))
		throw new Error('invalid GitHub release metadata');
	const assets = value.assets.flatMap((asset): GitHubAsset[] => {
		if (asset === null || typeof asset !== 'object') return [];
		const item = asset as { name?: unknown; browser_download_url?: unknown; size?: unknown };
		return typeof item.name === 'string' && typeof item.browser_download_url === 'string'
			? [
					{
						name: item.name,
						browser_download_url: item.browser_download_url,
						...(typeof item.size === 'number' ? { size: item.size } : {}),
					},
				]
			: [];
	});
	return { tag: value.tag_name.replace(/^v/, ''), assets };
}
export function exactAsset(release: GitHubRelease, name: string): GitHubAsset {
	const matches = release.assets.filter((asset) => asset.name === name);
	if (matches.length !== 1)
		throw new Error(`expected one release asset named ${name}, found ${String(matches.length)}`);
	return matches[0]!;
}
export function linuxTarget(): string {
	if (process.platform !== 'linux') throw new Error(`unsupported platform: ${process.platform}`);
	if (process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
	if (process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
	throw new Error(`unsupported architecture: ${process.arch}`);
}
export function portableLinuxTarget(): string {
	return linuxTarget().replace('-gnu', '-musl');
}
export async function findFile(root: string, name: string): Promise<string> {
	const matches: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory)) {
			const path = join(directory, entry);
			const info = await stat(path);
			if (info.isDirectory()) await visit(path);
			else if (entry === name) matches.push(path);
		}
	};
	await visit(root);
	if (matches.length !== 1) throw new Error(`expected one extracted ${name}, found ${String(matches.length)}`);
	return matches[0]!;
}
