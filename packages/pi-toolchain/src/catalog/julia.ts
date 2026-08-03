import { chmod, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallResult, InstallerStrategy, LifecycleContext, ProbeResult } from './types';
import { extractTar } from '../installation/archive';
import { download } from '../installation/network';
import { runProcess } from '../installation/process';
import { exactAsset, findFile, latestGitHubRelease, portableLinuxTarget } from '../installation/releases';

const githubHosts = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
export const juliaupAssetName = (version: string, target: string): string =>
	`juliaup-${version}-${target}-portable.tar.gz`;
async function probe(path: string, context: LifecycleContext): Promise<string> {
	const result = await runProcess(path, ['--version'], {
		signal: context.signal,
		environment: context.environment,
		timeoutMs: 30_000,
	});
	if (result.code !== 0) throw new Error(result.stderr || `probe failed: ${path}`);
	return result.stdout.trim();
}
export const juliaStrategy: InstallerStrategy = {
	kind: 'juliaup-portable-official-release',
	async install(context): Promise<InstallResult> {
		const release = await latestGitHubRelease('JuliaLang/juliaup', context.signal, context.environment);
		const target = portableLinuxTarget();
		const asset = exactAsset(release, juliaupAssetName(release.tag, target));
		const archive = join(context.layout.installationDirectory, 'juliaup.tar.gz');
		const audit = await download(asset.browser_download_url, archive, {
			signal: context.signal,
			environment: context.environment,
			maxBytes: 100 * 1024 * 1024,
			allowedHosts: githubHosts,
		});
		const extracted = join(context.layout.installationDirectory, '.juliaup-extracted');
		await extractTar(archive, extracted, true);
		const bin = join(context.layout.installationDirectory, 'bin');
		await mkdir(bin, { recursive: true });
		await cp(await findFile(extracted, 'juliaup'), join(bin, 'juliaup'));
		await cp(await findFile(extracted, 'julialauncher'), join(bin, 'julia'));
		await chmod(join(bin, 'juliaup'), 0o755);
		await chmod(join(bin, 'julia'), 0o755);
		const environment = {
			...context.environment,
			JULIAUP_DEPOT_PATH: join(context.layout.installationDirectory, 'depot'),
		};
		for (const args of [
			['config', 'startupselfupdateinterval', '0'],
			['config', 'backgroundselfupdateinterval', '0'],
			['add', 'release'],
			['default', 'release'],
		]) {
			const result = await runProcess(join(bin, 'juliaup'), args, {
				signal: context.signal,
				environment,
				timeoutMs: 20 * 60_000,
			});
			if (result.code !== 0) throw new Error(result.stderr || `juliaup ${args.join(' ')} failed`);
		}
		const juliaupVersion = await probe(join(bin, 'juliaup'), { ...context, environment });
		const juliaVersion = await probe(join(bin, 'julia'), { ...context, environment });
		return {
			resolvedVersion: release.tag,
			components: [
				{ name: 'juliaup', version: juliaupVersion },
				{ name: 'julia', version: juliaVersion },
			],
			commands: [
				{ name: 'juliaup', executable: join(bin, 'juliaup') },
				{ name: 'julia', executable: join(bin, 'julia') },
			],
			ownedPaths: [context.layout.installationDirectory],
			sources: [audit],
		};
	},
	async reinstall(context) {
		return this.install(context);
	},
	async upgrade() {
		throw Object.assign(
			new Error(
				'Julia upgrade is unsupported because preserving user-added juliaup channels is not yet guaranteed',
			),
			{ code: 'unsupported' },
		);
	},
	async uninstall() {},
	async probe(context, current): Promise<ProbeResult> {
		if (!current) return { status: 'missing', reason: 'not installed' };
		try {
			const juliaup = current.commands.find((entry) => entry.name === 'juliaup');
			const julia = current.commands.find((entry) => entry.name === 'julia');
			if (!juliaup || !julia) throw new Error('Julia command metadata is incomplete');
			return {
				status: 'healthy',
				components: [
					{ name: 'juliaup', version: await probe(juliaup.executable, context) },
					{ name: 'julia', version: await probe(julia.executable, context) },
				],
			};
		} catch (error) {
			return { status: 'degraded', reason: error instanceof Error ? error.message : 'Julia probe failed' };
		}
	},
};
