import { delimiter, join } from 'node:path';
import type { InstallResult, InstallationManifest, InstallerStrategy, LifecycleContext, ProbeResult } from './types';
import { runProcess } from '../installation/process';

export function strictCargoBinstallArguments(root: string, crate: string, requestedVersion?: string): string[] {
	return [
		'binstall',
		'--no-confirm',
		'--disable-telemetry',
		'--strategies',
		'crate-meta-data',
		'--root',
		root,
		requestedVersion ? `${crate}@${requestedVersion}` : crate,
	];
}
async function installUtility(
	context: LifecycleContext,
	crate: string,
	command: string,
	requestedVersion?: string,
): Promise<InstallResult> {
	const rust = join(context.layout.toolkitDirectory, 'installations', 'rust');
	const cargoHome = join(rust, 'cargo');
	const cargoBin = join(cargoHome, 'bin');
	const environment = {
		...context.environment,
		CARGO_HOME: cargoHome,
		RUSTUP_HOME: join(rust, 'rustup'),
		PATH: `${cargoBin}${delimiter}${context.environment.PATH ?? ''}`,
	};
	const args = strictCargoBinstallArguments(context.layout.installationDirectory, crate, requestedVersion);
	const result = await runProcess(join(cargoBin, 'cargo'), args, {
		signal: context.signal,
		environment,
		timeoutMs: 20 * 60_000,
	});
	if (result.code !== 0) throw new Error(result.stderr || `strict cargo binstall failed for ${crate}`);
	const executable = join(context.layout.installationDirectory, 'bin', command);
	const versionResult = await runProcess(executable, ['--version'], {
		signal: context.signal,
		environment,
		timeoutMs: 15_000,
	});
	if (versionResult.code !== 0) throw new Error(versionResult.stderr || `${command} probe failed`);
	const output = versionResult.stdout.trim();
	const resolvedVersion = output.split(/\s+/)[1] ?? output;
	return {
		resolvedVersion,
		components: [{ name: command, version: output }],
		commands: [{ name: command, executable }],
		ownedPaths: [context.layout.installationDirectory],
		sources: [{ url: `https://crates.io/crates/${crate}`, authenticated: false }],
	};
}
export function cargoUtilityStrategy(crate: string, command: string): InstallerStrategy {
	return {
		kind: 'strict-cargo-binstall-crate-metadata',
		install: (context) => installUtility(context, crate, command),
		reinstall: (context, current: InstallationManifest) =>
			installUtility(context, crate, command, current.resolvedVersion),
		upgrade: (context) => installUtility(context, crate, command),
		async uninstall() {},
		async probe(context, current): Promise<ProbeResult> {
			if (!current) return { status: 'missing', reason: 'not installed' };
			const owned = current.commands.find((entry) => entry.name === command);
			if (!owned) return { status: 'degraded', reason: `${command} is absent from manifest` };
			try {
				const result = await runProcess(owned.executable, ['--version'], {
					signal: context.signal,
					environment: context.environment,
					timeoutMs: 15_000,
				});
				return result.code === 0
					? { status: 'healthy', components: [{ name: command, version: result.stdout.trim() }] }
					: { status: 'degraded', reason: result.stderr || `${command} probe failed` };
			} catch (error) {
				return {
					status: 'degraded',
					reason: error instanceof Error ? error.message : `${command} probe failed`,
				};
			}
		},
	};
}
