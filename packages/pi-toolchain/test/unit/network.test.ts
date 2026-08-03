import { describe, expect, test } from 'vitest';
import { resolveProxyPolicy } from '../../src/installation/network';
import { normalizeProxyEnvironment } from '../../src/installation/environment';
import { sanitizeDiagnostic } from '../../src/output/diagnostics';

describe('network policy', () => {
	test('lowercase presence wins and empty clears uppercase', () => {
		const value = normalizeProxyEnvironment({
			HTTP_PROXY: 'http://upper',
			http_proxy: '',
			HTTPS_PROXY: 'http://secure',
		});
		expect(value.HTTP_PROXY).toBeUndefined();
		expect(value.http_proxy).toBeUndefined();
		expect(value.HTTPS_PROXY).toBe('http://secure');
		expect(value.https_proxy).toBe('http://secure');
	});
	test('applies scheme fallback, lowercase clearing, and NO_PROXY precedence', () => {
		expect(
			resolveProxyPolicy({ ALL_PROXY: 'http://all', HTTPS_PROXY: 'http://secure', no_proxy: 'localhost' }),
		).toEqual({ httpProxy: 'http://all', httpsProxy: 'http://secure', noProxy: 'localhost' });
		expect(resolveProxyPolicy({ HTTP_PROXY: 'http://upper', http_proxy: '', ALL_PROXY: 'http://all' })).toEqual({
			httpProxy: 'http://all',
			httpsProxy: 'http://all',
		});
	});
	test('redacts proxy credentials', () => {
		expect(sanitizeDiagnostic('https://user:secret@example.test/path')).not.toContain('secret');
	});
});
