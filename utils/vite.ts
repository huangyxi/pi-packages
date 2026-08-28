import { resolve } from 'node:path';

import { defineConfig, type Plugin, type UserConfig } from 'vite';
import banner from 'vite-plugin-banner';

interface PackageMetadata {
	name: string;
	version: string;
	license: string;
	homepage: string;
}

interface ExtensionConfigOptions {
	/** The package's identity fields (name, version, license, homepage) used to render the build banner. */
	packageMetadata: PackageMetadata;
	/** Library entry points; defaults to the standard extension entry. */
	entries?: Record<string, string>;
	/** Dependency package names kept as external imports; node: builtins are always external. */
	externalDependencies?: readonly string[];
	/** Extra plugins appended after the shared banner plugin. */
	plugins?: Plugin[];
	/** Emit compact output by default; false preserves formatting and identifier names. */
	minify?: boolean;
}

function docComments(comments: string[]): string {
	return `/*!\n${comments.map((comment) => ` * ${comment}`).join('\n')}\n */`;
}

function packageBanner(packageMetadata: PackageMetadata) {
	const comments = [
		`${packageMetadata.license} License. ${packageMetadata.homepage}`,
		`${packageMetadata.name} ${packageMetadata.version}`,
		`Build date: ${new Date().toISOString()}`,
	];
	const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL } = process.env;
	if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
		comments.push(
			`GitHub Actions Build URI: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
		);
	}
	return banner(docComments(comments));
}

/** Defines the shared alias, ESM library build, externals, and package banner. */
export function defineExtensionConfig({
	packageMetadata,
	entries = { extension: 'src/extension.ts' },
	externalDependencies = [],
	plugins = [],
	minify = true,
}: ExtensionConfigOptions): UserConfig {
	return defineConfig({
		plugins: [packageBanner(packageMetadata), ...plugins],
		resolve: {
			alias: {
				'@': resolve(import.meta.dirname, '..'),
			},
		},
		build: {
			// Rolldown output minification controls whitespace as well as identifiers.
			minify: false,
			lib: {
				entry: entries,
				formats: ['es'],
			},
			rolldownOptions: {
				external: (id) => id.startsWith('node:') || externalDependencies.includes(id),
				output: {
					minify,
					minifyInternalExports: minify,
				},
			},
		},
	});
}
