import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { __test__ } from '../src/install-shim';

const packageRoot = join(import.meta.dirname, '..');
const { installShim, readShimSource, resolveAgentBinDir } = __test__;

const execFileAsync = promisify(execFile);

function resolveOpenspecEntry(): string | undefined {
	try {
		return createRequire(import.meta.url).resolve('@fission-ai/openspec');
	} catch {
		return undefined;
	}
}

const openspecEntry = resolveOpenspecEntry();

const paths: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	paths.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// The installer copies the built wrap script; build it if this run starts from a clean tree.
beforeAll(async () => {
	if (!existsSync(join(packageRoot, 'dist', 'openspecShim.js'))) {
		await execFileAsync('npm', ['run', 'build'], { cwd: packageRoot });
	}
});

describe('agent bin dir', () => {
	it('resolves from PI_CODING_AGENT_DIR with tilde expansion', () => {
		expect(resolveAgentBinDir({ PI_CODING_AGENT_DIR: '~/custom-agent' })).toBe(
			join(homedir(), 'custom-agent', 'bin'),
		);
		expect(resolveAgentBinDir({ PI_CODING_AGENT_DIR: '/abs/agent' })).toBe('/abs/agent/bin');
		expect(resolveAgentBinDir({})).toBe(join(homedir(), '.pi', 'agent', 'bin'));
	});
});

describe('shim source', () => {
	it('is a node script carrying the managed marker and no machine-specific paths', () => {
		const source = readShimSource();
		expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
		expect(source).toContain('// @pi-openspec-shim v1 — managed by @hyxi/pi-openspec; do not edit.');
		expect(source).not.toContain(homedir());
	});
});

describe('installShim', () => {
	it('installs an executable wrap script', async () => {
		const binDir = await tempDir('pi-openspec-bin-');
		const result = await installShim({ binDir });

		expect(result).toEqual({ path: join(binDir, 'openspec'), status: 'installed' });
		expect(await readFile(join(binDir, 'openspec'), 'utf8')).toBe(readShimSource());
		const { mode } = await stat(join(binDir, 'openspec'));
		expect(mode & 0o111).not.toBe(0);
	});

	it('is idempotent and refreshes a stale managed shim', async () => {
		const binDir = await tempDir('pi-openspec-bin-');
		const shimPath = join(binDir, 'openspec');
		await installShim({ binDir });
		const first = await stat(shimPath);

		await expect(installShim({ binDir })).resolves.toMatchObject({ status: 'current' });
		expect((await stat(shimPath)).mtimeMs).toBe(first.mtimeMs);

		await writeFile(
			shimPath,
			'#!/usr/bin/env node\n// @pi-openspec-shim v1 — managed by @hyxi/pi-openspec; do not edit.\n// stale content\n',
		);
		await expect(installShim({ binDir })).resolves.toMatchObject({ status: 'updated' });
		expect(await readFile(shimPath, 'utf8')).toBe(readShimSource());
	});

	it('leaves a user-managed file in place', async () => {
		const binDir = await tempDir('pi-openspec-bin-');
		const shimPath = join(binDir, 'openspec');
		const userScript = '#!/usr/bin/env node\nconsole.log("user managed");\n';
		await writeFile(shimPath, userScript);

		const result = await installShim({ binDir });
		expect(result.status).toBe('skipped-user-managed');
		expect(await readFile(shimPath, 'utf8')).toBe(userScript);
	});
});

describe.skipIf(openspecEntry === undefined)('openspec via the wrap script', () => {
	it('runs the bundled CLI through the installed shim', async () => {
		const root = await tempDir('pi-openspec-bin-');
		const binDir = join(root, 'agent', 'bin');
		await mkdir(binDir, { recursive: true });
		await installShim({ binDir });

		const { stdout } = await execFileAsync(join(binDir, 'openspec'), ['--version'], {
			env: { ...process.env, NODE_PATH: '', PI_CODING_AGENT_DIR: join(root, 'agent') },
		});
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('exits 127 when no bundled CLI is reachable', async () => {
		const root = await tempDir('pi-openspec-isolated-');
		const binDir = join(root, 'agent', 'bin');
		const emptyCwd = join(root, 'cwd');
		await mkdir(binDir, { recursive: true });
		await mkdir(emptyCwd, { recursive: true });
		await installShim({ binDir });

		const error = await execFileAsync(join(binDir, 'openspec'), ['--version'], {
			cwd: emptyCwd,
			env: {
				...process.env,
				NODE_PATH: '',
				PI_CODING_AGENT_DIR: join(root, 'agent'),
				PREFIX: join(root, 'global'),
			},
		}).catch((failure: unknown) => failure);
		expect(error).toMatchObject({ code: 127 });
		expect((error as { stderr: Buffer }).stderr.toString()).toContain('not found');
	});

	it('resolves a local-path install recorded in pi settings', async () => {
		if (openspecEntry === undefined) throw new Error('OpenSpec is not installed');
		const root = await tempDir('pi-openspec-settings-');
		const binDir = join(root, 'agent', 'bin');
		const emptyCwd = join(root, 'cwd');
		const localPkg = join(root, 'local-pkg');
		const localOpenspec = join(localPkg, 'node_modules', '@fission-ai', 'openspec');
		await mkdir(binDir, { recursive: true });
		await mkdir(emptyCwd, { recursive: true });
		await mkdir(dirname(localOpenspec), { recursive: true });
		await symlink(dirname(dirname(openspecEntry)), localOpenspec);
		await writeFile(join(localPkg, 'package.json'), JSON.stringify({ name: '@hyxi/pi-openspec' }));
		// A relative entry, like the ones pi records for local-path installs.
		await writeFile(join(root, 'agent', 'settings.json'), JSON.stringify({ packages: ['../local-pkg'] }));
		await installShim({ binDir });

		const { stdout } = await execFileAsync(join(binDir, 'openspec'), ['--version'], {
			cwd: emptyCwd,
			env: {
				...process.env,
				NODE_PATH: '',
				PI_CODING_AGENT_DIR: join(root, 'agent'),
				PREFIX: join(root, 'global'),
			},
		});
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('falls back to npm default global install root', async () => {
		if (openspecEntry === undefined) throw new Error('OpenSpec is not installed');
		const root = await tempDir('pi-openspec-global-');
		const binDir = join(root, 'agent', 'bin');
		const emptyCwd = join(root, 'cwd');
		const globalRoot = join(root, 'global');
		const globalPkg = join(globalRoot, 'lib', 'node_modules', '@fission-ai', 'openspec');
		await mkdir(binDir, { recursive: true });
		await mkdir(emptyCwd, { recursive: true });
		await mkdir(dirname(globalPkg), { recursive: true });
		await symlink(dirname(dirname(openspecEntry)), globalPkg);
		await installShim({ binDir });

		const { stdout } = await execFileAsync(join(binDir, 'openspec'), ['--version'], {
			cwd: emptyCwd,
			env: { ...process.env, NODE_PATH: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PREFIX: globalRoot },
		});
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
