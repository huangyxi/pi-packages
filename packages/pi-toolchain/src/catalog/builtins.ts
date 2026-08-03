import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../installation/process';
import { cargoUtilityStrategy } from './cargo-utility';
import { juliaStrategy } from './julia';
import { pythonStrategy } from './python';
import { rustStrategy } from './rust';
import type { InstallerStrategy, ToolchainDefinition } from './types';

const pnpmStrategy: InstallerStrategy = {
	kind: 'npm-prefix',
	async install(context) {
		context.report('installing pnpm from the official npm distribution');
		const result = await runProcess(
			'npm',
			[
				'install',
				'--ignore-scripts',
				'--no-audit',
				'--no-fund',
				'--prefix',
				context.layout.installationDirectory,
				'pnpm@latest',
			],
			{ environment: context.environment, signal: context.signal, timeoutMs: 20 * 60_000 },
		);
		if (result.code !== 0) throw new Error(result.stderr || 'npm failed');
		const commands = [];
		for (const name of ['pnpm', 'pnpx']) {
			const executable = join(context.layout.installationDirectory, 'node_modules', '.bin', name);
			try {
				await access(executable);
				commands.push({ name, executable });
			} catch {}
		}
		if (!commands.some((command) => command.name === 'pnpm')) throw new Error('pnpm executable was not installed');
		const probe = await runProcess(commands[0]!.executable, ['--version'], {
			environment: context.environment,
			signal: context.signal,
			timeoutMs: 15_000,
		});
		if (probe.code !== 0) throw new Error(probe.stderr || 'pnpm probe failed');
		const version = probe.stdout.trim();
		return {
			resolvedVersion: version,
			components: [{ name: 'pnpm', version }],
			commands,
			ownedPaths: [context.layout.installationDirectory],
			sources: [{ url: 'https://registry.npmjs.org/pnpm', authenticated: false }],
		};
	},
	async reinstall(context) {
		return this.install(context);
	},
	async upgrade(context) {
		return this.install(context);
	},
	async uninstall() {},
	async probe(context, current) {
		if (!current) return { status: 'missing', reason: 'not installed' };
		const command = current.commands.find((entry) => entry.name === 'pnpm');
		if (!command) return { status: 'degraded', reason: 'pnpm command is absent from manifest' };
		const result = await runProcess(command.executable, ['--version'], {
			environment: context.environment,
			signal: context.signal,
			timeoutMs: 15_000,
		});
		return result.code === 0
			? { status: 'healthy', components: [{ name: 'pnpm', version: result.stdout.trim() }] }
			: { status: 'degraded', reason: result.stderr || 'probe failed' };
	},
};

const command = (name: string, optional = false) => ({
	name,
	versionArgs: ['--version'] as const,
	optional,
	executableLocations: (layout: import('./types').ManagedLayout) => [
		join(layout.installationDirectory, 'bin', name),
		join(layout.installationDirectory, 'node_modules', '.bin', name),
	],
});
const linux = [{ platform: 'linux' as const, architectures: ['x64', 'arm64'] }];

export const builtins: readonly ToolchainDefinition[] = [
	{
		id: 'pnpm',
		definitionVersion: 1,
		displayName: 'pnpm',
		description: 'Fast Node package manager',
		commands: [command('pnpm'), command('pnpx', true)],
		dependencies: [],
		hostPrerequisites: ['node', 'npm'],
		officialInstallUrl: 'https://pnpm.io/installation',
		platforms: [...linux, { platform: 'darwin', architectures: ['x64', 'arm64'] }],
		installer: pnpmStrategy,
	},
	{
		id: 'python',
		definitionVersion: 1,
		displayName: 'Python via uv',
		description: 'uv and managed CPython',
		commands: [
			'uv',
			'uvx',
			'python',
			'python3',
		].map((name) => command(name)),
		dependencies: [],
		hostPrerequisites: [],
		officialInstallUrl: 'https://docs.astral.sh/uv/',
		platforms: linux,
		installer: pythonStrategy,
	},
	{
		id: 'rust',
		definitionVersion: 1,
		displayName: 'Rust',
		description: 'rustup, Rust and cargo-binstall',
		commands: [
			'rustup',
			'cargo',
			'rustc',
			'rustdoc',
			'cargo-binstall',
		].map((name) => command(name)),
		dependencies: [],
		hostPrerequisites: [],
		officialInstallUrl: 'https://rustup.rs/',
		platforms: linux,
		installer: rustStrategy,
	},
	{
		id: 'julia',
		definitionVersion: 1,
		displayName: 'Julia',
		description: 'Juliaup release channel',
		commands: ['julia', 'juliaup'].map((name) => command(name)),
		dependencies: [],
		hostPrerequisites: [],
		officialInstallUrl: 'https://julialang.org/install/',
		platforms: linux,
		installer: juliaStrategy,
	},
	...(
		[
			['ripgrep', 'rg', 'https://github.com/BurntSushi/ripgrep'],
			['fd-find', 'fd', 'https://github.com/sharkdp/fd'],
			['bat', 'bat', 'https://github.com/sharkdp/bat'],
			['just', 'just', 'https://github.com/casey/just'],
			['hyperfine', 'hyperfine', 'https://github.com/sharkdp/hyperfine'],
		] as const
	).map(([id, name, url]) => ({
		id,
		definitionVersion: 1,
		displayName: id,
		description: `${id} installed from official release metadata`,
		commands: [command(name)],
		dependencies: ['rust'],
		hostPrerequisites: [],
		officialInstallUrl: url,
		platforms: [],
		installer: cargoUtilityStrategy(id, name),
	})),
];
