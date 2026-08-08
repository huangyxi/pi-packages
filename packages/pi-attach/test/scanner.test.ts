import { describe, expect, it } from 'vitest';

import { scanMentions } from '../src/scanner';

describe('scanMentions', () => {
	it('recognizes bounded mentions and selectors', () => {
		const mentions = scanMentions(
			'See @src/a.ts#L10-20 and @https://example.com/docs#intro and @https://example.com/raw#L12-24 and @"file with spaces.txt"',
		);
		expect(mentions).toMatchObject([
			{ value: 'src/a.ts', selector: { start: 10, end: 20 } },
			{ value: 'https://example.com/docs#intro' },
			{ value: 'https://example.com/raw#L12-24' },
			{ value: 'file with spaces.txt' },
		]);
		expect(mentions[2]?.selector).toBeUndefined();
	});

	it('recognizes colon selectors for local files', () => {
		expect(scanMentions('@src/a.ts:3-4 @src/b.ts#L5')).toMatchObject([
			{ value: 'src/a.ts', selector: { start: 3, end: 4 }, selectorDelimiter: ':' },
			{ value: 'src/b.ts', selector: { start: 5, end: 5 }, selectorDelimiter: '#L' },
		]);
	});
	it('does not scan protected scopes or embedded names', () => {
		expect(
			scanMentions("a@x `@no` '@no' $@no$ \\@no <https://x/@no> [x](@no) @yes").map((item) => item.value),
		).toEqual(['yes']);
	});
});
