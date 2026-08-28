import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { generateAssets } from '../scripts/generate-assets';

function resolveOpenspecEntry(): string | undefined {
	try {
		return createRequire(import.meta.url).resolve('@fission-ai/openspec');
	} catch {
		return undefined;
	}
}

const openspecEntry = resolveOpenspecEntry();
const openspecManifestPath =
	openspecEntry === undefined ? undefined : join(dirname(dirname(openspecEntry)), 'package.json');

describe.skipIf(openspecEntry === undefined)('OpenSpec asset generation', () => {
	const generatedDirs: string[] = [];
	let generated: Promise<string> | undefined;

	/** Renders the assets once into a fresh temporary directory and reuses the result. */
	function generate(): Promise<string> {
		generated ??= (async () => {
			const outDir = await mkdtemp(join(tmpdir(), 'pi-openspec-assets-'));
			generatedDirs.push(outDir);
			await generateAssets(outDir);
			return outDir;
		})();
		return generated;
	}

	afterAll(async () => {
		await Promise.all(generatedDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('generates one skill per workflow with valid frontmatter', async () => {
		const outDir = await generate();
		if (openspecManifestPath === undefined) throw new Error('OpenSpec is not installed');
		const manifest = JSON.parse(await readFile(openspecManifestPath, 'utf8')) as { version: string };
		const skillDirs = await readdir(join(outDir, 'skills'));
		expect(skillDirs.length).toBeGreaterThan(0);

		for (const dir of skillDirs) {
			const skill = await readFile(join(outDir, 'skills', dir, 'SKILL.md'), 'utf8');
			const frontmatter = skill.split('\n---')[0] ?? '';
			expect(frontmatter.startsWith('---')).toBe(true);
			expect(frontmatter.split('\n').some((line) => line.startsWith('name: '))).toBe(true);
			expect(frontmatter.split('\n').some((line) => line.startsWith('description: '))).toBe(true);
			expect(skill).toContain(`generatedBy: "${manifest.version}"`);
		}
	});

	it('generates one /opsx-* prompt per skill with a quoted description', async () => {
		const outDir = await generate();
		const skillDirs = await readdir(join(outDir, 'skills'));
		const promptNames = (await readdir(join(outDir, 'prompts'))).filter((name) => name.endsWith('.md'));
		expect(promptNames).toHaveLength(skillDirs.length);
		expect(promptNames.every((name) => /^opsx-[a-z0-9-]+\.md$/.test(name))).toBe(true);

		for (const name of promptNames) {
			const prompt = await readFile(join(outDir, 'prompts', name), 'utf8');
			expect(prompt.startsWith('---\ndescription: "')).toBe(true);
		}
	});

	it('rewrites canonical /opsx: command references to the flat /opsx- form', async () => {
		const outDir = await generate();
		const skillDirs = await readdir(join(outDir, 'skills'));
		const promptNames = await readdir(join(outDir, 'prompts'));
		const texts = [
			...skillDirs.map((dir) => readFile(join(outDir, 'skills', dir, 'SKILL.md'), 'utf8')),
			...promptNames.map((name) => readFile(join(outDir, 'prompts', name), 'utf8')),
		];
		const all = (await Promise.all(texts)).join('\n');
		expect(all).not.toContain('/opsx:');
		expect(all).toContain('/opsx-');
	});
});
