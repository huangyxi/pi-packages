import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import type { ResolverRegistry } from './resolver-registry';

function expandPath(value: string, cwd: string): string {
	if (value === '~') return homedir();
	if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
	return isAbsolute(value) ? value : resolve(cwd, value);
}

export function registerFileResolver(registry: ResolverRegistry): void {
	registry.register({
		async resolve(candidate, context) {
			// Reject URI schemes here so later URL/skill resolvers retain ownership.
			if (candidate.value.includes(':') && !/^[A-Za-z]:[\\/]/.test(candidate.value)) return undefined;
			try {
				const path = await realpath(expandPath(candidate.value, context.cwd));
				if (!(await stat(path)).isFile()) return undefined;
				return { kind: 'file', path, candidate };
			} catch {
				return undefined;
			}
		},
	});
}
