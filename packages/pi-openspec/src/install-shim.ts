/**
 * Installs (or refreshes) the `openspec` wrap script in the agent's bin
 * directory. Runs as this package's `postinstall` hook on install and
 * update, and can also be run manually after a build: node dist/installShim.js
 *
 * The wrap script (src/openspec-shim.ts, built to dist/openspecShim.js) is a Node
 * script with a node shebang that locates the bundled @fission-ai/openspec CLI at run time —
 * no machine-specific paths are embedded — so it keeps working if the whole
 * agent directory moves to another machine. A file at the target location
 * that does not carry the managed marker is treated as user-managed and
 * left alone.
 *
 * The bundle built from this file (dist/installShim.js) is what the
 * `postinstall` hook runs: Node refuses to type-strip `.ts` files under
 * `node_modules`, and an installed package always lives there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = '@hyxi/pi-openspec';
const SHIM_NAME = 'openspec';
const SHEBANG = '#!/usr/bin/env node';
const MARKER_LINE = '// @pi-openspec-shim v1 — managed by @hyxi/pi-openspec; do not edit.';

const MANAGED_MARKER_RE = /^\/\/ @pi-openspec-shim v\d+ — managed by @hyxi\/pi-openspec; do not edit\.$/m;
const MARKER_LINE_RE = /^\/\/ @pi-openspec-shim v\d+ — managed by @hyxi\/pi-openspec; do not edit\.\n?/m;

function resolveShimSource(): string {
	// In the installed package the built shim sits next to this bundle.
	const built = join(import.meta.dirname, 'openspecShim.js');
	if (existsSync(built)) {
		return built;
	}
	// When run from source in this repository (src/), the artifact is one level up.
	return join(import.meta.dirname, '..', 'dist', 'openspecShim.js');
}

function readShimSource(): string {
	// The build output carries a license banner above the entry shebang, and the kernel only
	// honors a shebang on line 1, so the installer owns the final header.
	const built = readFileSync(resolveShimSource(), 'utf8');
	const body = built.replace(/#!.*\n/, '').replace(MARKER_LINE_RE, '');
	return SHEBANG + '\n' + MARKER_LINE + '\n' + body;
}

function expandTilde(path: string): string {
	if (path === '~') {
		return homedir();
	}
	if (path.startsWith('~/')) {
		return join(homedir(), path.slice(2));
	}
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

async function installShim(options: { binDir?: string } = {}): Promise<InstallShimResult> {
	const binDir = options.binDir ?? resolveAgentBinDir();
	const shimPath = join(binDir, SHIM_NAME);
	const source = readShimSource();
	try {
		const existing = await readFile(shimPath, 'utf8');
		if (existing === source) {
			return { path: shimPath, status: 'current' };
		}
		if (MANAGED_MARKER_RE.test(existing)) {
			await writeFile(shimPath, source, { mode: 0o755 });
			await chmod(shimPath, 0o755);
			return { path: shimPath, status: 'updated' };
		}
		return { path: shimPath, status: 'skipped-user-managed' };
	} catch {
		// No shim yet: install it below.
	}
	await mkdir(dirname(shimPath), { recursive: true });
	await writeFile(shimPath, source, { mode: 0o755 });
	await chmod(shimPath, 0o755);
	return { path: shimPath, status: 'installed' };
}

export const __test__ = {
	expandTilde,
	installShim,
	readShimSource,
	resolveAgentBinDir,
};

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	try {
		const result = await installShim();
		console.log(`${PACKAGE_NAME}: openspec wrap script ${result.status} at ${result.path}`);
	} catch (error) {
		// Never fail the package install over the wrap script.
		console.warn(
			`${PACKAGE_NAME}: could not install the openspec wrap script: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
