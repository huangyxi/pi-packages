import { describe, expect, it } from 'vitest';

import { compileRules, resolveProtectedEnvironment } from '../src/environment';
import { injectUnset, removeInjectedSegment } from '../src/shell';

describe('environment rules', () => {
	it('anchors literals and supports star and question wildcards', () => {
		const environment = {
			API_KEY: 'protected-value',
			X_API_KEY: 'ignored-value',
			A_TOKEN: 'question-match',
			AB_TOKEN: 'question-miss',
			TOKEN: 'star-match',
		};
		expect(resolveProtectedEnvironment(environment, compileRules(['API_KEY']), 1).names).toEqual(['API_KEY']);
		expect(resolveProtectedEnvironment(environment, compileRules(['?_TOKEN']), 1).names).toEqual(['A_TOKEN']);
		expect(resolveProtectedEnvironment(environment, compileRules(['*TOKEN']), 1).names).toEqual([
			'A_TOKEN',
			'AB_TOKEN',
			'TOKEN',
		]);
	});

	it('uses last-match precedence for negation, overlaps, and duplicates', () => {
		const resolved = resolveProtectedEnvironment(
			{
				PRIVATE_KEY: 'private-value',
				PUBLIC_KEY: 'public-value',
				PUBLIC_SPECIAL_KEY: 'special-value',
			},
			compileRules(['*_KEY', '!PUBLIC_*', 'PUBLIC_SPECIAL_KEY']),
			1,
		);
		expect(resolved.names).toEqual(['PRIVATE_KEY', 'PUBLIC_SPECIAL_KEY']);
	});

	it('ignores invalid environment names and keeps short values filterable', () => {
		const resolved = resolveProtectedEnvironment(
			{ API_KEY: 'tiny', 'BAD-NAME_KEY': 'long-secret-value' },
			compileRules(['*_KEY']),
			8,
		);
		expect(resolved.names).toEqual(['API_KEY']);
		expect(resolved.values).toEqual([]);
	});

	it('deduplicates equal protected values even when also held by an unprotected name', () => {
		const resolved = resolveProtectedEnvironment(
			{ FIRST_KEY: 'same-secret', SECOND_KEY: 'same-secret', PUBLIC: 'same-secret' },
			compileRules(['*_KEY']),
			8,
		);
		expect(resolved.values).toEqual(['same-secret']);
	});

	it('counts Unicode code points for minimum value length', () => {
		const resolved = resolveProtectedEnvironment({ API_KEY: '🔐🔐🔐' }, compileRules(['*_KEY']), 3);
		expect(resolved.values).toEqual(['🔐🔐🔐']);
	});
});

describe('shell interception', () => {
	it('quotes words and creates the exact same-line fragment', () => {
		const quoted = injectUnset('run', ["A'B"]);
		expect(quoted.injectedSegment).toBe(`unset -v -- 'A'"'"'B' 2>/dev/null || true; `);
		const injected = injectUnset('printf "%s" "$LINENO"\nprintf second', ['A_KEY', 'B_KEY']);
		expect(injected.command).toBe(
			'unset -v -- \'A_KEY\' \'B_KEY\' 2>/dev/null || true; printf "%s" "$LINENO"\nprintf second',
		);
	});

	it('removes only one exact segment and preserves surrounding transforms', () => {
		const segment = injectUnset('', ['A_KEY']).injectedSegment;
		const transformed = `prefix; ${segment}original; suffix`;
		expect(removeInjectedSegment(transformed, segment)).toBe('prefix; original; suffix');
		expect(removeInjectedSegment('already clean', segment)).toBe('already clean');
	});
});
