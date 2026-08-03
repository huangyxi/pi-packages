import { describe, expect, test, vi } from 'vitest';

vi.mock('undici', () => ({
	EnvHttpProxyAgent: class {
		async close(): Promise<void> {}
	},
	fetch: async (_url: URL, options: { signal: AbortSignal }): Promise<never> =>
		new Promise((_resolve, reject) => {
			options.signal.addEventListener(
				'abort',
				() => {
					reject(
						options.signal.reason instanceof Error ? options.signal.reason : new Error('request aborted'),
					);
				},
				{ once: true },
			);
		}),
}));

describe('network phase deadline', () => {
	test('aborts a stalled request at the configured timeout', async () => {
		const { fetchText } = await import('../../src/installation/network');
		await expect(
			fetchText('https://example.test/archive', {
				allowedHosts: ['example.test'],
				maxBytes: 100,
				timeoutMs: 5,
			}),
		).rejects.toThrow(/abort|timeout/i);
	});
});
