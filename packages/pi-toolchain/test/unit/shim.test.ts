import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { reconcileShims, recoverShims } from '../../src/routing/shim';

describe('canonical shim ownership', () => {
	test('creates one script and relative owned links', async () => {
		const agent = await mkdtemp(join(tmpdir(), 'shim-'));
		await reconcileShims(agent, ['rg']);
		expect((await lstat(join(agent, 'bin/rg'))).isSymbolicLink()).toBe(true);
		expect(await readFile(join(agent, 'bin/pi-toolchain'), 'utf8')).toContain('pwd -P');
		await reconcileShims(agent, ['rg', 'fd']);
	});
	test('does not adopt foreign entries', async () => {
		const agent = await mkdtemp(join(tmpdir(), 'shim-'));
		await reconcileShims(agent, []);
		await writeFile(join(agent, 'bin/rg'), 'foreign');
		await expect(reconcileShims(agent, ['rg'])).rejects.toThrow('foreign');
		expect(await readFile(join(agent, 'bin/rg'), 'utf8')).toBe('foreign');
	});
	test('completes a valid interrupted journal', async () => {
		const agent = await mkdtemp(join(tmpdir(), 'shim-'));
		await reconcileShims(agent, ['rg']);
		const bin = join(agent, 'bin');
		const prior = JSON.parse(await readFile(join(bin, '.pi-toolchain-shims.json'), 'utf8')) as {
			schemaVersion: 1;
			scriptHash: string;
			commands: string[];
		};
		await writeFile(
			join(bin, '.pi-toolchain-shims.journal.json'),
			JSON.stringify({
				schemaVersion: 1,
				prior,
				desired: { ...prior, commands: ['fd', 'rg'] },
				script: await readFile(join(bin, 'pi-toolchain'), 'utf8'),
				addedCommands: ['fd'],
				removedCommands: [],
			}),
		);
		await recoverShims(agent);
		expect((await lstat(join(bin, 'fd'))).isSymbolicLink()).toBe(true);
		expect(JSON.parse(await readFile(join(bin, '.pi-toolchain-shims.json'), 'utf8'))).toMatchObject({
			commands: ['fd', 'rg'],
		});
	});
	test('stops journal recovery at a foreign new entry', async () => {
		const agent = await mkdtemp(join(tmpdir(), 'shim-'));
		await reconcileShims(agent, []);
		const bin = join(agent, 'bin');
		const prior = JSON.parse(await readFile(join(bin, '.pi-toolchain-shims.json'), 'utf8')) as object;
		await writeFile(join(bin, 'rg'), 'foreign');
		await writeFile(
			join(bin, '.pi-toolchain-shims.journal.json'),
			JSON.stringify({
				schemaVersion: 1,
				prior,
				desired: { ...prior, commands: ['rg'] },
				script: await readFile(join(bin, 'pi-toolchain'), 'utf8'),
				addedCommands: ['rg'],
				removedCommands: [],
			}),
		);
		await expect(recoverShims(agent)).rejects.toThrow('foreign');
		expect(await readFile(join(bin, 'rg'), 'utf8')).toBe('foreign');
	});
	test('rejects traversal in requested commands and persisted journals', async () => {
		const agent = await mkdtemp(join(tmpdir(), 'shim-'));
		await expect(reconcileShims(agent, ['../escape'])).rejects.toThrow('invalid shim command');
		await reconcileShims(agent, []);
		const bin = join(agent, 'bin');
		const prior = JSON.parse(await readFile(join(bin, '.pi-toolchain-shims.json'), 'utf8')) as object;
		await writeFile(
			join(bin, '.pi-toolchain-shims.journal.json'),
			JSON.stringify({
				schemaVersion: 1,
				prior,
				desired: { ...prior, commands: ['../escape'] },
				script: await readFile(join(bin, 'pi-toolchain'), 'utf8'),
				addedCommands: ['../escape'],
				removedCommands: [],
			}),
		);
		await expect(recoverShims(agent)).rejects.toThrow('invalid shim transaction journal');
		await expect(lstat(join(agent, 'escape'))).rejects.toThrow();
	});
});
