import { access, lstat, realpath } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

async function realOrResolved(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}
export async function findSystemCommand(
	name: string,
	pathValue: string | undefined,
	excluded: readonly string[],
): Promise<string | undefined> {
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)) return undefined;
	const excludedReal = await Promise.all(excluded.map(realOrResolved));
	for (const directory of (pathValue ?? '').split(delimiter).filter(Boolean)) {
		const realDirectory = await realOrResolved(directory);
		if (excludedReal.some((entry) => realDirectory === entry || realDirectory.startsWith(`${entry}/`))) continue;
		const candidate = join(directory, name);
		try {
			const stat = await lstat(candidate);
			if (stat.isDirectory()) continue;
			if ((stat.isFile() || stat.isSymbolicLink()) && process.platform === 'win32') return candidate;
			await access(candidate, 1);
			const physical = await realpath(candidate);
			if ((await lstat(physical)).isDirectory()) continue;
			return physical;
		} catch {}
	}
	return undefined;
}
