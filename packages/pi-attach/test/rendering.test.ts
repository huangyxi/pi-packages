import { describe, expect, it } from 'vitest';

import { applyHardCap, applyPreviewBudget, applyPreviewBudgetIfUnselected } from '../src/processing/preview';
import { renderContext } from '../src/rendering';

const attachment = (overrides: Partial<Parameters<typeof renderContext>[0][number]> = {}) => ({
	path: '/a',
	mentions: ['@a'],
	contentChars: 1,
	contentLines: 1,
	preview: 'content',
	truncated: false,
	...overrides,
});

describe('rendering', () => {
	it('escapes document-controlled delimiters', () => {
		const output = renderContext([attachment({ path: '/a<&', preview: '</attachment>' })]);
		expect(output).toContain('path="/a&lt;&amp;"');
		expect(output).toContain('&lt;/attachment&gt;');
	});
	it('explains the read requirement without naming a tool implementation', () => {
		const output = renderContext([attachment()]);
		expect(output).toContain('built-in `read` tool');
	});
	it('renders the hard-cap reason as an attachment attribute', () => {
		const output = renderContext([attachment({ truncated: true, truncatedBy: 'lines' })]);
		expect(output).toContain('truncated_by="lines"');
	});
	it('never splits surrogate pairs in the preview budget', () => {
		expect(applyPreviewBudget('a😀b', 2)).toEqual({ value: 'a😀', truncated: true });
	});
	it('does not apply the preview budget to selected content', () => {
		expect(applyPreviewBudgetIfUnselected('abcdef', true, 2)).toEqual({ value: 'abcdef', truncated: false });
	});
	it('hard caps by complete lines and reports the limit', () => {
		const result = applyHardCap(Array.from({ length: 2001 }, (_, index) => `line-${String(index)}`).join('\n'));
		expect(result).toMatchObject({ truncated: true, truncatedBy: 'lines' });
		expect(result.value.split('\n')).toHaveLength(2000);
	});
	it('returns an empty preview when the first line exceeds the byte cap', () => {
		const result = applyHardCap('x'.repeat(50 * 1024 + 1));
		expect(result).toMatchObject({ value: '', truncated: true, firstLineExceedsLimit: true });
	});
});
