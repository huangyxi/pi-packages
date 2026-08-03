import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { managedEnvironment } from '../../src/installation/environment';
import { findSystemCommand } from '../../src/routing/executable-resolver';
import { dispatchExecutable } from '../../src/routing/run';

describe('routing and direct dispatch', () => {
	test('excludes real and symlink aliases of managed directories', async () => {
		const root = await mkdtemp(join(tmpdir(), 'resolve-'));
		const managed = join(root, 'managed');
		const alias = join(root, 'alias');
		const system = join(root, 'system');
		await mkdir(managed);
		await mkdir(system);
		await symlink(managed, alias);
		for (const directory of [managed, system]) {
			await writeFile(join(directory, 'rg'), '#!/bin/sh\nexit 0\n');
			await chmod(join(directory, 'rg'), 0o755);
		}
		await expect(findSystemCommand('rg', [alias, system].join(delimiter), [managed])).resolves.toBe(
			join(system, 'rg'),
		);
	});
	test('rejects directories as system commands', async () => {
		const root = await mkdtemp(join(tmpdir(), 'resolve-'));
		await mkdir(join(root, 'rg'));
		await expect(findSystemCommand('rg', root, [])).resolves.toBeUndefined();
	});
	test('dispatches one absolute executable with exact arguments', async () => {
		const root = await mkdtemp(join(tmpdir(), 'run-'));
		const script = join(root, 'tool.ts');
		const output = join(root, 'args.json');
		await writeFile(
			script,
			'#!/usr/bin/env node\nawait import("node:fs/promises").then(fs=>fs.writeFile(process.env.OUTPUT,JSON.stringify(process.argv.slice(2))));\n',
		);
		await chmod(script, 0o755);
		await expect(
			dispatchExecutable(script, ['--flag', 'a b', '$literal'], { ...process.env, OUTPUT: output }),
		).resolves.toBe(0);
		expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(['--flag', 'a b', '$literal']);
	});
	test('constructs deterministic managed dependency PATH', () => {
		const environment = managedEnvironment(
			{ PATH: '/system', KEEP: 'yes' },
			[
				{
					schemaVersion: 1,
					toolchainId: 'base',
					definitionVersion: 1,
					status: 'installed',
					platform: { platform: process.platform, architecture: process.arch },
					installedAt: '',
					updatedAt: '',
					components: [],
					dependencies: [],
					commands: [{ name: 'base', executable: '/toolkit/installations/base/bin/base' }],
					shimCommands: ['base'],
					ownedPaths: ['/toolkit/installations/base'],
					sources: [],
					installerKind: 'dummy',
				},
			],
			'/toolkit',
		);
		expect(environment.PATH?.split(delimiter).slice(0, 2)).toEqual([
			'/toolkit/bin',
			'/toolkit/installations/base/bin',
		]);
		expect(environment.KEEP).toBe('yes');
	});
});
