import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	booleanField,
	createConfigReader,
	defineConfigSchema,
	integerField,
	orderedStringListField,
	stringField,
} from '../src/utils/config';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'pi-config-'));
	temporaryDirectories.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('config utilities', () => {
	it('removes stateful regular-expression behavior from string fields', () => {
		const field = stringField('', /^value$/gy);
		expect(field.validate('value')).toBe(true);
		expect(field.validate('value')).toBe(true);
	});

	it('resolves agent directories without accepting relative overrides', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, { enabled: booleanField(false) });
		const cases = [
			{ env: {}, relativeDirectory: join('.pi', 'agent') },
			{ env: { PI_CODING_AGENT_DIR: '' }, relativeDirectory: join('.pi', 'agent') },
			{ env: { PI_CODING_AGENT_DIR: '~/custom' }, relativeDirectory: 'custom' },
		] satisfies { env: NodeJS.ProcessEnv; relativeDirectory: string }[];

		for (const testCase of cases) {
			const cwd = await temporaryDirectory();
			const home = await temporaryDirectory();
			const directory = join(home, testCase.relativeDirectory, 'extensions');
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, `${name}.json`), '{"enabled":true}');
			const result = await createConfigReader(schema).read({
				cwd,
				trusted: false,
				home,
				env: testCase.env,
			});
			expect(result.config.enabled).toBe(true);
		}

		const cwd = await temporaryDirectory();
		const home = await temporaryDirectory();
		const absoluteDirectory = join(home, 'absolute-agent');
		await mkdir(join(absoluteDirectory, 'extensions'), { recursive: true });
		await writeFile(join(absoluteDirectory, 'extensions', `${name}.json`), '{"enabled":true}');
		await expect(
			createConfigReader(schema).read({
				cwd,
				trusted: false,
				home,
				env: { PI_CODING_AGENT_DIR: absoluteDirectory },
			}),
		).resolves.toMatchObject({ config: { enabled: true } });
		await expect(
			createConfigReader(schema).read({
				cwd,
				trusted: false,
				home,
				env: { PI_CODING_AGENT_DIR: 'relative' },
			}),
		).rejects.toThrow('absolute');
	});

	it('loads known valid fields and reports invalid values', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, {
			enabled: booleanField(false),
			limit: integerField(4, 1),
			directory: stringField('/tmp', /^[\s\S]+$/),
		});
		const cwd = await temporaryDirectory();
		await mkdir(join(cwd, '.pi', 'extensions'), { recursive: true });
		const path = join(cwd, '.pi', 'extensions', `${name}.json`);
		await writeFile(path, JSON.stringify({ enabled: true, limit: 0, directory: '', unknown: 'ignored' }));
		const reportIssue = vi.fn();

		const reader = createConfigReader(schema, { allowPartialFiles: true, reportUnknownFields: false });
		const result = await reader.read({ cwd, trusted: true, reportIssue });
		expect(result.config).toEqual({
			enabled: true,
			limit: 4,
			directory: '/tmp',
		});
		expect(reportIssue).toHaveBeenCalledTimes(2);
		expect(reportIssue).toHaveBeenNthCalledWith(1, `invalid limit in ${path}`);
		expect(reportIssue).toHaveBeenNthCalledWith(2, `invalid directory in ${path}`);
	});

	it('composes ordered string lists and rejects bare/modifier conflicts', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, {
			rules: orderedStringListField(['default'], (entry) => entry.length > 0),
		});
		const cwd = await temporaryDirectory();
		const home = await temporaryDirectory();
		const globalDirectory = join(home, '.pi', 'agent', 'extensions');
		const projectDirectory = join(cwd, '.pi', 'extensions');
		await mkdir(globalDirectory, { recursive: true });
		await mkdir(projectDirectory, { recursive: true });
		await writeFile(
			join(globalDirectory, `${name}.json`),
			JSON.stringify({ '+rules': ['global'], 'rules+': ['tail'] }),
		);
		await writeFile(join(projectDirectory, `${name}.json`), JSON.stringify({ '+rules': ['project'] }));
		const reader = createConfigReader(schema);
		const result = await reader.read({ cwd, trusted: true, home });
		expect(result).toMatchObject({
			valid: true,
			config: {
				rules: [
					'project',
					'global',
					'default',
					'tail',
				],
			},
		});

		await writeFile(
			join(projectDirectory, `${name}.json`),
			JSON.stringify({ rules: ['replacement'], 'rules+': [] }),
		);
		const invalid = await reader.read({ cwd, trusted: true, home });
		expect(invalid.valid).toBe(false);
		expect(invalid.config.rules).toEqual(['global', 'default', 'tail']);
	});

	it('invalidates a schema reader explicitly', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, { enabled: booleanField(false) });
		const cwd = await temporaryDirectory();
		const home = await temporaryDirectory();
		const reader = createConfigReader(schema);
		await expect(reader.read({ cwd, trusted: false, home })).resolves.toMatchObject({ valid: true });
		reader.invalidate();
		await expect(reader.read({ cwd, trusted: false, home })).resolves.toMatchObject({
			valid: true,
			config: { enabled: false },
		});
	});

	it('keeps unknown-field reporting opt-in', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, { enabled: booleanField(false) });
		const home = await temporaryDirectory();
		const directory = join(home, '.pi', 'agent', 'extensions');
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, `${name}.json`), '{"unknown":true}');
		const reportIssue = vi.fn();
		await createConfigReader(schema, { reportUnknownFields: false }).read({
			cwd: await temporaryDirectory(),
			trusted: false,
			home,
			reportIssue,
		});
		expect(reportIssue).not.toHaveBeenCalled();
		await createConfigReader(schema, { reportUnknownFields: true }).read({
			cwd: await temporaryDirectory(),
			trusted: false,
			home,
			reportIssue,
		});
		expect(reportIssue).toHaveBeenCalledWith(expect.stringContaining('unknown unknown'));
	});

	it('applies project settings only for trusted projects', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, { limit: integerField(4, 1) });
		const cwd = await temporaryDirectory();
		await mkdir(join(cwd, '.pi', 'extensions'), { recursive: true });
		await writeFile(join(cwd, '.pi', 'extensions', `${name}.json`), '{"limit":8}');

		const reportIssue = vi.fn();
		const reader = createConfigReader(schema, { allowPartialFiles: true, reportUnknownFields: false });
		await expect(reader.read({ cwd, trusted: false, reportIssue })).resolves.toMatchObject({
			config: { limit: 4 },
		});
		await expect(reader.read({ cwd, trusted: true, reportIssue })).resolves.toMatchObject({
			config: { limit: 8 },
		});
		expect(reportIssue).not.toHaveBeenCalled();
	});
});
