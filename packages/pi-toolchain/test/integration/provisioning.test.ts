import { access, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Catalog } from '../../src/catalog/registry';
import type { InstallerStrategy, ToolchainDefinition } from '../../src/catalog/types';
import { Provisioner } from '../../src/provisioning/provisioner';

const installer: InstallerStrategy = {
	kind: 'dummy',
	async install(context) {
		const bin = join(context.layout.installationDirectory, 'bin');
		await mkdir(bin, { recursive: true });
		const executable = join(bin, 'dummy');
		await writeFile(executable, '#!/bin/sh\nexit 0\n');
		await chmod(executable, 0o755);
		return {
			resolvedVersion: '1',
			components: [{ name: 'dummy', version: '1' }],
			commands: [{ name: 'dummy', executable }],
			ownedPaths: [context.layout.installationDirectory],
			sources: [],
		};
	},
	async reinstall(context) {
		return this.install(context);
	},
	async upgrade(context) {
		return this.install(context);
	},
	async uninstall() {},
	async probe(_context, current) {
		return current
			? { status: 'healthy', components: current.components }
			: { status: 'missing', reason: 'missing' };
	},
};
const definition: ToolchainDefinition = {
	id: 'dummy',
	definitionVersion: 1,
	displayName: 'Dummy',
	description: 'fixture',
	commands: [
		{
			name: 'dummy',
			versionArgs: ['--version'],
			executableLocations: (layout) => [join(layout.installationDirectory, 'bin/dummy')],
		},
	],
	dependencies: [],
	hostPrerequisites: [],
	officialInstallUrl: 'https://example.test/',
	platforms: [{ platform: process.platform, architectures: [process.arch] }],
	installer,
};

const fixtureDefinition = (
	id: string,
	dependencies: readonly string[],
	onInstall: () => Promise<void>,
): ToolchainDefinition => {
	const strategy: InstallerStrategy = {
		kind: 'fixture',
		async install(context) {
			await onInstall();
			const bin = join(context.layout.installationDirectory, 'bin');
			await mkdir(bin, { recursive: true });
			const executable = join(bin, id);
			await writeFile(executable, '#!/bin/sh\nexit 0\n');
			await chmod(executable, 0o755);
			return {
				components: [{ name: id, version: '1' }],
				commands: [{ name: id, executable }],
				ownedPaths: [context.layout.installationDirectory],
				sources: [],
			};
		},
		reinstall(context) {
			return this.install(context);
		},
		upgrade(context) {
			return this.install(context);
		},
		async uninstall() {},
		async probe(_context, current) {
			return current
				? { status: 'healthy', components: current.components }
				: { status: 'missing', reason: 'missing' };
		},
	};
	return {
		id,
		definitionVersion: 1,
		displayName: id,
		description: 'fixture',
		commands: [
			{
				name: id,
				versionArgs: ['--version'],
				executableLocations: (layout) => [join(layout.installationDirectory, 'bin', id)],
			},
		],
		dependencies,
		hostPrerequisites: [],
		officialInstallUrl: 'https://example.test/',
		platforms: [{ platform: process.platform, architectures: [process.arch] }],
		installer: strategy,
	};
};

describe('provisioning lifecycle', () => {
	test('commits manifest then owned shim and removes both', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const service = new Provisioner({
			toolkitDirectory: join(root, 'toolkit'),
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog([definition]),
		});
		const manifest = await service.lifecycle('dummy', 'install');
		expect(manifest.commands[0]?.executable).toContain('/installations/dummy/');
		expect((await service.manifests()).map((entry) => entry.toolchainId)).toEqual(['dummy']);
		expect(await service.uninstall(['dummy'])).toEqual(['dummy']);
		expect(await service.manifests()).toEqual([]);
	});
	test('rolls back publication when an agent-bin entry is foreign', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const agentDirectory = join(root, 'agent');
		await mkdir(join(agentDirectory, 'bin'), { recursive: true });
		await writeFile(join(agentDirectory, 'bin/dummy'), 'foreign');
		const service = new Provisioner({
			toolkitDirectory: join(root, 'toolkit'),
			agentDirectory,
			catalog: new Catalog([definition]),
		});
		await expect(service.lifecycle('dummy', 'install')).rejects.toThrow('foreign');
		expect(await service.manifests()).toEqual([]);
	});
	test('preserves a healthy installation when upgrade staging fails', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const failing: ToolchainDefinition = {
			...definition,
			installer: {
				...installer,
				async upgrade() {
					throw new Error('staged upgrade failed');
				},
			},
		};
		const service = new Provisioner({
			toolkitDirectory: join(root, 'toolkit'),
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog([failing]),
		});
		const before = await service.lifecycle('dummy', 'install');
		await expect(service.lifecycle('dummy', 'upgrade')).rejects.toThrow('staged upgrade failed');
		const after = (await service.manifests())[0];
		expect(after?.updatedAt).toBe(before.updatedAt);
		expect(after?.commands[0]?.executable).toBe(before.commands[0]?.executable);
	});
	test('repairs a stale manifest when the final installation directory is missing', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const toolkitDirectory = join(root, 'toolkit');
		const service = new Provisioner({
			toolkitDirectory,
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog([definition]),
		});
		await service.lifecycle('dummy', 'install');
		await rm(join(toolkitDirectory, 'installations/dummy'), { recursive: true });
		await expect(service.lifecycle('dummy', 'reinstall')).resolves.toMatchObject({ toolchainId: 'dummy' });
		await expect(access(join(toolkitDirectory, 'installations/dummy/bin/dummy'))).resolves.toBeUndefined();
	});
	test('rejects a manifest that claims the toolkit root', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const toolkitDirectory = join(root, 'toolkit');
		const service = new Provisioner({
			toolkitDirectory,
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog([definition]),
		});
		await service.lifecycle('dummy', 'install');
		const path = join(toolkitDirectory, 'state/dummy.json');
		const manifest = JSON.parse(await readFile(path, 'utf8')) as { ownedPaths: string[] };
		manifest.ownedPaths = [toolkitDirectory];
		await writeFile(path, JSON.stringify(manifest));
		await expect(service.uninstall(['dummy'])).rejects.toThrow('outside the toolchain installation');
		await expect(access(toolkitDirectory)).resolves.toBeUndefined();
	});
	test('does not follow an owned installation path replaced by a symlink', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		const toolkitDirectory = join(root, 'toolkit');
		const service = new Provisioner({
			toolkitDirectory,
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog([definition]),
		});
		await service.lifecycle('dummy', 'install');
		const final = join(toolkitDirectory, 'installations/dummy');
		const outside = join(root, 'outside');
		await rm(final, { recursive: true });
		await mkdir(outside);
		await writeFile(join(outside, 'sentinel'), 'keep');
		await symlink(outside, final);
		await expect(service.uninstall(['dummy'])).rejects.toThrow('symlink-owned path');
		expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('keep');
	});
	test('schedules independent dependency branches concurrently and preserves result order', async () => {
		const root = await mkdtemp(join(tmpdir(), 'lifecycle-'));
		let active = 0;
		let maximum = 0;
		const delayed = async (): Promise<void> => {
			active++;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 60));
			active--;
		};
		const definitions = [
			fixtureDefinition('a', [], delayed),
			fixtureDefinition('b', [], delayed),
			fixtureDefinition('root', ['a', 'b'], async () => undefined),
		];
		const service = new Provisioner({
			toolkitDirectory: join(root, 'toolkit'),
			agentDirectory: join(root, 'agent'),
			catalog: new Catalog(definitions),
		});
		const results = await service.ensure(['root']);
		expect(maximum).toBe(2);
		expect(results.map((entry) => entry.toolchainId)).toEqual(['a', 'b', 'root']);
	});
});
