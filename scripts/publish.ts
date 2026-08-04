import { execFile as execFileCallback, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npmAuthEnvironmentKey = 'npm_config_//registry.npmjs.org/:_authToken';

interface PackageManifest {
	name: string;
	version: string;
	private?: boolean;
	scripts?: Record<string, unknown>;
}

interface PublishOptions {
	packageName?: string;
	npmToken?: string;
	yes: boolean;
	help: boolean;
}

interface PackResult {
	filename: string;
}

function printHelp(): void {
	console.log(`Usage: pnpm publish:package <package-name> [options]

Clean, validate, pack, smoke-test, and stage one existing workspace package for npm approval.

Stages:
  clean    Remove all Git-ignored files and directories inside the package.
  check    Run the package check script.
  build    Run the package build script.
  pack     Create an npm tarball explicitly.
  smoke    Run the package smoke script.
  stage    Run npm stage publish; approval is a separate npm stage approve step.

Arguments:
  package-name         A package directory name such as pi-envguard. The script resolves it under packages/.

Options:
  --npm-token <token>  npm access token. Prefer NPM_TOKEN or NODE_AUTH_TOKEN.
  --yes                Create and approve the staged package for live publication.

Without --yes, the final npm stage publish runs with --dry-run.
  -h, --help           Show this help.

Examples:
  pnpm publish:package pi-envguard
  NPM_TOKEN=... pnpm publish:package pi-envguard
  pnpm publish:package pi-envguard --npm-token <token>

After a dry-run, rerun with --yes to create the real staged package and approve it for live publication.
`);
}

function parseOptions(arguments_: readonly string[]): PublishOptions {
	const options: PublishOptions = { yes: false, help: false };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (!argument) continue;
		if (argument === '--help' || argument === '-h') {
			options.help = true;
			continue;
		}
		if (argument === '--yes') {
			options.yes = true;
			continue;
		}
		if (argument === '--npm-token' || argument === '--npm-token=') {
			const value = argument === '--npm-token' ? arguments_[++index] : '';
			if (!value?.trim() || value.startsWith('-')) throw new Error('--npm-token requires a non-empty value.');
			options.npmToken = value;
			continue;
		}
		if (argument.startsWith('--npm-token=')) {
			const value = argument.slice('--npm-token='.length);
			if (!value.trim()) throw new Error('--npm-token requires a non-empty value.');
			options.npmToken = value;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
		if (options.packageName) throw new Error('Only one package name may be provided.');
		options.packageName = argument;
	}
	return options;
}
function isPackageManifest(value: unknown): value is PackageManifest {
	return (
		value !== null &&
		typeof value === 'object' &&
		'name' in value &&
		typeof value.name === 'string' &&
		'version' in value &&
		typeof value.version === 'string'
	);
}

function resolvePackageDirectory(packageName: string): string {
	if (packageName.includes('/') || packageName.includes('\\')) {
		throw new Error(`Use a package name such as pi-envguard, not a path: ${packageName}`);
	}
	const packageDirectory = resolve(root, 'packages', packageName);
	const relativeDirectory = relative(root, packageDirectory);
	if (!relativeDirectory || relativeDirectory.startsWith('..') || isAbsolute(relativeDirectory)) {
		throw new Error(`Invalid package name: ${packageName}`);
	}
	return packageDirectory;
}

async function readPackageManifest(packageDirectory: string): Promise<PackageManifest> {
	const manifestPath = join(packageDirectory, 'package.json');
	let manifest: unknown;
	try {
		manifest = JSON.parse(await readFile(manifestPath, { encoding: 'utf8' }));
	} catch (error) {
		throw new Error(`Could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isPackageManifest(manifest)) throw new Error(`${manifestPath} must contain a name and version.`);
	if (manifest.private) throw new Error(`${manifest.name} is private and cannot be published.`);
	for (const script of ['check', 'build', 'smoke']) {
		if (typeof manifest.scripts?.[script] !== 'string') {
			throw new Error(`${manifest.name} must define a ${script} script.`);
		}
	}
	return manifest;
}

function commandName(command: string): string {
	return process.platform === 'win32' ? `${command}.cmd` : command;
}

function run(command: string, arguments_: readonly string[], cwd: string, env = process.env): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(commandName(command), arguments_, { cwd, env, stdio: 'inherit' });
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			const exitDescription = signal
				? ` with ${signal}`
				: ` with exit code ${code === null ? 'unknown' : String(code)}`;
			reject(new Error(`${command} ${arguments_.join(' ')} failed${exitDescription}.`));
		});
	});
}

async function cleanIgnoredFiles(packageDirectory: string, env: NodeJS.ProcessEnv): Promise<void> {
	const packagePath = relative(root, packageDirectory).split(sep).join('/');
	console.log(`Cleaning Git-ignored files under ${packagePath}.`);
	await run(
		'git',
		[
			'clean',
			'-fdX',
			'--',
			packagePath,
		],
		root,
		env,
	);
}

function environmentWithoutNpmCredentials(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...process.env };
	delete environment.NPM_TOKEN;
	delete environment.NODE_AUTH_TOKEN;
	Reflect.deleteProperty(environment, npmAuthEnvironmentKey);
	return environment;
}

function tokenFrom(options: PublishOptions, required: boolean): string | undefined {
	const token = options.npmToken ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
	if (!token?.trim() && required) {
		throw new Error('An npm token is required for --yes. Use --npm-token, NPM_TOKEN, or NODE_AUTH_TOKEN.');
	}
	return token;
}

function execFileText(command: string, arguments_: readonly string[], cwd: string, env = process.env): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFileCallback(
			commandName(command),
			arguments_,
			{ cwd, env, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
			(error, stdout, stderr) => {
				if (error) {
					const detail = stderr.trim();
					reject(new Error(detail || (error instanceof Error ? error.message : `${command} failed.`)));
					return;
				}
				resolvePromise(stdout);
			},
		);
	});
}

function isPackResult(value: unknown): value is PackResult {
	return value !== null && typeof value === 'object' && 'filename' in value && typeof value.filename === 'string';
}

async function packPackage(packageDirectory: string, env: NodeJS.ProcessEnv): Promise<string> {
	const output = await execFileText('npm', ['pack', '--json'], packageDirectory, env);
	let parsed: unknown;
	try {
		parsed = JSON.parse(output) as unknown;
	} catch {
		throw new Error(`npm pack returned invalid JSON:\n${output}`);
	}
	const firstResult: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : undefined;
	if (!isPackResult(firstResult)) throw new Error('npm pack did not return a tarball filename.');
	const tarballPath = join(packageDirectory, firstResult.filename);
	console.log(`Created ${tarballPath}`);
	return tarballPath;
}

function findStageId(value: unknown): string | undefined {
	if (value === null || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.stageId === 'string') return record.stageId;
	for (const child of Object.values(record)) {
		const stageId = findStageId(child);
		if (stageId) return stageId;
	}
	return undefined;
}

async function stagePackage(
	packageDirectory: string,
	tarballPath: string,
	publishEnvironment: NodeJS.ProcessEnv,
	dryRun: boolean,
): Promise<string | undefined> {
	const arguments_ = [
		'stage',
		'publish',
		tarballPath,
		'--json',
		'--registry=https://registry.npmjs.org/',
	];
	if (dryRun) arguments_.push('--dry-run');
	const output = await execFileText('npm', arguments_, packageDirectory, publishEnvironment);
	if (dryRun) {
		console.log('npm stage publish completed in dry-run mode.');
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(output) as unknown;
	} catch {
		throw new Error(`npm stage publish returned invalid JSON:\n${output}`);
	}
	const stageId = findStageId(parsed);
	if (!stageId) throw new Error(`npm stage publish did not return a stage ID:\n${output}`);
	console.log(`Created npm stage ${stageId}.`);
	return stageId;
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}
	if (!options.packageName) throw new Error('A package name is required. Use --help for usage.');

	const packageDirectory = resolvePackageDirectory(options.packageName);
	const manifest = await readPackageManifest(packageDirectory);
	const packageEnvironment = environmentWithoutNpmCredentials();
	const token = tokenFrom(options, options.yes);
	console.log(`Staging ${manifest.name}@${manifest.version} from ${packageDirectory}`);

	await cleanIgnoredFiles(packageDirectory, packageEnvironment);
	await run('pnpm', ['check'], packageDirectory, packageEnvironment);
	await run('pnpm', ['build'], packageDirectory, packageEnvironment);
	const tarballPath = await packPackage(packageDirectory, packageEnvironment);
	await run('pnpm', ['smoke'], packageDirectory, packageEnvironment);

	const publishEnvironment: NodeJS.ProcessEnv = { ...packageEnvironment };
	if (token) publishEnvironment[npmAuthEnvironmentKey] = token;
	const stageId = await stagePackage(packageDirectory, tarballPath, publishEnvironment, !options.yes);
	if (!options.yes) {
		console.log('Dry run complete. Re-run with --yes to stage and approve the live publication.');
		return;
	}
	if (!stageId) throw new Error('Cannot approve a dry-run stage.');
	await run(
		'npm',
		[
			'stage',
			'approve',
			stageId,
			'--registry=https://registry.npmjs.org/',
		],
		packageDirectory,
		publishEnvironment,
	);
}

main().catch((error: unknown) => {
	console.error(`Publish failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
