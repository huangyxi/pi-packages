// @pi-openspec-shim v1 — managed by @hyxi/pi-openspec; do not edit.
// Runs the @fission-ai/openspec CLI bundled with the pi-openspec package.
// The CLI is located at run time so the script survives the agent
// directory moving to another machine.
//
// This file is a build entry (dist/openspecShim.js), compiled to plain JS
// because the installed bin script is extensionless (Node only type-strips
// .ts files). The installer writes the final header (node shebang + marker)
// when it copies the artifact into the agent's bin directory.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_NAME = '@hyxi/pi-openspec';

/**
 * npm's default global install location, or undefined when it cannot be
 * determined.
 */
function npmGlobalRoot() {
	try {
		return join(execFileSync('npm', ['prefix', '--global'], { encoding: 'utf8' }).trim(), 'lib');
	} catch {
		return undefined;
	}
}

interface Settings {
	name?: string;
	packages?: string | { source?: string }[];
}

interface PackageJson {
	name?: string;
}

/**
 * Yields the package roots recorded in pi's settings for local-path
 * installs — pi never runs npm for those, so the bundled CLI sits under
 * the registered path instead of an npm root.
 *
 * @generator Yields each matching package directory in order.
 */
function* settingsPackageRoots() {
	const override = process.env.PI_CODING_AGENT_DIR;
	const agentDir =
		override === undefined || override === ''
			? join(homedir(), '.pi', 'agent')
			: override.startsWith('~/')
				? join(homedir(), override.slice(2))
				: override;
	const settingsFiles = [join(agentDir, 'settings.json'), join(process.cwd(), '.pi', 'settings.json')];
	for (const file of settingsFiles) {
		let settings: Settings | undefined = undefined;
		try {
			settings = JSON.parse(readFileSync(file, 'utf8')) as Settings;
		} catch {
			continue;
		}
		if (typeof settings !== 'object') {
			continue;
		}
		for (const entry of settings.packages ?? []) {
			const source = typeof entry === 'string' ? entry : entry.source;
			if (typeof source !== 'string' || source.startsWith('npm:') || source.startsWith('git:')) {
				continue;
			}
			const packageDir = source.startsWith('~/')
				? join(homedir(), source.slice(2))
				: isAbsolute(source)
					? source
					: join(dirname(file), source);
			try {
				const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageJson;
				if (packageJson.name === PACKAGE_NAME) {
					yield packageDir;
				}
			} catch {
				// Not a package directory (e.g. a bare npm spec).
			}
		}
	}
}

/**
 * Yields the directories whose node_modules trees are searched for the
 * bundled CLI. The npm global root and the settings roots run last, so
 * their lookups only happen when the other roots did not resolve.
 *
 * @generator Yields each search root in order.
 */
function* searchRoots() {
	yield join(import.meta.dirname, '..', 'npm');
	yield join(process.cwd(), '.pi', 'npm');
	yield process.cwd();
	const globalRoot = npmGlobalRoot();
	if (globalRoot !== undefined) {
		yield globalRoot;
	}
	yield* settingsPackageRoots();
}

const searched = [];
let bin;
for (const root of searchRoots()) {
	searched.push(root);
	try {
		const entry = createRequire(join(root, 'index.js')).resolve('@fission-ai/openspec');
		bin = join(dirname(dirname(entry)), 'bin', 'openspec.js');
		break;
	} catch {
		// Try the next search root.
	}
}
if (bin === undefined) {
	console.error(`openspec: bundled @fission-ai/openspec not found (searched: ${searched.join(', ')})`);
	process.exit(127);
}
await import(pathToFileURL(bin).href);
process.exit(process.exitCode ?? 0);
