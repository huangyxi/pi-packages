import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { packageBanner } from '../../utils/vite';
import packageMetadata from './package.json' with { type: 'json' };

const runtimeDependencies = Object.keys(packageMetadata.dependencies);

console.log(`export PI_TOOLCHAIN_PACKAGE_DIR='${import.meta.dirname}'`);

export default defineConfig({
	plugins: [packageBanner(packageMetadata)],
	resolve: { alias: { '@': resolve(import.meta.dirname, '../..') } },
	build: {
		lib: {
			entry: { extension: 'src/extension.ts', cli: 'src/cli.ts', 'catalog/types': 'src/catalog/types.ts' },
			formats: ['es'],
		},
		rollupOptions: {
			external: (id) =>
				id.startsWith('node:') ||
				id.startsWith('@earendil-works/') ||
				runtimeDependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`)),
		},
	},
});
