import { execFileSync } from 'node:child_process';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface PackageEntry {
	package: string;
	directory: string;
	name: string;
}

interface PackageManifest {
	name: string;
}

function isPackageManifest(value: unknown): value is PackageManifest {
	return value !== null && typeof value === 'object' && 'name' in value && typeof value.name === 'string';
}

const root = process.cwd();
const packagesRoot = join(root, 'packages');
const directories = (await readdir(packagesRoot, { withFileTypes: true }))
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

const packages = await Promise.all(
	directories.map(async (directory): Promise<PackageEntry> => {
		const manifest: unknown = JSON.parse(await readFile(join(packagesRoot, directory, 'package.json'), 'utf8'));
		if (!isPackageManifest(manifest)) throw new Error(`invalid package manifest: ${directory}`);
		return {
			package: directory,
			directory: `packages/${directory}`,
			name: manifest.name,
		};
	}),
);

let selected = packages;
const requestedPackage = process.env.INPUT_PACKAGE?.trim();
if (requestedPackage) {
	selected = packages.filter(
		(item) =>
			item.package === requestedPackage ||
			item.name === requestedPackage ||
			basename(item.name) === requestedPackage,
	);
	if (selected.length === 0) throw new Error(`unknown package: ${requestedPackage}`);
} else if (process.argv[2] === 'changed') {
	const base = process.env.BASE_SHA;
	if (base && !/^0+$/.test(base)) {
		const changed = execFileSync(
			'git',
			[
				'diff',
				'--name-only',
				base,
				'HEAD',
			],
			{
				encoding: 'utf8',
			},
		)
			.trim()
			.split('\n')
			.filter(Boolean);
		const sharedChange = changed.some((path) => !path.startsWith('packages/'));
		if (!sharedChange) {
			const changedPackages = new Set(
				changed.flatMap((path) => {
					const packageName = /^packages\/([^/]+)\//.exec(path)?.[1];
					return packageName ? [packageName] : [];
				}),
			);
			selected = packages.filter((item) => changedPackages.has(item.package));
		}
	}
}

const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('GITHUB_OUTPUT is not set');
await appendFile(output, `matrix=${JSON.stringify({ include: selected })}\ncount=${String(selected.length)}\n`);
