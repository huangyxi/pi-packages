import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function discoverPackageDirectory(options: {
	environment?: NodeJS.ProcessEnv;
	agentDirectory: string;
	physicalCwd: string;
}): Promise<string | undefined> {
	const environment = options.environment ?? process.env;
	const candidates = [
		environment.PI_TOOLCHAIN_PACKAGE_DIR,
		join(options.agentDirectory, 'npm/node_modules/@hyxi/pi-toolchain'),
		join(options.physicalCwd, '.pi/npm/node_modules/@hyxi/pi-toolchain'),
	];
	for (const candidate of candidates) {
		if (!candidate || !isAbsolute(candidate)) continue;
		try {
			const metadata = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8')) as { name?: string };
			if (metadata.name !== '@hyxi/pi-toolchain') continue;
			await access(join(candidate, 'dist/cli.js'));
			return candidate;
		} catch {}
	}
	return undefined;
}
