/**
 * Smoke-tests the built package before it ships: the extension must
 * default-export a function, and the generated skills and /opsx-* prompt
 * templates must be present in `dist/` with well-formed frontmatter and no
 * stale namespaced command references.
 *
 * Run after `build` (not part of `check`): node scripts/smoke.ts
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = join(import.meta.dirname, '..', 'dist');

interface ExtensionModule {
	default?: unknown;
}

function hasFrontmatterKey(text: string, key: string): boolean {
	const end = text.indexOf('\n---');
	return text.startsWith('---') && end !== -1 && text.slice(0, end).includes(key);
}

const extension = (await import(pathToFileURL(join(dist, 'extension.js')).href)) as ExtensionModule;

const skillDirs = (await readdir(join(dist, 'skills'))).sort();
const skills = await Promise.all(skillDirs.map((dir) => readFile(join(dist, 'skills', dir, 'SKILL.md'), 'utf8')));

const prompts = (await readdir(join(dist, 'prompts'))).filter((file) => file.endsWith('.md')).sort();
const promptTexts = await Promise.all(prompts.map((file) => readFile(join(dist, 'prompts', file), 'utf8')));

const failures: string[] = [];
if (typeof extension.default !== 'function') {
	failures.push('extension does not default-export a function');
}
if (skillDirs.length === 0) {
	failures.push('no skills generated');
}
if (skillDirs.length !== prompts.length) {
	failures.push(`skill count (${String(skillDirs.length)}) does not match prompt count (${String(prompts.length)})`);
}
for (const { file, text } of prompts.map((file, index) => ({ file, text: promptTexts[index] }))) {
	if (!/^opsx-[a-z0-9-]+\.md$/.test(file)) {
		failures.push(`unexpected prompt filename: ${file}`);
	}
	if (!hasFrontmatterKey(text ?? '', 'description: ')) {
		failures.push(`${file} is missing description frontmatter`);
	}
	if (text?.includes('/opsx:')) {
		failures.push(`${file} still references a namespaced /opsx: command`);
	}
}
for (const { dir, text } of skillDirs.map((dir, index) => ({ dir, text: skills[index] }))) {
	if (!hasFrontmatterKey(text ?? '', 'name: ')) {
		failures.push(`${dir}/SKILL.md is missing name frontmatter`);
	}
	if (!hasFrontmatterKey(text ?? '', 'description: ')) {
		failures.push(`${dir}/SKILL.md is missing description frontmatter`);
	}
	if (text?.includes('/opsx:')) {
		failures.push(`${dir}/SKILL.md still references a namespaced /opsx: command`);
	}
}

for (const failure of failures) {
	console.error(`smoke: ${failure}`);
}
if (failures.length > 0) {
	process.exit(1);
}
console.log(
	`smoke: extension loads, ${String(skillDirs.length)} skills and ${String(prompts.length)} prompts are well-formed`,
);
