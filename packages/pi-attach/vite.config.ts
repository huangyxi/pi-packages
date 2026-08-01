import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { packageBanner } from '../../utils/vite.ts';
import packageMetadata from './package.json' with { type: 'json' };

export default defineConfig({
	plugins: [packageBanner(packageMetadata)],
	resolve: {
		alias: {
			'@': resolve(import.meta.dirname, '../..'),
		},
	},
	build: {
		lib: {
			entry: {
				extension: 'src/extension.ts',
				'liteparse-worker': 'src/liteparse-worker.ts',
			},
			formats: ['es'],
		},
		rollupOptions: {
			external: (id) => id.startsWith('node:') || id === '@llamaindex/liteparse',
		},
	},
});
