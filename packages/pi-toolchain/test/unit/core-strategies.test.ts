import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { strictCargoBinstallArguments } from '../../src/catalog/cargo-utility';
import { juliaupAssetName } from '../../src/catalog/julia';
import { uvAssetName } from '../../src/catalog/python';
import { cargoBinstallAssetName, rustupArtifactUrl } from '../../src/catalog/rust';
import { exactAsset, type GitHubRelease } from '../../src/installation/releases';

describe('official strategy construction', () => {
	test('selects exact runtime-resolved Linux artifacts', () => {
		expect(uvAssetName('x86_64-unknown-linux-gnu')).toBe('uv-x86_64-unknown-linux-gnu.tar.gz');
		expect(rustupArtifactUrl('aarch64-unknown-linux-gnu')).toBe(
			'https://static.rust-lang.org/rustup/dist/aarch64-unknown-linux-gnu/rustup-init',
		);
		expect(cargoBinstallAssetName('x86_64-unknown-linux-gnu')).toBe('cargo-binstall-x86_64-unknown-linux-gnu.tgz');
		expect(juliaupAssetName('1.20.9', 'x86_64-unknown-linux-musl')).toBe(
			'juliaup-1.20.9-x86_64-unknown-linux-musl-portable.tar.gz',
		);
	});
	test('rejects ambiguous release assets', () => {
		const release: GitHubRelease = {
			tag: '1',
			assets: [
				{ name: 'tool.tar.gz', browser_download_url: 'https://example.test/1' },
				{ name: 'tool.tar.gz', browser_download_url: 'https://example.test/2' },
			],
		};
		expect(() => exactAsset(release, 'tool.tar.gz')).toThrow('found 2');
	});
	test('constructs only strict cargo-binstall arguments', () => {
		const args = strictCargoBinstallArguments('/staging/tool', 'ripgrep', '14.1.0');
		expect(args).toEqual([
			'binstall',
			'--no-confirm',
			'--disable-telemetry',
			'--strategies',
			'crate-meta-data',
			'--root',
			'/staging/tool',
			'ripgrep@14.1.0',
		]);
		expect(args.join(' ')).not.toMatch(/quick-install|compile|cargo install/);
	});
	test('contains no curl, wget, sudo, or system-package-manager subprocess', async () => {
		for (const file of [
			'python.ts',
			'rust.ts',
			'julia.ts',
			'cargo-utility.ts',
		]) {
			const source = await readFile(join(import.meta.dirname, '../../src/catalog', file), 'utf8');
			expect(source).not.toMatch(/runProcess\(\s*['"](?:curl|wget|sudo|apt|apt-get|brew|dnf|yum)['"]/);
		}
	});
});
