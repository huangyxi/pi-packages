import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { packageBanner } from '../../utils/vite';
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
				'markit-worker': 'src/markit-worker.ts',
			},
			formats: ['es'],
		},
		rollupOptions: {
			external: (id) => id.startsWith('node:') || id === 'markit-ai',
		},
	},
});
