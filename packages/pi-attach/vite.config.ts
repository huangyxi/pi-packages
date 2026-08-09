import { defineExtensionConfig } from '../../utils/vite.ts';
import packageMetadata from './package.json' with { type: 'json' };

export default defineExtensionConfig({
	packageMetadata,
	entries: {
		extension: 'src/extension.ts',
		'markit-worker': 'src/markit-worker.ts',
	},
	externalDependencies: ['markit-ai', '@earendil-works/pi-coding-agent'],
});
