import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { convertWithMarkit } from '../../src/processing/markit';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('Markit processing', () => {
	it('creates parsed Markdown under the configured temporary directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'pi-attach-markit-test-'));
		temporaryDirectories.push(root);
		const workerPath = join(root, 'worker.mjs');
		const temporaryDirectory = join(root, 'configured-temp');
		await writeFile(workerPath, "process.on('message', () => process.send?.({ text: '# converted' }));\n");

		const result = await convertWithMarkit(
			{ kind: 'file', value: '/unused' },
			workerPath,
			new AbortController().signal,
			temporaryDirectory,
		);

		expect(relative(temporaryDirectory, result.parsedPath)).toMatch(/^pi-attach-[^/]+\/parsed\.md$/);
		await expect(readFile(result.parsedPath, 'utf8')).resolves.toBe('# converted');
	});
});
