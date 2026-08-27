import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

import piOpenspec from '../src/extension';
import { installOpenspecAssets, registerOpsxInitCommand } from '../src/opsx-init';

interface RegisteredCommand {
	name: string;
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

const paths: string[] = [];

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	paths.push(dir);
	return dir;
}

async function writeAsset(root: string, relative: string, content: string): Promise<void> {
	await mkdir(dirname(join(root, relative)), { recursive: true });
	await writeFile(join(root, relative), content);
}

afterEach(async () => {
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('installOpenspecAssets', () => {
	it('copies skills and prompts into the project .pi directory', async () => {
		const assets = await tempDir('pi-openspec-assets-');
		const project = await tempDir('pi-openspec-project-');
		await writeAsset(assets, 'skills/openspec-b/SKILL.md', 'skill-b');
		await writeAsset(assets, 'skills/openspec-a/SKILL.md', 'skill-a');
		await writeAsset(assets, 'prompts/opsx-a.md', 'prompt-a');
		await writeAsset(project, '.pi/prompts/keep.md', 'keep');

		const result = await installOpenspecAssets(assets, project);

		expect(result).toEqual({ skills: ['openspec-a', 'openspec-b'], prompts: ['opsx-a.md'] });
		expect(await readFile(join(project, '.pi', 'skills', 'openspec-a', 'SKILL.md'), 'utf8')).toBe('skill-a');
		expect(await readFile(join(project, '.pi', 'skills', 'openspec-b', 'SKILL.md'), 'utf8')).toBe('skill-b');
		expect(await readFile(join(project, '.pi', 'prompts', 'opsx-a.md'), 'utf8')).toBe('prompt-a');
		expect(await readFile(join(project, '.pi', 'prompts', 'keep.md'), 'utf8')).toBe('keep');
	});

	it('overwrites files it manages on rerun', async () => {
		const assets = await tempDir('pi-openspec-assets-');
		const project = await tempDir('pi-openspec-project-');
		await writeAsset(assets, 'skills/openspec-a/SKILL.md', 'skill-a');
		await writeAsset(assets, 'prompts/opsx-a.md', 'prompt-a');
		await installOpenspecAssets(assets, project);

		await writeAsset(assets, 'prompts/opsx-a.md', 'prompt-a-v2');
		await installOpenspecAssets(assets, project);

		expect(await readFile(join(project, '.pi', 'prompts', 'opsx-a.md'), 'utf8')).toBe('prompt-a-v2');
	});
});

describe('opsx-init command', () => {
	function fakeExtensionApi(): { pi: ExtensionAPI; registered: RegisteredCommand[] } {
		const registered: RegisteredCommand[] = [];
		const pi = {
			registerCommand: (name: string, options: Omit<RegisteredCommand, 'name'>) => {
				registered.push({ name, ...options });
			},
		} as unknown as ExtensionAPI;
		return { pi, registered };
	}

	function fakeContext(project: string): {
		ctx: ExtensionCommandContext;
		notifications: { message: string; type?: string | undefined }[];
		reloaded: { value: boolean };
	} {
		const notifications: { message: string; type?: string | undefined }[] = [];
		const reloaded = { value: false };
		const ctx = {
			cwd: project,
			ui: {
				notify: (message: string, type?: 'info' | 'warning' | 'error') => {
					notifications.push({ message, type });
				},
			},
			reload: () => {
				reloaded.value = true;
				return Promise.resolve();
			},
		} as unknown as ExtensionCommandContext;
		return { ctx, notifications, reloaded };
	}

	it('registers the /opsx-init command from the package extension', () => {
		const { pi, registered } = fakeExtensionApi();
		piOpenspec(pi);

		const [entry] = registered;
		expect(entry?.name).toBe('opsx-init');
		expect(typeof entry?.description).toBe('string');
		expect(typeof entry?.handler).toBe('function');
	});

	it('copies the package assets into the current project and reloads', async () => {
		const assets = await tempDir('pi-openspec-assets-');
		const project = await tempDir('pi-openspec-project-');
		await writeAsset(assets, 'skills/openspec-a/SKILL.md', 'skill-a');
		await writeAsset(assets, 'prompts/opsx-a.md', 'prompt-a');

		const { pi, registered } = fakeExtensionApi();
		registerOpsxInitCommand(pi, assets);
		const { ctx, notifications, reloaded } = fakeContext(project);
		await registered[0]?.handler('', ctx);

		expect(await readFile(join(project, '.pi', 'skills', 'openspec-a', 'SKILL.md'), 'utf8')).toBe('skill-a');
		expect(await readFile(join(project, '.pi', 'prompts', 'opsx-a.md'), 'utf8')).toBe('prompt-a');
		expect(reloaded.value).toBe(true);
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.type).toBe('info');
		expect(notifications[0]?.message).toContain('.pi');
	});

	it('reports missing assets as an error notification', async () => {
		const project = await tempDir('pi-openspec-project-');

		const { pi, registered } = fakeExtensionApi();
		registerOpsxInitCommand(pi, join(project, 'missing'));
		const { ctx, notifications } = fakeContext(project);
		await registered[0]?.handler('', ctx);

		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.type).toBe('error');
		expect(notifications[0]?.message).toContain('Package assets not found');
	});
});
