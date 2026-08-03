import { isAbsolute, normalize } from 'node:path';
import { builtins } from './builtins';
import type { ToolchainDefinition } from './types';

export class Catalog {
	readonly byId = new Map<string, ToolchainDefinition>();
	readonly byCommand = new Map<string, ToolchainDefinition>();
	readonly definitions: readonly ToolchainDefinition[];
	constructor(definitions: readonly ToolchainDefinition[]) {
		this.definitions = definitions;
		for (const definition of definitions) {
			if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id) || this.byId.has(definition.id))
				throw new Error(`duplicate or invalid toolchain id: ${definition.id}`);
			if (!definition.officialInstallUrl.startsWith('https://'))
				throw new Error(`invalid official URL for ${definition.id}`);
			this.byId.set(definition.id, definition);
			for (const command of definition.commands) {
				if (
					!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(command.name) ||
					this.byCommand.has(command.name) ||
					command.versionArgs.length === 0
				)
					throw new Error(`duplicate or invalid command: ${command.name}`);
				for (const location of command.executableLocations({
					toolkitDirectory: '/toolkit',
					installationDirectory: '/toolkit/installations/x',
					binDirectory: '/toolkit/bin',
				}))
					if (!isAbsolute(location) || normalize(location).includes('/../'))
						throw new Error(`unsafe executable location for ${command.name}`);
				this.byCommand.set(command.name, definition);
			}
		}
		for (const definition of definitions)
			for (const dependency of definition.dependencies)
				if (!this.byId.has(dependency)) throw new Error(`missing dependency ${dependency}`);
		this.topological(definitions.map((definition) => definition.id));
	}
	resolve(value: string): ToolchainDefinition | undefined {
		return this.byId.get(value) ?? this.byCommand.get(value);
	}
	topological(ids: readonly string[]): ToolchainDefinition[] {
		const result: ToolchainDefinition[] = [];
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (id: string): void => {
			if (visited.has(id)) return;
			if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`);
			const definition = this.byId.get(id);
			if (!definition) throw new Error(`unknown toolchain: ${id}`);
			visiting.add(id);
			for (const dependency of definition.dependencies) visit(dependency);
			visiting.delete(id);
			visited.add(id);
			result.push(definition);
		};
		for (const id of ids) visit(id);
		return result;
	}
}
export const catalog = new Catalog(builtins);
