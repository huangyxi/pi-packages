import { describe, expect, it } from 'vitest';

import { createLiteralRedactor } from '../src/redaction';

const defaults = { visiblePrefixLength: 4, visibleSuffixLength: 0, redactionMarker: '****' };

describe('literal redaction', () => {
	it('matches exact case-sensitive values embedded in text', () => {
		const redactor = createLiteralRedactor(['abcdefgh1234'], defaults);
		expect(redactor.redact('x=abcdefgh1234; ABCDEFGH1234')).toBe('x=abcd****; ABCDEFGH1234');
	});

	it('prefers the longest value and processes replacements non-recursively', () => {
		const redactor = createLiteralRedactor(['abcd', 'abcdefgh', '****'], {
			visiblePrefixLength: 0,
			visibleSuffixLength: 0,
			redactionMarker: '****',
		});
		expect(redactor.redact('abcdefgh')).toBe('****');
	});

	it('handles overlap, duplicates, and multiple original occurrences', () => {
		const redactor = createLiteralRedactor(['aba', 'aba', 'bab'], {
			visiblePrefixLength: 0,
			visibleSuffixLength: 0,
			redactionMarker: 'X',
		});
		expect(redactor.redact('ababa aba')).toBe('Xba X');
	});

	it('slices visible prefix and suffix by Unicode code points', () => {
		const redactor = createLiteralRedactor(['🔐abcdef🔑'], {
			visiblePrefixLength: 1,
			visibleSuffixLength: 1,
			redactionMarker: '[redacted]',
		});
		expect(redactor.redact('🔐abcdef🔑')).toBe('🔐[redacted]🔑');
	});

	it('keeps matches separate across independent blocks', () => {
		const redactor = createLiteralRedactor(['abcdefgh'], defaults);
		expect(redactor.redact('abcd')).toBe('abcd');
		expect(redactor.redact('efgh')).toBe('efgh');
	});

	it('handles large deterministic value collections', () => {
		const values = Array.from({ length: 2_000 }, (_, index) => `secret-value-${String(index)}`);
		const redactor = createLiteralRedactor(values, defaults);
		expect(redactor.redact(`before ${values[1999] ?? ''} after`)).toBe('before secr**** after');
	});
});
