import { describe, expect, it } from 'vitest';

import { ResolverRegistry } from '../../src/resolvers/resolver-registry';
import { registerUrlResolver } from '../../src/resolvers/url-resolver';
import type { MentionCandidate } from '../../src/types';

function candidate(value: string): MentionCandidate {
	return { raw: `@${value}`, value, start: 0, end: value.length + 1 };
}

describe('URL resolver', () => {
	it('resolves HTTP and HTTPS URLs', async () => {
		const registry = new ResolverRegistry();
		registerUrlResolver(registry);

		await expect(
			registry.resolve(candidate('https://example.com/docs#intro'), { cwd: '/tmp' }),
		).resolves.toMatchObject({
			kind: 'url',
			url: 'https://example.com/docs#intro',
		});
		await expect(registry.resolve(candidate('http://example.com'), { cwd: '/tmp' })).resolves.toMatchObject({
			kind: 'url',
			url: 'http://example.com/',
		});
	});

	it('rejects non-HTTP schemes', async () => {
		const registry = new ResolverRegistry();
		registerUrlResolver(registry);

		await expect(registry.resolve(candidate('file:///tmp/report.pdf'), { cwd: '/tmp' })).resolves.toBeUndefined();
	});
});
