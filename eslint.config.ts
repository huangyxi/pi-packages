import { defineConfig } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
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
		plugins: {
			'simple-import-sort': simpleImportSort,
		},
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
		rules: {
			'simple-import-sort/imports': 'error',
			'simple-import-sort/exports': 'error',
		},
	},
);
