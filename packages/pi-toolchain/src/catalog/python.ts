import { chmod, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallResult, InstallerStrategy, LifecycleContext, ProbeResult } from './types';
import { extractTar } from '../installation/archive';
import { download, fetchText } from '../installation/network';
import { runProcess } from '../installation/process';
import { exactAsset, findFile, latestGitHubRelease, linuxTarget } from '../installation/releases';

const githubHosts = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
export const uvAssetName = (target: string): string => `uv-${target}.tar.gz`;
async function probe(
	path: string,
	args: readonly string[],
	context: LifecycleContext,
): Promise<{ ok: boolean; version: string }> {
	try {
		const result = await runProcess(path, args, {
			signal: context.signal,
			environment: context.environment,
			timeoutMs: 15_000,
		});
		return { ok: result.code === 0, version: result.stdout.trim() || result.stderr.trim() };
	} catch {
		return { ok: false, version: '' };
	}
}

export const pythonStrategy: InstallerStrategy = {
	kind: 'uv-official-release',
	async install(context): Promise<InstallResult> {
		const target = linuxTarget();
		const release = await latestGitHubRelease('astral-sh/uv', context.signal, context.environment);
		const name = uvAssetName(target);
		const asset = exactAsset(release, name);
		const checksumAsset = exactAsset(release, `${name}.sha256`);
		const checksumText = await fetchText(checksumAsset.browser_download_url, {
			signal: context.signal,
			environment: context.environment,
			maxBytes: 4096,
			allowedHosts: githubHosts,
		});
		const checksum = checksumText.trim().split(/\s+/)[0];
		if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('invalid uv checksum metadata');
		const archive = join(context.layout.installationDirectory, 'uv.tar.gz');
		const audit = await download(asset.browser_download_url, archive, {
			signal: context.signal,
			environment: context.environment,
			maxBytes: 100 * 1024 * 1024,
			allowedHosts: githubHosts,
			expectedSha256: checksum,
		});
		const extracted = join(context.layout.installationDirectory, '.uv-extracted');
		await extractTar(archive, extracted, true);
		const bin = join(context.layout.installationDirectory, 'bin');
		await mkdir(bin, { recursive: true });
		for (const name of ['uv', 'uvx']) {
			const source = await findFile(extracted, name);
			await cp(source, join(bin, name));
			await chmod(join(bin, name), 0o755);
		}
		const environment = {
			...context.environment,
			UV_NO_MODIFY_PATH: '1',
			UV_PYTHON_INSTALL_DIR: join(context.layout.installationDirectory, 'python'),
			UV_PYTHON_BIN_DIR: bin,
			UV_CACHE_DIR: join(context.layout.installationDirectory, 'cache'),
			UV_TOOL_DIR: join(context.layout.installationDirectory, 'tools'),
			UV_TOOL_BIN_DIR: bin,
		};
		const install = await runProcess(join(bin, 'uv'), ['python', 'install', '--default'], {
			signal: context.signal,
			environment,
			timeoutMs: 20 * 60_000,
		});
		if (install.code !== 0) throw new Error(install.stderr || 'uv Python installation failed');
		const uv = await probe(join(bin, 'uv'), ['--version'], { ...context, environment });
		const python = await probe(join(bin, 'python3'), ['--version'], { ...context, environment });
		if (!uv.ok || !python.ok) throw new Error('uv or managed Python probe failed');
		const commands = [
			'uv',
			'uvx',
			'python',
			'python3',
		].map((name) => ({ name, executable: join(bin, name) }));
		return {
			resolvedVersion: release.tag,
			components: [
				{ name: 'uv', version: uv.version },
				{ name: 'python', version: python.version },
			],
			commands,
			ownedPaths: [context.layout.installationDirectory],
			sources: [audit],
		};
	},
	async reinstall(context) {
		return this.install(context);
	},
	async upgrade(context) {
		return this.install(context);
	},
	async uninstall() {},
	async probe(context, current): Promise<ProbeResult> {
		if (!current) return { status: 'missing', reason: 'not installed' };
		const uv = current.commands.find((entry) => entry.name === 'uv');
		const python = current.commands.find((entry) => entry.name === 'python3');
		if (!uv || !python) return { status: 'degraded', reason: 'managed command metadata is incomplete' };
		const uvProbe = await probe(uv.executable, ['--version'], context);
		const pythonProbe = await probe(python.executable, ['--version'], context);
		return uvProbe.ok && pythonProbe.ok
			? {
					status: 'healthy',
					components: [
						{ name: 'uv', version: uvProbe.version },
						{ name: 'python', version: pythonProbe.version },
					],
				}
			: { status: 'degraded', reason: 'managed uv or Python probe failed' };
	},
};
