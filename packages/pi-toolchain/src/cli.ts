import { access, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { catalog } from './catalog/registry';
import { readToolchainConfig } from './config';
import { EXIT_CODES, sanitizeDiagnostic, ToolchainError } from './output/diagnostics';
import { failure, success } from './output/json';
import { Provisioner } from './provisioning/provisioner';
import { findSystemCommand } from './routing/executable-resolver';
import { dispatchExecutable } from './routing/run';
import { managedEnvironment } from './installation/environment';
import { runProcess } from './installation/process';
import { manifestHealth } from './state/health';
import type { InstallationManifest, ToolchainDefinition } from './catalog/types';

const HELP = `pi-toolchain - user-space toolchain provisioning

Usage:
  pi-toolchain install <name>... [--timeout <seconds>] [--json]
  pi-toolchain upgrade [<name>...] [--timeout <seconds>] [--json]
  pi-toolchain reinstall <name>... [--timeout <seconds>] [--json]
  pi-toolchain uninstall <name>... [--timeout <seconds>] [--json]
  pi-toolchain list [--json]
  pi-toolchain status [<name>...] [--json]
  pi-toolchain show <name> [--json]
  pi-toolchain help [command]

Exit codes: 0 success, 2 usage/config, 3 unsupported, 4 dependency conflict,
5 deadline, 6 lifecycle/probe, 7 ownership, 130 cancellation.`;
interface Parsed {
	command: string;
	names: string[];
	json: boolean;
	timeout?: number;
}
function parse(args: string[]): Parsed {
	const delimiterIndex = args.indexOf('--');
	const optionLimit = delimiterIndex < 0 ? args.length : delimiterIndex;
	const jsonIndex = args.findIndex((value, index) => index < optionLimit && value === '--json');
	const json = jsonIndex >= 0;
	if (json) args.splice(jsonIndex, 1);
	let timeout: number | undefined;
	const updatedDelimiter = args.indexOf('--');
	const timeoutIndex = args.findIndex(
		(value, index) => index < (updatedDelimiter < 0 ? args.length : updatedDelimiter) && value === '--timeout',
	);
	if (timeoutIndex >= 0) {
		const raw = args[timeoutIndex + 1];
		timeout = Number(raw);
		if (raw === undefined || !Number.isFinite(timeout) || !Number.isInteger(timeout) || timeout < 0)
			throw new ToolchainError('usage', '--timeout must be a nonnegative integer');
		args.splice(timeoutIndex, 2);
	}
	return { command: args.shift() ?? 'help', names: args, json, ...(timeout === undefined ? {} : { timeout }) };
}
async function main(argv: string[]): Promise<number> {
	let parsed: Parsed;
	try {
		parsed = parse([...argv]);
	} catch (error) {
		const delimiter = argv.indexOf('--');
		const json = argv.some((value, index) => value === '--json' && (delimiter < 0 || index < delimiter));
		return outputError({ command: argv[0] ?? 'help', names: [], json }, error);
	}
	const warnings: string[] = [];
	let config;
	try {
		config = await readToolchainConfig((message) => warnings.push(message));
	} catch (error) {
		return outputError(parsed, new ToolchainError('usage', sanitizeDiagnostic(error)));
	}
	for (const warning of warnings) console.error(`pi-toolchain: ${warning}`);
	const controller = new AbortController();
	const timer =
		parsed.timeout && parsed.timeout > 0
			? setTimeout(() => {
					controller.abort(new ToolchainError('deadline', 'deadline expired'));
				}, parsed.timeout * 1000)
			: undefined;
	const interrupt = (): void => {
		controller.abort(new ToolchainError('cancelled', 'cancelled'));
	};
	process.once('SIGINT', interrupt);
	const service = new Provisioner({
		...config,
		report: (message) => {
			console.error(`pi-toolchain: ${message}`);
		},
	});
	try {
		let data: unknown;
		switch (parsed.command) {
			case 'help':
				data = { usage: HELP };
				if (!parsed.json) {
					console.log(HELP);
					return 0;
				}
				break;
			case 'list':
				data = {
					toolchains: await Promise.all(
						catalog.definitions.map(async (definition) => ({
							id: definition.id,
							description: definition.description,
							commands: definition.commands.map((entry) => entry.name),
							dependencies: definition.dependencies,
							installed: (await service.manifests()).some((entry) => entry.toolchainId === definition.id),
						})),
					),
				};
				break;
			case 'status': {
				const manifests = await service.manifests();
				const selected = parsed.names.length
					? parsed.names.map(resolveName)
					: manifests.map((entry) => entry.toolchainId);
				data = { toolchains: await service.statuses(selected) };
				break;
			}
			case 'show': {
				if (parsed.names.length !== 1) throw new ToolchainError('usage', 'show requires one name');
				const definition = catalog.resolve(parsed.names[0]!);
				if (!definition) throw new ToolchainError('usage', `unknown toolchain: ${parsed.names[0]}`);
				const [manifest, status] = await Promise.all([
					service
						.manifests()
						.then((manifests) => manifests.find((entry) => entry.toolchainId === definition.id)),
					service.statuses([definition.id]).then((statuses) => statuses[0]),
				]);
				data = {
					...definition,
					installer: { kind: definition.installer.kind },
					commands: definition.commands.map((entry) => ({
						name: entry.name,
						versionArgs: entry.versionArgs,
						optional: entry.optional ?? false,
					})),
					status,
					installation: manifest ?? null,
					recovery: manifest
						? [`pi-toolchain reinstall ${definition.id}`, `pi-toolchain uninstall ${definition.id}`]
						: [`pi-toolchain install ${definition.id}`],
				};
				break;
			}
			case 'install':
			case 'reinstall': {
				if (parsed.names.length === 0)
					throw new ToolchainError('usage', `${parsed.command} requires at least one name`);
				const results = [];
				for (const name of parsed.names) {
					const id = resolveName(name);
					const prior = (await service.manifests()).find((entry) => entry.toolchainId === id);
					const manifest = await service.lifecycle(name, parsed.command, controller.signal);
					results.push({
						...manifest,
						requestedAction: parsed.command,
						finalAction:
							parsed.command === 'install' && prior
								? prior.updatedAt === manifest.updatedAt
									? 'no-op'
									: 'repair'
								: parsed.command,
						priorState: prior?.status ?? 'missing',
						finalState: manifest.status,
						versions: { requested: manifest.requestedVersion, resolved: manifest.resolvedVersion },
						diagnostics: [],
					});
				}
				data = { results };
				break;
			}
			case 'upgrade': {
				const names = parsed.names.length
					? parsed.names
					: (await service.manifests()).map((entry) => entry.toolchainId);
				const results = [];
				for (const name of names) {
					const manifest = await service.lifecycle(name, 'upgrade', controller.signal);
					results.push({
						...manifest,
						requestedAction: 'upgrade',
						finalAction: 'upgrade',
						priorState: 'installed',
						finalState: manifest.status,
						versions: { requested: manifest.requestedVersion, resolved: manifest.resolvedVersion },
						diagnostics: [],
					});
				}
				data = { results };
				break;
			}
			case 'uninstall': {
				if (parsed.names.length === 0)
					throw new ToolchainError('usage', 'uninstall requires at least one name');
				const removed = await service.uninstall(parsed.names, controller.signal);
				data = {
					removed,
					results: removed.map((toolchainId) => ({
						toolchainId,
						requestedAction: 'uninstall',
						finalAction: 'uninstall',
						priorState: 'installed',
						finalState: 'missing',
						diagnostics: [],
					})),
				};
				break;
			}
			case 'run': {
				const delimiter = parsed.names.indexOf('--');
				if (delimiter !== 1) throw new ToolchainError('usage', 'run requires: run <command> -- <args...>');
				const command = parsed.names[0]!;
				const definition = catalog.byCommand.get(command);
				if (!definition) throw new ToolchainError('usage', `unknown managed command: ${command}`);
				const manifests = await service.manifests();
				const manifest = manifests.find((entry) => entry.toolchainId === definition.id);
				const managedProbe = await probeManagedCommand(
					definition,
					manifest,
					command,
					config.toolkitDirectory,
					controller.signal,
				);
				const system = await findSystemCommand(command, process.env.PATH, [
					config.agentDirectory,
					config.toolkitDirectory,
				]);
				const commandDefinition = definition.commands.find((entry) => entry.name === command)!;
				const systemHealthy = system
					? await runProcess(system, commandDefinition.versionArgs, {
							signal: controller.signal,
							timeoutMs: 5000,
						})
							.then((result) => result.code === 0)
							.catch(() => false)
					: false;
				if (manifest && !managedProbe.executable)
					console.error(
						`pi-toolchain: managed ${command} is degraded: ${managedProbe.reason}; repair: pi-toolchain reinstall ${definition.id}`,
					);
				const managed = managedProbe.executable;
				const healthySystem = systemHealthy ? system : undefined;
				const executable =
					config.toolResolutionOrder === 'managed-first'
						? (managed ?? healthySystem)
						: (healthySystem ?? managed);
				if (!executable)
					throw new ToolchainError('lifecycle', `${command} is unavailable`, definition.id, [
						`pi-toolchain install ${definition.id}`,
					]);
				return await dispatchExecutable(
					executable,
					parsed.names.slice(2),
					managedEnvironment(process.env, manifests, config.toolkitDirectory),
				);
			}
			default:
				throw new ToolchainError('usage', `unknown command: ${parsed.command}`);
		}
		if (parsed.json) console.log(JSON.stringify(success(parsed.command, data)));
		else if (parsed.command !== 'help') console.log(JSON.stringify(data, null, 2));
		return 0;
	} catch (error) {
		return outputError(parsed, error);
	} finally {
		if (timer) clearTimeout(timer);
		process.removeListener('SIGINT', interrupt);
	}
}
function strictChild(root: string, candidate: string): boolean {
	const rel = relative(resolve(root), resolve(candidate));
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function probeManagedCommand(
	definition: ToolchainDefinition,
	manifest: InstallationManifest | undefined,
	command: string,
	toolkitDirectory: string,
	signal: AbortSignal,
): Promise<{ executable?: string; reason?: string }> {
	if (!manifest) return { reason: 'not installed' };
	const health = await manifestHealth(manifest);
	if (health.state !== 'healthy') return { reason: health.reason ?? health.state };
	const final = join(resolve(toolkitDirectory), 'installations', definition.id);
	const owned = manifest.commands.find((entry) => entry.name === command);
	const commandDefinition = definition.commands.find((entry) => entry.name === command);
	if (!owned || !commandDefinition) return { reason: 'command is absent from registered metadata' };
	const expected = commandDefinition.executableLocations({
		toolkitDirectory: resolve(toolkitDirectory),
		installationDirectory: final,
		binDirectory: join(resolve(toolkitDirectory), 'bin'),
	});
	if (!expected.some((location) => resolve(location) === resolve(owned.executable)))
		return { reason: 'executable location is not registered' };
	try {
		const stat = await lstat(owned.executable);
		if (stat.isDirectory()) return { reason: 'registered executable is a directory' };
		await access(owned.executable, 1);
		const [physicalRoot, physicalExecutable] = await Promise.all([realpath(final), realpath(owned.executable)]);
		if (!strictChild(physicalRoot, physicalExecutable))
			return { reason: 'executable escapes installation ownership' };
		const context = {
			layout: {
				toolkitDirectory: resolve(toolkitDirectory),
				installationDirectory: final,
				binDirectory: join(resolve(toolkitDirectory), 'bin'),
			},
			signal,
			environment: managedEnvironment(process.env, [manifest], toolkitDirectory),
			report: () => undefined,
		};
		const installationProbe = await definition.installer.probe(context, manifest);
		if (installationProbe.status !== 'healthy') return { reason: installationProbe.reason };
		const requestedProbe = await runProcess(owned.executable, commandDefinition.versionArgs, {
			signal,
			environment: context.environment,
			timeoutMs: 5000,
		});
		return requestedProbe.code === 0
			? { executable: owned.executable }
			: { reason: requestedProbe.stderr || 'requested command probe failed' };
	} catch (error) {
		return { reason: sanitizeDiagnostic(error) };
	}
}

function resolveName(name: string): string {
	const definition = catalog.resolve(name);
	if (!definition) throw new ToolchainError('usage', `unknown toolchain: ${name}`);
	return definition.id;
}
function outputError(parsed: Parsed, value: unknown): number {
	const error =
		value instanceof ToolchainError
			? value
			: value instanceof Error && (value as Error & { code?: string }).code === 'unsupported'
				? new ToolchainError('unsupported', value.message)
				: new ToolchainError(
						value instanceof Error && value.message.includes('dependent')
							? 'dependencyConflict'
							: value instanceof Error && /foreign|ownership|marker|root/.test(value.message)
								? 'ownership'
								: 'lifecycle',
						sanitizeDiagnostic(value),
					);
	if (parsed.json)
		console.log(
			JSON.stringify(
				failure(parsed.command, {
					code: error.code,
					message: error.message,
					...(error.toolchainId ? { toolchainId: error.toolchainId } : {}),
					...(error.recovery.length ? { recovery: error.recovery } : {}),
				}),
			),
		);
	else console.error(`pi-toolchain: ${error.message}`);
	return EXIT_CODES[error.code];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
	process.exitCode = await main(process.argv.slice(2));
export { main };
