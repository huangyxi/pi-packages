import { defineExtensionConfig } from '../../utils/vite.ts';
import packageMetadata from './package.json' with { type: 'json' };

export default defineExtensionConfig({
	packageMetadata,
	externalDependencies: ['@earendil-works/pi-coding-agent'],
});
