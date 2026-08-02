import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { booleanField, defineConfigSchema, integerField, readConfig, stringField } from '@/utils/config';

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
