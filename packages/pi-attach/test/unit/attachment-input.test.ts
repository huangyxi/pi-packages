import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processAttachmentInput } from '../../src/attachment-input';
import { registerFileResolver } from '../../src/resolvers/file-resolver';
import { ResolverRegistry } from '../../src/resolvers/resolver-registry';

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
});
