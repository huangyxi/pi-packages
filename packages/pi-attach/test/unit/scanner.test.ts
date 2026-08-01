import { describe, expect, it } from 'vitest';
import { scanMentions } from '../../src/scanner';

describe('scanMentions', () => {
	it('recognizes bounded mentions and selectors', () => {
		expect(scanMentions('See @src/a.ts#L10-20 and @"file with spaces.txt"')).toMatchObject([
			{ value: 'src/a.ts', selector: { start: 10, end: 20 } },
			{ value: 'file with spaces.txt' },
		]);
	});
	it('does not scan protected scopes or embedded names', () => {
		expect(
			scanMentions("a@x `@no` '@no' $@no$ \\@no <https://x/@no> [x](@no) @yes").map((item) => item.value),
		).toEqual(['yes']);
	});
});
