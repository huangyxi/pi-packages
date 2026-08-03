import type { Catalog } from '../catalog/registry';

export function planDependencies(catalog: Catalog, ids: readonly string[]): string[] {
	return catalog.topological(ids).map((entry) => entry.id);
}
export function validateRemoval(
	catalog: Catalog,
	installed: readonly string[],
	requested: readonly string[],
): string[] {
	const removing = new Set(requested);
	const conflicts: string[] = [];
	for (const id of installed) {
		if (removing.has(id)) continue;
		const definition = catalog.byId.get(id);
		if (definition?.dependencies.some((dependency) => removing.has(dependency))) conflicts.push(id);
	}
	if (conflicts.length > 0)
		throw new Error(
			`installed dependents must also be removed: ${conflicts.join(', ')}; try: pi-toolchain uninstall ${[...conflicts, ...requested].join(' ')}`,
		);
	return catalog
		.topological(requested)
		.reverse()
		.map((entry) => entry.id);
}
