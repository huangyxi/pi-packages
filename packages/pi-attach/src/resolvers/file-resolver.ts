import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import type { MentionCandidate } from '../types';
import type { ResolverRegistry } from './resolver-registry';

function expandPath(value: string, cwd: string): string {
	if (value === '~') return homedir();
	if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
	return isAbsolute(value) ? value : resolve(cwd, value);
}

function selectorSuffix(candidate: MentionCandidate): string | undefined {
	if (!candidate.selector || !candidate.selectorDelimiter) return undefined;
	const { start, end } = candidate.selector;
	const range = end === start ? String(start) : `${String(start)}-${String(end)}`;
	return candidate.selectorDelimiter === ':' ? `:${range}` : `#L${range}`;
}

function withoutSelector(candidate: MentionCandidate): MentionCandidate {
	const result = { ...candidate };
	delete result.selector;
	delete result.selectorDelimiter;
	return result;
}

export function registerFileResolver(registry: ResolverRegistry): void {
	registry.register({
		async resolve(candidate, context) {
			if (!candidate.selector && candidate.value.includes(':') && !/^[A-Za-z]:[\\/]/.test(candidate.value))
				return undefined;
			const suffix = selectorSuffix(candidate);
			const paths = suffix ? [candidate.value + suffix, candidate.value] : [candidate.value];
			for (const value of paths) {
				try {
					const path = await realpath(expandPath(value, context.cwd));
					if (!(await stat(path)).isFile()) continue;
					return {
						kind: 'file',
						path,
						candidate: suffix && value === paths[0] ? withoutSelector(candidate) : candidate,
					};
				} catch {
					// Try the base path when a literal selector-like filename is absent.
				}
			}
			return undefined;
		},
	});
}
