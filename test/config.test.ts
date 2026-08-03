import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	booleanField,
	defineConfigSchema,
	getAgentDirectory,
	integerField,
	readConfig,
	stringEnumField,
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
	it('resolves agent directories without accepting relative overrides', () => {
		expect(getAgentDirectory({}, '/home/test')).toBe('/home/test/.pi/agent');
		expect(getAgentDirectory({ PI_CODING_AGENT_DIR: '' }, '/home/test')).toBe('/home/test/.pi/agent');
		expect(getAgentDirectory({ PI_CODING_AGENT_DIR: '~/custom' }, '/home/test')).toBe('/home/test/custom');
		expect(getAgentDirectory({ PI_CODING_AGENT_DIR: '/var/lib/pi' }, '/home/test')).toBe('/var/lib/pi');
		expect(() => getAgentDirectory({ PI_CODING_AGENT_DIR: 'relative' }, '/home/test')).toThrow('absolute');
	});

	it('validates string enums', () => {
		const field = stringEnumField('first', ['first', 'second']);
		expect(field.validate('second')).toBe(true);
		expect(field.validate('third')).toBe(false);
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

		await expect(readConfig(schema, cwd, true, reportIssue)).resolves.toEqual({
			enabled: true,
			limit: 4,
			directory: '/tmp',
		});
		expect(reportIssue).toHaveBeenCalledTimes(2);
		expect(reportIssue).toHaveBeenNthCalledWith(1, `invalid limit in ${path}`);
		expect(reportIssue).toHaveBeenNthCalledWith(2, `invalid directory in ${path}`);
	});

	it('applies project settings only for trusted projects', async () => {
		const name = `test-${crypto.randomUUID()}`;
		const schema = defineConfigSchema(name, { limit: integerField(4, 1) });
		const cwd = await temporaryDirectory();
		await mkdir(join(cwd, '.pi', 'extensions'), { recursive: true });
		await writeFile(join(cwd, '.pi', 'extensions', `${name}.json`), '{"limit":8}');

		const reportIssue = vi.fn();
		await expect(readConfig(schema, cwd, false, reportIssue)).resolves.toEqual({
			limit: 4,
		});
		await expect(readConfig(schema, cwd, true, reportIssue)).resolves.toEqual({
			limit: 8,
		});
		expect(reportIssue).not.toHaveBeenCalled();
	});
});
