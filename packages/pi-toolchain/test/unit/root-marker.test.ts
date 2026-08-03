import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ensureToolkitRoot } from '../../src/state/root-marker';

const platform = { platform: process.platform, architecture: process.arch };
describe('toolkit root ownership', () => {
	test('marks an empty directory', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'root-'));
		const root = join(parent, 'toolkit');
		await ensureToolkitRoot(root, [], platform);
		expect(JSON.parse(await readFile(join(root, '.pi-toolchain-root.json'), 'utf8')).creator).toBe(
			'@hyxi/pi-toolchain',
		);
	});
	test('rejects nonempty unmarked and symlink roots', async () => {
		const parent = await mkdtemp(join(tmpdir(), 'root-'));
		const root = join(parent, 'toolkit');
		await mkdir(root);
		await writeFile(join(root, 'foreign'), 'x');
		await expect(ensureToolkitRoot(root, [], platform)).rejects.toThrow('unmarked');
		const link = join(parent, 'link');
		await symlink(root, link);
		await expect(ensureToolkitRoot(link, [], platform)).rejects.toThrow('real directory');
	});
});
