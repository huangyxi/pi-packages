export type ToolchainId = string;
export type CommandName = string;

export interface PlatformIdentity {
	platform: NodeJS.Platform;
	architecture: string;
	libc?: 'glibc' | 'musl' | 'unknown';
}

export interface PlatformSupport {
	platform: NodeJS.Platform;
	architectures: readonly string[];
}

export interface ManagedLayout {
	toolkitDirectory: string;
	installationDirectory: string;
	binDirectory: string;
}

export interface CommandDefinition {
	name: CommandName;
	versionArgs: readonly string[];
	optional?: boolean;
	executableLocations(layout: ManagedLayout): readonly string[];
}

export interface ComponentVersion {
	name: string;
	version: string;
}
export interface SourceAudit {
	url: string;
	sha256?: string;
	authenticated: boolean;
}
export interface OwnedCommand {
	name: string;
	executable: string;
}

export interface InstallationManifest {
	schemaVersion: 1;
	toolchainId: string;
	definitionVersion: number;
	status: 'installed' | 'degraded';
	platform: PlatformIdentity;
	installedAt: string;
	updatedAt: string;
	requestedVersion?: string;
	resolvedVersion?: string;
	components: ComponentVersion[];
	dependencies: string[];
	commands: OwnedCommand[];
	shimCommands: string[];
	ownedPaths: string[];
	sources: SourceAudit[];
	installerKind: string;
}

export type ProbeResult =
	| { status: 'healthy'; components: ComponentVersion[] }
	| { status: 'missing' | 'degraded'; reason: string }
	| { status: 'unsupported'; reason: string };

export interface InstallResult {
	resolvedVersion?: string;
	components: ComponentVersion[];
	commands: OwnedCommand[];
	ownedPaths: string[];
	sources: SourceAudit[];
}

export interface LifecycleContext {
	layout: ManagedLayout;
	signal?: AbortSignal | undefined;
	environment: NodeJS.ProcessEnv;
	report(message: string): void;
}

export interface InstallerStrategy {
	kind: string;
	install(context: LifecycleContext): Promise<InstallResult>;
	reinstall(context: LifecycleContext, current: InstallationManifest): Promise<InstallResult>;
	upgrade(context: LifecycleContext, current: InstallationManifest): Promise<InstallResult>;
	uninstall(context: LifecycleContext, current: InstallationManifest): Promise<void>;
	probe(context: LifecycleContext, current?: InstallationManifest): Promise<ProbeResult>;
}

export interface ToolchainDefinition {
	id: ToolchainId;
	definitionVersion: number;
	displayName: string;
	description: string;
	commands: readonly CommandDefinition[];
	dependencies: readonly ToolchainId[];
	hostPrerequisites: readonly string[];
	officialInstallUrl: string;
	platforms: readonly PlatformSupport[];
	installer: InstallerStrategy;
}
