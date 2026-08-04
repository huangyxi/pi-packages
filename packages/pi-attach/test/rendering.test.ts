import { describe, expect, it } from 'vitest';

import { createPreview } from '../src/processing/preview';
import { renderContext } from '../src/rendering';

describe('rendering', () => {
	it('escapes document-controlled delimiters', () => {
		const output = renderContext([
			{
				path: '/a<&',
				mentions: ['@a'],
				sourceBytes: 1,
				contentChars: 1,
				contentLines: 1,
				preview: '</attachment>',
				truncated: false,
			},
		]);
		expect(output).toContain('path="/a&lt;&amp;"');
		expect(output).toContain('&lt;/attachment&gt;');
	});
	it('never splits surrogate pairs', () => {
		expect(createPreview('a😀b', 2)).toEqual({
			value: 'a😀',
			truncated: true,
		});
	});
});
