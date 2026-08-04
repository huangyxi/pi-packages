import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createConfigReader } from '@/src/utils/config';

import { ENVGUARD_CONFIG_SCHEMA } from '../src/config';

const paths: string[] = [];

async function fixture(): Promise<{ cwd: string; home: string; global: string; project: string }> {
	const root = await mkdtemp(join(tmpdir(), 'envguard-config-'));
	paths.push(root);
	const cwd = join(root, 'project');
	const home = join(root, 'home');
	const global = join(home, '.pi', 'agent', 'extensions', 'envguard.json');
	const project = join(cwd, '.pi', 'extensions', 'envguard.json');
	await mkdir(join(global, '..'), { recursive: true });
	await mkdir(join(project, '..'), { recursive: true });
	return { cwd, home, global, project };
}

afterEach(async () => {
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('envguard configuration', () => {
	it('composes ordered lists across scopes without deduplicating', async () => {
		const files = await fixture();
		await writeFile(
			files.global,
			JSON.stringify({
				'+protectedEnvironmentVariables': ['GLOBAL_PRE'],
				'protectedEnvironmentVariables+': ['DUP', 'GLOBAL_POST'],
			}),
		);
		await writeFile(
			files.project,
			JSON.stringify({
				'+protectedEnvironmentVariables': ['PROJECT_PRE'],
				'protectedEnvironmentVariables+': ['DUP', 'PROJECT_POST'],
			}),
		);
		const result = await createConfigReader(ENVGUARD_CONFIG_SCHEMA).read({
			cwd: files.cwd,
			trusted: true,
			home: files.home,
		});
		expect(result.valid).toBe(true);
		expect(result.config.protectedEnvironmentVariables).toEqual([
			'PROJECT_PRE',
			'GLOBAL_PRE',
			'*_TOKEN',
			'*_SECRET',
			'*_PASSWORD',
			'*_KEY',
			'DUP',
			'GLOBAL_POST',
			'DUP',
			'PROJECT_POST',
		]);
	});

	it('supports replacement and empty lists', async () => {
		const files = await fixture();
		await writeFile(files.global, '{"protectedEnvironmentVariables":[]}');
		const result = await createConfigReader(ENVGUARD_CONFIG_SCHEMA).read({
			cwd: files.cwd,
			trusted: false,
			home: files.home,
		});
		expect(result.config.protectedEnvironmentVariables).toEqual([]);
	});

	it('rejects conflicts, invalid entries, unknown fields, and grouped shapes transactionally', async () => {
		const files = await fixture();
		await writeFile(
			files.global,
			JSON.stringify({
				protectedEnvironmentVariables: ['VALID'],
				'protectedEnvironmentVariables+': ['!'],
				visiblePrefixLength: 7,
				visibleSuffixLength: 1,
				unknown: true,
			}),
		);
		const result = await createConfigReader(ENVGUARD_CONFIG_SCHEMA).read({
			cwd: files.cwd,
			trusted: false,
			home: files.home,
		});
		expect(result.valid).toBe(false);
		expect(result.config.protectedEnvironmentVariables).toEqual([
			'*_TOKEN',
			'*_SECRET',
			'*_PASSWORD',
			'*_KEY',
		]);
		expect(result.issues.join('\n')).toContain('unknown unknown');
		expect(result.issues.join('\n')).toContain('invalid protectedEnvironmentVariables');
		expect(result.issues.join('\n')).toContain('invalid visiblePrefixLength');
	});

	it('ignores project configuration when untrusted', async () => {
		const files = await fixture();
		await writeFile(files.project, '{invalid');
		const result = await createConfigReader(ENVGUARD_CONFIG_SCHEMA).read({
			cwd: files.cwd,
			trusted: false,
			home: files.home,
		});
		expect(result.valid).toBe(true);
	});

	it('replays cached issues and observes atomic replacement', async () => {
		const files = await fixture();
		await writeFile(files.global, '{invalid');
		const reader = createConfigReader(ENVGUARD_CONFIG_SCHEMA);
		const first: string[] = [];
		const second: string[] = [];
		await reader.read({ cwd: files.cwd, trusted: false, home: files.home, reportIssue: (x) => first.push(x) });
		await reader.read({ cwd: files.cwd, trusted: false, home: files.home, reportIssue: (x) => second.push(x) });
		expect(second).toEqual(first);
		await writeFile(files.global, '{"filterBashEnvironment":false}');
		const replaced = await reader.read({ cwd: files.cwd, trusted: false, home: files.home });
		expect(replaced.valid).toBe(true);
		expect(replaced.config.filterBashEnvironment).toBe(false);
	});
});
