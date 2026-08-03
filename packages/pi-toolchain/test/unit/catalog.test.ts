import { describe, expect, test } from 'vitest';
import { Catalog, catalog } from '../../src/catalog/registry';
import { planDependencies, validateRemoval } from '../../src/provisioning/dependency-graph';
import { builtins } from '../../src/catalog/builtins';

describe('catalog and graph', () => {
	test('resolves command aliases and orders dependencies', () => {
		expect(catalog.resolve('rg')?.id).toBe('ripgrep');
		expect(planDependencies(catalog, ['ripgrep'])).toEqual(['rust', 'ripgrep']);
	});
	test('rejects duplicate commands', () => {
		expect(() => new Catalog([...builtins, { ...builtins[0]!, id: 'other' }])).toThrow('duplicate');
	});
	test('protects dependencies during removal', () => {
		expect(() => validateRemoval(catalog, ['rust', 'ripgrep'], ['rust'])).toThrow('ripgrep');
		expect(validateRemoval(catalog, ['rust', 'ripgrep'], ['rust', 'ripgrep'])).toEqual(['ripgrep', 'rust']);
	});
});
