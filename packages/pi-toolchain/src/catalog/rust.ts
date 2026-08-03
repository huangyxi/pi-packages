import { chmod, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallResult, InstallerStrategy, LifecycleContext, ProbeResult } from './types';
import { extractTar } from '../installation/archive';
import { download, fetchText } from '../installation/network';
import { runProcess } from '../installation/process';
import { exactAsset, findFile, latestGitHubRelease, linuxTarget } from '../installation/releases';

const githubHosts = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
export const rustupArtifactUrl = (target: string): string =>
	`https://static.rust-lang.org/rustup/dist/${target}/rustup-init`;
export const cargoBinstallAssetName = (target: string): string => `cargo-binstall-${target}.tgz`;
async function version(path: string, context: LifecycleContext): Promise<string> {
	const result = await runProcess(path, ['--version'], {
		signal: context.signal,
		environment: context.environment,
		timeoutMs: 15_000,
	});
	if (result.code !== 0) throw new Error(result.stderr || `probe failed: ${path}`);
	return result.stdout.trim();
}
export const rustStrategy: InstallerStrategy = {
	kind: 'rustup-and-cargo-binstall-official',
	async install(context): Promise<InstallResult> {
		const target = linuxTarget();
		const base = rustupArtifactUrl(target);
		const checksumText = await fetchText(`${base}.sha256`, {
			signal: context.signal,
			environment: context.environment,
			maxBytes: 4096,
			allowedHosts: ['static.rust-lang.org'],
		});
		const checksum = checksumText.trim().split(/\s+/)[0];
		if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('invalid rustup checksum metadata');
		const bootstrap = join(context.layout.installationDirectory, 'rustup-init');
		const rustupAudit = await download(base, bootstrap, {
			signal: context.signal,
			environment: context.environment,
			maxBytes: 50 * 1024 * 1024,
			allowedHosts: ['static.rust-lang.org'],
			expectedSha256: checksum,
		});
		await chmod(bootstrap, 0o755);
		const cargoHome = join(context.layout.installationDirectory, 'cargo');
		const rustupHome = join(context.layout.installationDirectory, 'rustup');
		await mkdir(cargoHome, { recursive: true });
		const environment = {
			...context.environment,
			CARGO_HOME: cargoHome,
			RUSTUP_HOME: rustupHome,
			RUSTUP_INIT_SKIP_PATH_CHECK: 'yes',
		};
		const bootstrapResult = await runProcess(
			bootstrap,
			[
				'-y',
				'--no-modify-path',
				'--profile',
				'minimal',
				'--default-toolchain',
				'stable',
			],
			{ signal: context.signal, environment, timeoutMs: 20 * 60_000 },
		);
		if (bootstrapResult.code !== 0) throw new Error(bootstrapResult.stderr || 'rustup bootstrap failed');
		const cargoBin = join(cargoHome, 'bin');
		const ensure = await runProcess(
			join(cargoBin, 'rustup'),
			[
				'toolchain',
				'install',
				'stable',
				'--profile',
				'minimal',
			],
			{ signal: context.signal, environment, timeoutMs: 20 * 60_000 },
		);
		if (ensure.code !== 0) throw new Error(ensure.stderr || 'stable Rust installation failed');
		const release = await latestGitHubRelease('cargo-bins/cargo-binstall', context.signal, environment);
		const asset = exactAsset(release, cargoBinstallAssetName(target));
		const archive = join(context.layout.installationDirectory, 'cargo-binstall.tgz');
		const binstallAudit = await download(asset.browser_download_url, archive, {
			signal: context.signal,
			environment,
			maxBytes: 100 * 1024 * 1024,
			allowedHosts: githubHosts,
		});
		const extracted = join(context.layout.installationDirectory, '.binstall-extracted');
		await extractTar(archive, extracted, true);
		await cp(await findFile(extracted, 'cargo-binstall'), join(cargoBin, 'cargo-binstall'));
		await chmod(join(cargoBin, 'cargo-binstall'), 0o755);
		const names = [
			'rustup',
			'cargo',
			'rustc',
			'rustdoc',
			'cargo-binstall',
		];
		const components = await Promise.all(
			names.map(async (name) => ({
				name,
				version: await version(join(cargoBin, name), { ...context, environment }),
			})),
		);
		const resolvedVersion = components.find((entry) => entry.name === 'rustc')?.version;
		return {
			...(resolvedVersion ? { resolvedVersion } : {}),
			components,
			commands: names.map((name) => ({ name, executable: join(cargoBin, name) })),
			ownedPaths: [context.layout.installationDirectory],
			sources: [rustupAudit, binstallAudit],
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
		try {
			const components = await Promise.all(
				current.commands.map(async (command) => ({
					name: command.name,
					version: await version(command.executable, context),
				})),
			);
			return { status: 'healthy', components };
		} catch (error) {
			return { status: 'degraded', reason: error instanceof Error ? error.message : 'Rust probe failed' };
		}
	},
};
