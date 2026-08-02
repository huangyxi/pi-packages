import type { ResolverRegistry } from './resolver-registry';

export function registerUrlResolver(registry: ResolverRegistry): void {
	registry.register({
		resolve(candidate) {
			try {
				const url = new URL(candidate.value);
				if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.resolve(undefined);
				return Promise.resolve({ kind: 'url', url: url.href, candidate });
			} catch {
				return Promise.resolve(undefined);
			}
		},
	});
}
