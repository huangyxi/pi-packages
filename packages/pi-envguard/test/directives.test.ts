import { describe, expect, it } from 'vitest';

import { parseDirectives } from '../src/directives';

describe('directive headers', () => {
	it('removes recognized leading directives and unions modes', () => {
		expect(
			parseDirectives('\n <pi-envguard:skip-filter!> \n<pi-envguard:skip-redaction!>\nrun the command'),
		).toEqual({ text: '\nrun the command', mode: 'all', found: true });
	});

	it('leaves later and malformed directive-like text alone', () => {
		const text = 'ordinary text\n<pi-envguard:skip-all!>';
		expect(parseDirectives(text)).toEqual({ text, found: false });
		expect(parseDirectives('<pi-envguard:skip-all>\ntext')).toEqual({
			text: '<pi-envguard:skip-all>\ntext',
			found: false,
		});
	});

	it('accepts duplicate and tag-only headers', () => {
		expect(parseDirectives('<pi-envguard:skip-all!>\n<pi-envguard:skip-all!>')).toEqual({
			text: '',
			mode: 'all',
			found: true,
		});
	});
});
