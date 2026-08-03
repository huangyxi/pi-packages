import { join, relative, resolve, sep } from 'node:path';

export interface StatePaths {
	root: string;
	bin: string;
	installations: string;
	state: string;
	locks: string;
	staging: string;
	marker: string;
}
export function statePaths(root: string): StatePaths {
	const absolute = resolve(root);
	return {
		root: absolute,
		bin: join(absolute, 'bin'),
		installations: join(absolute, 'installations'),
		state: join(absolute, 'state'),
		locks: join(absolute, '.locks'),
		staging: join(absolute, '.staging'),
		marker: join(absolute, '.pi-toolchain-root.json'),
	};
}
export function assertContained(root: string, candidate: string): string {
	const value = resolve(candidate);
	const rel = relative(resolve(root), value);
	if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))) return value;
	throw new Error(`path escapes toolkit root: ${candidate}`);
}
