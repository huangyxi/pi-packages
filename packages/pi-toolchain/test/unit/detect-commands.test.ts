import { describe, expect, test } from 'vitest';
import { catalog } from '../../src/catalog/registry';
import { detectCommands } from '../../src/detection/detect-commands';

describe('bash detection', () => {
	test.each([
		['rg TODO && fd package .', ['rg', 'fd']],
		['which rg; command -v fd; type bat', ['rg', 'fd', 'bat']],
		['env A=1 rg x | xargs fd', ['rg', 'fd']],
		['env -u PATH rg x', ['rg']],
		["'rg' ignored; rg active", ['rg']],
		['find . -exec rg TODO {} \\;', ['rg']],
		['(rg x); { fd y; }', ['rg', 'fd']],
		['echo $(rg x) && cat <(fd y)', ['rg', 'fd']],
		['scan() { rg x | fd y; }; scan', ['rg', 'fd']],
		['bash -c "rg x && fd y"', ['rg', 'fd']],
		['! rg x', ['rg']],
	])('%s', (source, expected) => {
		expect(detectCommands(source, catalog)).toEqual(expected);
	});
	test.each([
		"echo 'rg'",
		'echo rg',
		"'rg' TODO",
		'./rg TODO',
		'X=rg; echo $X',
		'echo hi # rg',
		'cat <<EOF\nrg secret\nEOF',
		'echo rg > output',
	])('ignores %s', (source) => {
		expect(detectCommands(source, catalog)).toEqual([]);
	});
	test('falls back without blocking malformed input', () => {
		expect(detectCommands("rg TODO && printf '", catalog)).toEqual(['rg']);
	});
	test('deduplicates by first appearance', () => {
		expect(detectCommands('rg x; fd y; rg z', catalog)).toEqual(['rg', 'fd']);
	});
});
