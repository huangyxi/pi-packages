import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'packages/pi-openspec/package.json';
const zeroSha = '0000000000000000000000000000000000000000';

interface Manifest {
	version: string;
	dependencies: Record<string, string>;
}

function readManifest(content: string = readFileSync(manifestPath, 'utf8')): Manifest {
	return JSON.parse(content) as Manifest;
}

function git(args: string[]): string {
	return execFileSync('git', args, { encoding: 'utf8' });
}

function hasManifestAt(sha: string): boolean {
	try {
		git(['cat-file', '-e', `${sha}:${manifestPath}`]);
		return true;
	} catch {
		return false;
	}
}

function output(name: string, value: string | boolean): void {
	const line = `${name}=${String(value)}\n`;
	const outputPath = process.env.GITHUB_OUTPUT;
	if (outputPath === undefined) process.stdout.write(line);
	else appendFileSync(outputPath, line);
}

function detect(): void {
	const openspec = readManifest().dependencies['@fission-ai/openspec'] ?? '';
	const beforeSha = process.env.BEFORE_SHA ?? '';
	let changed = beforeSha === zeroSha;

	if (!changed) {
		if (!hasManifestAt(beforeSha)) {
			try {
				git([
					'fetch',
					'--no-tags',
					'origin',
					beforeSha,
					'--depth=1',
				]);
			} catch {}
		}

		if (hasManifestAt(beforeSha)) {
			const before = readManifest(git(['show', `${beforeSha}:${manifestPath}`]));
			changed = before.dependencies['@fission-ai/openspec'] !== openspec;
		} else {
			console.warn(`Previous push tip ${beforeSha} is unavailable; syncing conservatively.`);
			changed = true;
		}
	}

	output('openspec', openspec);
	output('changed', changed);
}

function sync(version?: string): void {
	const requiredVersion = version ?? '';
	if (requiredVersion === '') throw new Error('OpenSpec version is required');
	const original = readFileSync(manifestPath, 'utf8');
	const manifest = readManifest(original);
	manifest.version = requiredVersion;
	const updated = JSON.stringify(manifest, null, '\t') + '\n';
	writeFileSync(manifestPath, updated);
	output('changed', updated !== original);
}

const [command, value] = process.argv.slice(2);
if (command === 'detect') detect();
else if (command === 'sync') sync(value);
else throw new Error(`Unknown command: ${command ?? ''}`);
