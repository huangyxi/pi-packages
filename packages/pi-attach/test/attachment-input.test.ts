import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { processAttachmentInput } from '../src/attachment-input';
import { registerFileResolver } from '../src/resolvers/file-resolver';
import { ResolverRegistry } from '../src/resolvers/resolver-registry';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'pi-attach-input-'));
	temporaryDirectories.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('attachment warning channels', () => {
	it('reports processing failures without producing LLM context', async () => {
		const registry = new ResolverRegistry();
		registry.register({
			resolve: (candidate) =>
				Promise.resolve({
					kind: 'file',
					path: '/missing-attachment',
					candidate,
				}),
		});

		const reportIssue = vi.fn();
		const result = await processAttachmentInput('@missing', '/tmp', false, registry, reportIssue);
		expect(result).toBeUndefined();
		expect(reportIssue).toHaveBeenCalledOnce();
		expect(reportIssue).toHaveBeenCalledWith('could not attach @missing');
	});

	it('keeps content interpretation warnings in LLM context', async () => {
		const cwd = await temporaryDirectory();
		await writeFile(join(cwd, 'document.txt'), 'one\ntwo\n');
		const registry = new ResolverRegistry();
		registerFileResolver(registry);

		const reportIssue = vi.fn();
		const result = await processAttachmentInput('@document.txt#L99', cwd, false, registry, reportIssue);
		expect(reportIssue).not.toHaveBeenCalled();
		expect(result?.content).toContain('<warnings>@document.txt#L99: requested lines are out of bounds</warnings>');
	});

	it('reads text-like files directly and supports both local selector syntaxes', async () => {
		const cwd = await temporaryDirectory();
		const files = {
			'values.csv': 'a,b\n1,2\n',
			'values.json': '{"a":1}\n',
			'page.html': '<p>text</p>\n',
			'notebook.ipynb': '{"cells":[]}\n',
		};
		await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(cwd, name), content)));
		const registry = new ResolverRegistry();
		registerFileResolver(registry);
		const reportIssue = vi.fn();

		const result = await processAttachmentInput(
			Object.keys(files)
				.map((name) => `@${name}`)
				.join(' '),
			cwd,
			false,
			registry,
			reportIssue,
		);

		expect(reportIssue).not.toHaveBeenCalled();
		expect(result?.details).toHaveLength(Object.keys(files).length);
		expect(result?.details.every(({ parsedPath }) => parsedPath === undefined)).toBe(true);

		const colon = await processAttachmentInput('@values.csv:1-2', cwd, false, registry, reportIssue);
		expect(colon?.details[0]).toMatchObject({ requestedLines: '1-2', preview: 'a,b\n1,2' });

		const hash = await processAttachmentInput('@values.csv#L2', cwd, false, registry, reportIssue);
		expect(hash?.details[0]).toMatchObject({ requestedLines: '2-2', preview: '1,2' });
	});

	it('prefers a literal selector-like filename before selecting lines', async () => {
		const cwd = await temporaryDirectory();
		const literalPath = join(cwd, 'abc.txt:12');
		await writeFile(literalPath, 'literal filename');
		const registry = new ResolverRegistry();
		registerFileResolver(registry);

		const result = await processAttachmentInput('@abc.txt:12', cwd, false, registry, vi.fn());

		expect(result?.details[0]).toMatchObject({ path: literalPath, preview: 'literal filename' });
		expect(result?.details[0]?.requestedLines).toBeUndefined();
	});

	it("warns when a single source line exceeds Pi's byte cap", async () => {
		const cwd = await temporaryDirectory();
		await writeFile(join(cwd, 'bundle.js'), 'x'.repeat(50 * 1024 + 1));
		const registry = new ResolverRegistry();
		registerFileResolver(registry);

		const result = await processAttachmentInput('@bundle.js:1', cwd, false, registry, vi.fn());

		expect(result?.content).toContain("first line exceeds Pi's hard byte cap");
		expect(result?.details[0]).toMatchObject({ preview: '', truncated: true });
	});
});
