import { defineConfig } from 'eslint/config';
import config from '../../eslint.config';

export default defineConfig(
	...config,
	{
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/restrict-template-expressions': 'off',
		},
	},
	{
		files: ['src/catalog/**/*.ts'],
		rules: {
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/require-await': 'off',
		},
	},
	{
		files: ['src/installation/archive.ts'],
		rules: {
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/prefer-promise-reject-errors': 'off',
		},
	},
	{
		files: [
			'src/installation/network.ts',
			'src/installation/platform.ts',
			'src/provisioning/coordinator.ts',
			'src/provisioning/lock.ts',
			'src/state/manifests.ts',
		],
		rules: { '@typescript-eslint/no-unnecessary-condition': 'off' },
	},
	{
		files: [
			'src/installation/process.ts',
			'src/provisioning/coordinator.ts',
		],
		rules: { '@typescript-eslint/prefer-promise-reject-errors': 'off' },
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/require-await': 'off',
		},
	},
);
