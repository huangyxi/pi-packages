import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { InstallationManifest } from '../catalog/types';
import { atomicWriteJson, readJson } from './json';
import { assertContained, type StatePaths } from './paths';

const commandName = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const toolchainId = /^[a-z0-9][a-z0-9-]*$/;

export function manifestPath(paths: StatePaths, id: string): string {
	if (!toolchainId.test(id)) throw new Error(`invalid toolchain id: ${id}`);
	return join(paths.state, `${id}.json`);
}

function isStrictChild(root: string, candidate: string): boolean {
	const rel = relative(resolve(root), resolve(candidate));
	return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function validateManifestPaths(paths: StatePaths, manifest: InstallationManifest): void {
	const installationRoot = join(paths.installations, manifest.toolchainId);
	if (manifest.ownedPaths.length === 0) throw new Error('installation manifest has no owned paths');
	for (const owned of manifest.ownedPaths) {
		if (typeof owned !== 'string' || !isAbsolute(owned) || resolve(owned) !== owned)
			throw new Error(`invalid owned path: ${owned}`);
		assertContained(paths.root, owned);
		if (!(resolve(owned) === resolve(installationRoot) || isStrictChild(installationRoot, owned)))
			throw new Error(`owned path is outside the toolchain installation: ${owned}`);
	}
	for (const command of manifest.commands) {
		if (
			!commandName.test(command.name) ||
			!isAbsolute(command.executable) ||
			resolve(command.executable) !== command.executable
		)
			throw new Error(`invalid managed command metadata: ${command.name}`);
		assertContained(paths.root, command.executable);
		if (!manifest.ownedPaths.some((owned) => isStrictChild(owned, command.executable)))
			throw new Error(`managed executable is outside owned paths: ${command.executable}`);
	}
	if (
		manifest.dependencies.some((id) => !toolchainId.test(id)) ||
		new Set(manifest.dependencies).size !== manifest.dependencies.length
	)
		throw new Error('invalid dependencies in installation manifest');
	if (
		manifest.shimCommands.some((name) => !commandName.test(name)) ||
		new Set(manifest.shimCommands).size !== manifest.shimCommands.length ||
		manifest.shimCommands.some((name) => !manifest.commands.some((command) => command.name === name))
	)
		throw new Error('invalid shim commands in installation manifest');
}

export async function readManifest(paths: StatePaths, id: string): Promise<InstallationManifest | undefined> {
	const value = await readJson(manifestPath(paths, id));
	if (value === undefined) return undefined;
	if (!isManifest(value) || value.toolchainId !== id) throw new Error(`invalid installation manifest for ${id}`);
	validateManifestPaths(paths, value);
	return value;
}
export async function writeManifest(paths: StatePaths, manifest: InstallationManifest): Promise<void> {
	if (!isManifest(manifest)) throw new Error('invalid installation manifest');
	validateManifestPaths(paths, manifest);
	await atomicWriteJson(manifestPath(paths, manifest.toolchainId), manifest);
}

/** Revalidate an owned path against the physical toolkit root immediately before recursive deletion. */
export async function assertSafeOwnedDeletion(
	paths: StatePaths,
	toolchainIdValue: string,
	candidate: string,
): Promise<void> {
	const expected = join(paths.installations, toolchainIdValue);
	if (!(resolve(candidate) === resolve(expected) || isStrictChild(expected, candidate)))
		throw new Error(`refusing to delete non-toolchain path: ${candidate}`);
	const stat = await lstat(candidate);
	if (stat.isSymbolicLink()) throw new Error(`refusing to delete symlink-owned path: ${candidate}`);
	const [physicalRoot, physicalCandidate] = await Promise.all([realpath(paths.root), realpath(candidate)]);
	if (!isStrictChild(physicalRoot, physicalCandidate))
		throw new Error(`owned path escapes physical toolkit root: ${candidate}`);
	const controlPaths = [
		paths.bin,
		paths.state,
		paths.locks,
		paths.staging,
		paths.marker,
		paths.root,
	];
	if (controlPaths.some((control) => resolve(candidate) === resolve(control) || isStrictChild(candidate, control)))
		throw new Error(`refusing to delete toolkit control path: ${candidate}`);
}

function stringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function isManifest(value: unknown): value is InstallationManifest {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Partial<InstallationManifest>;
	return (
		v.schemaVersion === 1 &&
		typeof v.toolchainId === 'string' &&
		toolchainId.test(v.toolchainId) &&
		typeof v.definitionVersion === 'number' &&
		Number.isInteger(v.definitionVersion) &&
		(v.status === 'installed' || v.status === 'degraded') &&
		v.platform !== undefined &&
		typeof v.platform.platform === 'string' &&
		typeof v.platform.architecture === 'string' &&
		typeof v.installedAt === 'string' &&
		typeof v.updatedAt === 'string' &&
		Array.isArray(v.components) &&
		v.components.every((entry) => typeof entry?.name === 'string' && typeof entry.version === 'string') &&
		stringArray(v.dependencies) &&
		Array.isArray(v.commands) &&
		v.commands.every((entry) => typeof entry?.name === 'string' && typeof entry.executable === 'string') &&
		stringArray(v.shimCommands) &&
		stringArray(v.ownedPaths) &&
		Array.isArray(v.sources) &&
		v.sources.every((entry) => typeof entry?.url === 'string' && typeof entry.authenticated === 'boolean') &&
		typeof v.installerKind === 'string'
	);
}
