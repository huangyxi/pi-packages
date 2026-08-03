import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { main } from '../../src/cli';

const original = { ...process.env };
let stdout: string[];
let stderr: string[];
let home: string;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'cli-'));
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = join(home, 'agent');
	stdout = [];
	stderr = [];
	vi.spyOn(console, 'log').mockImplementation((value) => {
		stdout.push(String(value));
	});
	vi.spyOn(console, 'error').mockImplementation((value) => {
		stderr.push(String(value));
	});
});
afterEach(() => {
	process.env = { ...original };
	vi.restoreAllMocks();
});
describe('CLI output and exits', () => {
	test('emits exactly one JSON envelope for list', async () => {
		await expect(main(['--json', 'list'])).resolves.toBe(0);
		expect(stdout).toHaveLength(1);
		expect(JSON.parse(stdout[0]!)).toMatchObject({ schemaVersion: 1, ok: true, command: 'list' });
		expect(stderr).toEqual([]);
	});
	test('reports unsupported strict utility with exit 3', async () => {
		await expect(main(['install', 'rg', '--json'])).resolves.toBe(3);
		expect(stdout).toHaveLength(1);
		expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
	});
	test('rejects invalid timeout before mutation', async () => {
		await expect(
			main([
				'install',
				'pnpm',
				'--timeout',
				'-1',
				'--json',
			]),
		).resolves.toBe(2);
		expect(stdout).toHaveLength(1);
		expect(JSON.parse(stdout[0]!)).toMatchObject({ ok: false, error: { code: 'usage' } });
		expect(stderr).toEqual([]);
	});
	test('returns ordered mutation result records', async () => {
		await expect(main(['uninstall', 'pnpm', '--json'])).resolves.toBe(0);
		expect(JSON.parse(stdout[0]!)).toMatchObject({
			ok: true,
			command: 'uninstall',
			data: { removed: [], results: [] },
		});
	});
	test('does not parse hidden run arguments after delimiter', async () => {
		await expect(
			main([
				'run',
				'unknown',
				'--',
				'--json',
			]),
		).resolves.toBe(2);
		expect(stderr[0]).toContain('unknown managed command');
	});
	test('falls back to a healthy system command and diagnoses degraded managed state', async () => {
		const toolkit = join(home, 'agent/toolchain');
		const final = join(toolkit, 'installations/pnpm');
		const managed = join(final, 'bin/pnpm');
		const systemDirectory = join(home, 'system');
		const marker = join(home, 'selected');
		await mkdir(join(toolkit, 'state'), { recursive: true });
		await mkdir(join(final, 'bin'), { recursive: true });
		await mkdir(systemDirectory);
		await writeFile(managed, '#!/bin/sh\nexit 1\n');
		await chmod(managed, 0o755);
		await writeFile(join(systemDirectory, 'pnpm'), `#!/bin/sh\necho system >> ${marker}\nexit 0\n`);
		await chmod(join(systemDirectory, 'pnpm'), 0o755);
		await writeFile(
			join(toolkit, 'state/pnpm.json'),
			JSON.stringify({
				schemaVersion: 1,
				toolchainId: 'pnpm',
				definitionVersion: 1,
				status: 'installed',
				platform: { platform: process.platform, architecture: process.arch },
				installedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				components: [],
				dependencies: [],
				commands: [{ name: 'pnpm', executable: managed }],
				shimCommands: ['pnpm'],
				ownedPaths: [final],
				sources: [],
				installerKind: 'npm-prefix',
			}),
		);
		process.env.PATH = `${systemDirectory}:${original.PATH ?? ''}`;
		await expect(main(['run', 'pnpm', '--'])).resolves.toBe(0);
		expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(['system', 'system']);
		expect(stderr.some((line) => line.includes('repair: pi-toolchain reinstall pnpm'))).toBe(true);
	});
});
