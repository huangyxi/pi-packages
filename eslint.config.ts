import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const TYPESCRIPT_FILES = [
	'**/*.ts',
	'**/*.tsx',
];

export default defineConfig(
	{
		ignores: [
			'**/node_modules/',
			'**/dist/',
			'**/coverage/',
			'**/*.js',
			'**/*.cjs',
			'**/*.mjs',
		],
	},
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
		files: TYPESCRIPT_FILES,
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
);
