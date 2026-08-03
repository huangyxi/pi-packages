import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { discoverPackageDirectory } from '../../src/routing/package-discovery';

async function packageAt(path: string, name = '@hyxi/pi-toolchain'): Promise<void> {
	await mkdir(join(path, 'dist'), { recursive: true });
	await writeFile(join(path, 'package.json'), JSON.stringify({ name }));
	await writeFile(join(path, 'dist/cli.js'), '');
}
describe('package discovery', () => {
	test('uses valid candidates in exact priority order', async () => {
		const root = await mkdtemp(join(tmpdir(), 'discovery-'));
		const override = join(root, 'override');
		const global = join(root, 'agent/npm/node_modules/@hyxi/pi-toolchain');
		await packageAt(override);
		await packageAt(global);
		await expect(
			discoverPackageDirectory({
				environment: { PI_TOOLCHAIN_PACKAGE_DIR: override },
				agentDirectory: join(root, 'agent'),
				physicalCwd: root,
			}),
		).resolves.toBe(override);
	});
	test('skips invalid nonempty override and does not walk ancestors', async () => {
		const root = await mkdtemp(join(tmpdir(), 'discovery-'));
		const project = join(root, 'project');
		const exact = join(project, '.pi/npm/node_modules/@hyxi/pi-toolchain');
		await packageAt(join(root, '.pi/npm/node_modules/@hyxi/pi-toolchain'));
		await packageAt(exact);
		await expect(
			discoverPackageDirectory({
				environment: { PI_TOOLCHAIN_PACKAGE_DIR: 'relative' },
				agentDirectory: join(root, 'agent'),
				physicalCwd: project,
			}),
		).resolves.toBe(exact);
		await expect(
			discoverPackageDirectory({
				environment: {},
				agentDirectory: join(root, 'agent'),
				physicalCwd: join(project, 'nested'),
			}),
		).resolves.toBeUndefined();
	});
	test('rejects a package-name mismatch', async () => {
		const root = await mkdtemp(join(tmpdir(), 'discovery-'));
		const candidate = join(root, 'candidate');
		await packageAt(candidate, 'foreign');
		await expect(
			discoverPackageDirectory({
				environment: { PI_TOOLCHAIN_PACKAGE_DIR: candidate },
				agentDirectory: join(root, 'agent'),
				physicalCwd: root,
			}),
		).resolves.toBeUndefined();
	});
});
