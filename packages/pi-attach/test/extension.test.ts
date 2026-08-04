import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

import attach from '../src/extension';

interface TestContext {
	cwd: string;
	hasUI: boolean;
	isProjectTrusted(): boolean;
	ui: { notify(message: string, level: string): void };
}

type BeforeAgentStartHandler = (
	event: { prompt: string },
	context: TestContext,
) => Promise<
	| {
			message: {
				customType: string;
				details: { path: string }[];
			};
	  }
	| undefined
>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('attach extension', () => {
	it('expands mentions atomically before the agent starts', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'pi-attach-extension-test-'));
		temporaryDirectories.push(cwd);
		await writeFile(join(cwd, 'source.txt'), 'attachment content');
		const handlers = new Map<string, unknown>();
		const pi = {
			on(name: string, handler: unknown) {
				handlers.set(name, handler);
			},
			getCommands() {
				return [];
			},
		} as unknown as ExtensionAPI;
		attach(pi);
		const beforeAgentStart = handlers.get('before_agent_start') as BeforeAgentStartHandler;

		await expect(
			beforeAgentStart(
				{ prompt: '@source.txt summarize' },
				{
					cwd,
					hasUI: false,
					isProjectTrusted: () => true,
					ui: { notify: () => undefined },
				},
			),
		).resolves.toMatchObject({
			message: {
				customType: 'attach-context',
				details: [{ path: join(cwd, 'source.txt') }],
			},
		});
	});
});
