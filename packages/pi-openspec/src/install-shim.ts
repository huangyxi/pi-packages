import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const SHIM_NAME = 'openspec';
const SHEBANG = '#!/usr/bin/env node';
const MARKER_LINE = '//! @pi-openspec-shim v1 — managed by @hyxi/pi-openspec; do not edit.';

const MANAGED_MARKER_RE = /^\/\/! @pi-openspec-shim v\d+ — managed by @hyxi\/pi-openspec; do not edit\.$/m;
const MARKER_LINE_RE = /^\/\/! @pi-openspec-shim v\d+ — managed by @hyxi\/pi-openspec; do not edit\.\n?/m;

function resolveShimSource(): string {
	const built = join(import.meta.dirname, 'openspecShim.js');
	if (existsSync(built)) return built;
	return join(import.meta.dirname, '..', 'dist', 'openspecShim.js');
}

function readShimSource(): string {
	const built = readFileSync(resolveShimSource(), 'utf8');
	const body = built.replace(/#!.*\n/, '').replace(MARKER_LINE_RE, '');
	return SHEBANG + '\n' + MARKER_LINE + '\n' + body;
}

function expandTilde(path: string): string {
	if (path === '~') return homedir();
	if (path.startsWith('~/')) return join(homedir(), path.slice(2));
	return path;
}

function resolveAgentBinDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.PI_CODING_AGENT_DIR;
	const agentDir = override !== undefined ? expandTilde(override) : join(homedir(), '.pi', 'agent');
	return join(agentDir, 'bin');
}

interface InstallShimResult {
	path: string;
	status: 'current' | 'installed' | 'skipped-user-managed' | 'updated';
}

export async function installShim(options: { binDir?: string } = {}): Promise<InstallShimResult> {
	const binDir = options.binDir ?? resolveAgentBinDir();
	const shimPath = join(binDir, SHIM_NAME);
	const source = readShimSource();
	try {
		const existing = await readFile(shimPath, 'utf8');
		if (existing === source) return { path: shimPath, status: 'current' };
		if (MANAGED_MARKER_RE.test(existing)) {
			await writeFile(shimPath, source, { mode: 0o755 });
			await chmod(shimPath, 0o755);
			return { path: shimPath, status: 'updated' };
		}
		return { path: shimPath, status: 'skipped-user-managed' };
	} catch {}
	await mkdir(dirname(shimPath), { recursive: true });
	await writeFile(shimPath, source, { mode: 0o755 });
	await chmod(shimPath, 0o755);
	return { path: shimPath, status: 'installed' };
}

export function registerInstallShimHook(pi: ExtensionAPI): void {
	if (typeof pi.on !== 'function') return;
	pi.on('session_start', async () => {
		try {
			const result = await installShim();
			console.log(`@hyxi/pi-openspec: openspec wrap script ${result.status} at ${result.path}`);
		} catch (error) {
			console.warn(
				`@hyxi/pi-openspec: could not install the openspec wrap script: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}

export const __test__ = {
	expandTilde,
	installShim,
	readShimSource,
	resolveAgentBinDir,
};
