import { defineExtensionConfig } from '../../utils/vite';
import packageMetadata from './package.json' with { type: 'json' };

export default defineExtensionConfig({
	packageMetadata,
	externalDependencies: ['@earendil-works/pi-coding-agent'],
});
