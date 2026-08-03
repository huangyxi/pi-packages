import { readFile } from 'node:fs/promises';

export async function platformIdentity(): Promise<import('../catalog/types').PlatformIdentity> {
	let libc: 'glibc' | 'musl' | 'unknown' | undefined;
	if (process.platform === 'linux') {
		try {
			libc = (await readFile('/usr/bin/ldd', 'utf8')).includes('musl') ? 'musl' : 'glibc';
		} catch {
			libc = 'unknown';
		}
	}
	return { platform: process.platform, architecture: process.arch, ...(libc === undefined ? {} : { libc }) };
}

export function supportsPlatform(definition: import('../catalog/types').ToolchainDefinition): boolean {
	if (process.platform === 'linux') {
		const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
		if (!report?.header?.glibcVersionRuntime) return false;
	}
	return definition.platforms.some(
		(support) => support.platform === process.platform && support.architectures.includes(process.arch),
	);
}
