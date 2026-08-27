import { join } from 'node:path';

import type { Plugin } from 'vite';

import { defineExtensionConfig } from '../../utils/vite';
import packageMetadata from './package.json' with { type: 'json' };
import { generateAssets } from './scripts/generate-assets';

const openspecAssets: Plugin = {
	name: 'pi-openspec-assets',
	apply: 'build',
	async closeBundle() {
		const { skills, prompts, version } = await generateAssets(join(import.meta.dirname, 'dist'));
		this.info(
			`@hyxi/pi-openspec: generated ${String(skills)} skills and ${String(prompts)} /opsx-* prompts from @fission-ai/openspec ${version}`,
		);
	},
};

export default defineExtensionConfig({
	packageMetadata,
	entries: {
		extension: 'src/extension.ts',
		installShim: 'src/install-shim.ts',
		openspecShim: 'src/openspec-shim.ts',
	},
	externalDependencies: ['@earendil-works/pi-coding-agent'],
	minify: false,
	plugins: [openspecAssets],
});
