import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InstallationManifest, LifecycleContext, ToolchainDefinition } from '../catalog/types';
import { Catalog, catalog as defaultCatalog } from '../catalog/registry';
import { platformIdentity, supportsPlatform } from '../installation/platform';
import { normalizeProxyEnvironment } from '../installation/environment';
import { reconcileShims, removeOwnedShim, rollbackShimPublication } from '../routing/shim';
import { manifestHealth } from '../state/health';
import { assertSafeOwnedDeletion, manifestPath, readManifest, writeManifest } from '../state/manifests';
import { statePaths } from '../state/paths';
import { ensureToolkitRoot } from '../state/root-marker';
import { coordinate } from './coordinator';
import { withLease, withSharedLease } from './lock';
import { validateRemoval } from './dependency-graph';

export interface ProvisionerOptions {
	toolkitDirectory: string;
	agentDirectory: string;
	catalog?: Catalog;
	report?: (message: string) => void;
}
export class Provisioner {
	readonly catalog: Catalog;
	private readonly paths;
	private initialized = false;
	private readonly options: ProvisionerOptions;
	constructor(options: ProvisionerOptions) {
		this.options = options;
		this.catalog = options.catalog ?? defaultCatalog;
		this.paths = statePaths(options.toolkitDirectory);
	}
	private async initialize(): Promise<void> {
		if (this.initialized) return;
		const platform = await platformIdentity();
		await ensureToolkitRoot(
			this.paths.root,
			[homedir(), this.options.agentDirectory, join(this.options.agentDirectory, 'bin')],
			platform,
		);
		await Promise.all(
			[
				this.paths.bin,
				this.paths.installations,
				this.paths.state,
				this.paths.locks,
				this.paths.staging,
			].map((path) => mkdir(path, { recursive: true })),
		);
		this.initialized = true;
	}
	async manifests(): Promise<InstallationManifest[]> {
		const result: InstallationManifest[] = [];
		for (const definition of this.catalog.definitions) {
			const manifest = await readManifest(this.paths, definition.id);
			if (manifest) result.push(manifest);
		}
		return result;
	}
	async statuses(
		ids: readonly string[],
	): Promise<{ id: string; state: string; manifest: InstallationManifest | null; reason?: string }[]> {
		const results = [];
		for (const id of ids) {
			const definition = this.catalog.resolve(id);
			if (!definition) throw new Error(`unknown toolchain: ${id}`);
			if (!supportsPlatform(definition)) {
				results.push({
					id: definition.id,
					state: 'unsupported',
					manifest: null,
					reason: definition.officialInstallUrl,
				});
				continue;
			}
			const manifest = await readManifest(this.paths, definition.id);
			const filesystem = await manifestHealth(manifest);
			if (!manifest || filesystem.state !== 'healthy') {
				results.push({
					id: definition.id,
					state: filesystem.state,
					manifest: manifest ?? null,
					...(filesystem.reason ? { reason: filesystem.reason } : {}),
				});
				continue;
			}
			const probe = await definition.installer.probe(
				{
					layout: {
						toolkitDirectory: this.paths.root,
						installationDirectory: join(this.paths.installations, definition.id),
						binDirectory: this.paths.bin,
					},
					environment: normalizeProxyEnvironment(process.env),
					report: () => undefined,
				},
				manifest,
			);
			results.push({
				id: definition.id,
				state: probe.status,
				manifest,
				...(probe.status === 'degraded' || probe.status === 'missing' || probe.status === 'unsupported'
					? { reason: probe.reason }
					: {}),
			});
		}
		return results;
	}
	async ensure(ids: readonly string[], signal?: AbortSignal): Promise<InstallationManifest[]> {
		await this.initialize();
		const plan = this.catalog.topological(ids);
		const pending = new Map<string, Promise<InstallationManifest>>();
		for (const definition of plan) {
			const promise = Promise.all(definition.dependencies.map((id) => pending.get(id)!)).then(() =>
				coordinate(`ensure:${definition.id}`, signal, (shared) => this.mutate(definition, 'ensure', shared)),
			);
			pending.set(definition.id, promise);
		}
		return Promise.all(plan.map((definition) => pending.get(definition.id)!));
	}
	async lifecycle(
		id: string,
		action: 'install' | 'reinstall' | 'upgrade',
		signal?: AbortSignal,
	): Promise<InstallationManifest> {
		const definition = this.catalog.resolve(id);
		if (!definition) throw new Error(`unknown toolchain: ${id}`);
		if (!supportsPlatform(definition))
			throw Object.assign(
				new Error(
					`${definition.id} is unsupported on ${process.platform}/${process.arch}; ${definition.officialInstallUrl}`,
				),
				{ code: 'unsupported' },
			);
		await this.initialize();
		for (const dependency of this.catalog.topological(definition.dependencies))
			await this.mutate(dependency, 'ensure', signal);
		return this.mutate(definition, action, signal);
	}
	private async mutate(
		definition: ToolchainDefinition,
		action: 'ensure' | 'install' | 'reinstall' | 'upgrade',
		signal?: AbortSignal,
	): Promise<InstallationManifest> {
		if (!supportsPlatform(definition))
			throw Object.assign(
				new Error(
					`${definition.id} is unsupported on ${process.platform}/${process.arch}; ${definition.officialInstallUrl}`,
				),
				{ code: 'unsupported' },
			);
		return this.withMutationLeases(definition, signal, () =>
			this.validateDependencies(definition, signal, async () => {
				const final = join(this.paths.installations, definition.id);
				const prior = await readManifest(this.paths, definition.id);
				let finalExists = false;
				try {
					finalExists = (await lstat(final)).isDirectory();
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
				const filesystemHealth = await manifestHealth(prior);
				let healthy = filesystemHealth.state === 'healthy';
				if (healthy && prior) {
					const probe = await definition.installer.probe(
						{
							layout: {
								toolkitDirectory: this.paths.root,
								installationDirectory: final,
								binDirectory: this.paths.bin,
							},
							signal,
							environment: normalizeProxyEnvironment(process.env),
							report: this.options.report ?? (() => undefined),
						},
						prior,
					);
					healthy = probe.status === 'healthy';
				}
				if ((action === 'ensure' || action === 'install') && healthy && prior) {
					await reconcileShims(this.options.agentDirectory, prior.shimCommands);
					return prior;
				}
				if (action === 'upgrade' && !prior)
					throw new Error(`${definition.id} is not installed; run pi-toolchain install ${definition.id}`);
				const operation = crypto.randomUUID();
				const staging = join(this.paths.staging, operation);
				const candidate = join(staging, definition.id);
				const backup = join(this.paths.staging, `${operation}-previous`);
				await mkdir(candidate, { recursive: true });
				const context: LifecycleContext = {
					layout: {
						toolkitDirectory: this.paths.root,
						installationDirectory: candidate,
						binDirectory: this.paths.bin,
					},
					signal,
					environment: normalizeProxyEnvironment(process.env),
					report: this.options.report ?? (() => undefined),
				};
				let priorMoved = false;
				let promoted = false;
				let manifestWritten = false;
				let publishedCommands: readonly string[] = [];
				try {
					const result = prior
						? action === 'upgrade'
							? await definition.installer.upgrade(context, prior)
							: await definition.installer.reinstall(context, prior)
						: await definition.installer.install(context);
					if (prior && finalExists) {
						await rename(final, backup);
						priorMoved = true;
					}
					await rename(candidate, final);
					promoted = true;
					const rewrite = (value: string): string =>
						value.startsWith(candidate) ? `${final}${value.slice(candidate.length)}` : value;
					const now = new Date().toISOString();
					const manifest: InstallationManifest = {
						schemaVersion: 1,
						toolchainId: definition.id,
						definitionVersion: definition.definitionVersion,
						status: 'installed',
						platform: await platformIdentity(),
						installedAt: prior?.installedAt ?? now,
						updatedAt: now,
						...(result.resolvedVersion ? { resolvedVersion: result.resolvedVersion } : {}),
						components: result.components,
						dependencies: [...definition.dependencies],
						commands: result.commands.map((entry) => ({ ...entry, executable: rewrite(entry.executable) })),
						shimCommands: result.commands.map((entry) => entry.name),
						ownedPaths: result.ownedPaths.map(rewrite),
						sources: result.sources,
						installerKind: definition.installer.kind,
					};
					await writeManifest(this.paths, manifest);
					manifestWritten = true;
					await reconcileShims(this.options.agentDirectory, manifest.shimCommands);
					publishedCommands = manifest.shimCommands;
					await rm(backup, { recursive: true, force: true });
					await rm(staging, { recursive: true, force: true });
					return manifest;
				} catch (error) {
					try {
						await rollbackShimPublication(this.options.agentDirectory);
						for (const command of publishedCommands)
							if (!prior?.shimCommands.includes(command))
								await removeOwnedShim(this.options.agentDirectory, command);
						if (prior) await reconcileShims(this.options.agentDirectory, prior.shimCommands);
					} catch {}
					try {
						if (promoted) await rm(final, { recursive: true, force: true });
						if (priorMoved) await rename(backup, final);
						if (prior) await writeManifest(this.paths, prior);
						else if (manifestWritten) await rm(manifestPath(this.paths, definition.id), { force: true });
					} catch {}
					await rm(staging, { recursive: true, force: true });
					throw error;
				}
			}),
		);
	}
	private async validateDependencies<T>(
		definition: ToolchainDefinition,
		signal: AbortSignal | undefined,
		work: () => Promise<T>,
	): Promise<T> {
		for (const id of definition.dependencies) {
			const dependency = this.catalog.byId.get(id);
			if (!dependency) throw new Error(`missing dependency ${id}`);
			const manifest = await readManifest(this.paths, id);
			const health = await manifestHealth(manifest);
			if (!manifest || health.state !== 'healthy') throw new Error(`dependency ${id} is not healthy`);
			const probe = await dependency.installer.probe(
				{
					layout: {
						toolkitDirectory: this.paths.root,
						installationDirectory: join(this.paths.installations, id),
						binDirectory: this.paths.bin,
					},
					signal,
					environment: normalizeProxyEnvironment(process.env),
					report: this.options.report ?? (() => undefined),
				},
				manifest,
			);
			if (probe.status !== 'healthy') throw new Error(`dependency ${id} is degraded: ${probe.reason}`);
		}
		return work();
	}
	private async withMutationLeases<T>(
		definition: ToolchainDefinition,
		signal: AbortSignal | undefined,
		work: () => Promise<T>,
	): Promise<T> {
		const leases = [
			...definition.dependencies.map((id) => ({ id, mode: 'shared' as const })),
			{ id: definition.id, mode: 'exclusive' as const },
		].sort((left, right) => left.id.localeCompare(right.id));
		const acquire = async (index: number): Promise<T> => {
			const lease = leases[index];
			if (!lease) return work();
			const next = () => acquire(index + 1);
			return lease.mode === 'shared'
				? withSharedLease(this.paths.locks, lease.id, signal, 'dependent-install', next)
				: withLease(this.paths.locks, lease.id, signal, 'mutation', next);
		};
		return acquire(0);
	}
	async uninstall(ids: readonly string[], signal?: AbortSignal): Promise<string[]> {
		await this.initialize();
		const resolved = [
			...new Set(
				ids.map((id) => {
					const definition = this.catalog.resolve(id);
					if (!definition) throw new Error(`unknown toolchain: ${id}`);
					return definition.id;
				}),
			),
		];
		const orderedLeases = [...resolved].sort();
		const removed: string[] = [];
		const acquire = async (index: number): Promise<void> => {
			const id = orderedLeases[index];
			if (id) return withLease(this.paths.locks, id, signal, 'uninstall', () => acquire(index + 1));
			const installed = (await this.manifests()).map((entry) => entry.toolchainId);
			const order = validateRemoval(this.catalog, installed, resolved);
			for (const target of order) {
				const definition = this.catalog.byId.get(target);
				if (!definition) throw new Error(`unknown toolchain: ${target}`);
				const manifest = await readManifest(this.paths, target);
				if (!manifest) continue;
				const final = join(this.paths.installations, target);
				for (const path of manifest.ownedPaths) {
					try {
						await assertSafeOwnedDeletion(this.paths, target, path);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
					}
				}
				await definition.installer.uninstall(
					{
						layout: {
							toolkitDirectory: this.paths.root,
							installationDirectory: final,
							binDirectory: this.paths.bin,
						},
						signal,
						environment: normalizeProxyEnvironment(process.env),
						report: this.options.report ?? (() => undefined),
					},
					manifest,
				);
				for (const command of manifest.shimCommands)
					await removeOwnedShim(this.options.agentDirectory, command);
				for (const path of [...manifest.ownedPaths].sort((a, b) => b.length - a.length)) {
					try {
						await assertSafeOwnedDeletion(this.paths, target, path);
						await rm(path, { recursive: true, force: true });
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
					}
				}
				await rm(manifestPath(this.paths, target), { force: true });
				removed.push(target);
			}
		};
		await acquire(0);
		return removed;
	}
}
