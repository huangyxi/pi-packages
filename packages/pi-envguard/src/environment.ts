const VALID_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PatternToken = { kind: 'star' } | { kind: 'any' } | { kind: 'literal'; value: string };

export interface CompiledRule {
	protected: boolean;
	matches(name: string): boolean;
}

function compilePattern(pattern: string): readonly PatternToken[] {
	return Array.from(pattern, (value): PatternToken => {
		if (value === '*') return { kind: 'star' };
		if (value === '?') return { kind: 'any' };
		return { kind: 'literal', value };
	});
}

function matchesPattern(tokens: readonly PatternToken[], input: string): boolean {
	const characters = Array.from(input);
	let states = new Set([0]);
	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
		if (tokens[tokenIndex]?.kind === 'star' && states.has(tokenIndex)) states.add(tokenIndex + 1);
	}
	for (const character of characters) {
		const next = new Set<number>();
		for (const state of states) {
			const token = tokens[state];
			if (!token) continue;
			if (token.kind === 'star') next.add(state);
			else if (token.kind === 'any' || token.value === character) next.add(state + 1);
		}
		states = next;
		for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
			if (tokens[tokenIndex]?.kind === 'star' && states.has(tokenIndex)) states.add(tokenIndex + 1);
		}
	}
	return states.has(tokens.length);
}

export function compileRules(rules: readonly string[]): readonly CompiledRule[] {
	return rules.map((rule) => {
		const unprotected = rule.startsWith('!');
		const tokens = compilePattern(unprotected ? rule.slice(1) : rule);
		return {
			protected: !unprotected,
			matches: (name) => matchesPattern(tokens, name),
		};
	});
}

function isProtectedName(name: string, rules: readonly CompiledRule[]): boolean {
	if (!VALID_ENVIRONMENT_NAME.test(name)) return false;
	let decision = false;
	for (const rule of rules) if (rule.matches(name)) decision = rule.protected;
	return decision;
}

interface ProtectedEnvironment {
	names: readonly string[];
	values: readonly string[];
}

export function resolveProtectedEnvironment(
	environment: NodeJS.ProcessEnv,
	rules: readonly CompiledRule[],
	minimumValueLength: number,
): ProtectedEnvironment {
	const names: string[] = [];
	const values = new Set<string>();
	for (const [name, value] of Object.entries(environment)) {
		if (!isProtectedName(name, rules)) continue;
		names.push(name);
		if (value !== undefined && Array.from(value).length >= minimumValueLength) values.add(value);
	}
	return { names, values: [...values] };
}
