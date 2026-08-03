import parse from '@ericcornelissen/bash-parser';
import type { Catalog } from '../catalog/registry';
import { dispatchedCommands } from './dispatchers';
import { walkBashAst } from './walk-bash-ast';

interface Token {
	value: string;
	operator: boolean;
}
const bare = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) && !value.includes('/');

function withoutHereDocuments(source: string): { source: string; hadHereDocument: boolean } {
	const lines = source.split('\n');
	const output: string[] = [];
	let delimiter: string | undefined;
	let hadHereDocument = false;
	for (const line of lines) {
		if (delimiter) {
			if (line.replace(/^\t+/, '') === delimiter) delimiter = undefined;
			continue;
		}
		output.push(line);
		const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
		if (match) {
			delimiter = match[2];
			hadHereDocument = true;
		}
	}
	return { source: output.join('\n'), hadHereDocument };
}

function quotedCommandNames(source: string): Set<string> {
	const result = new Set<string>();
	const expression = /(?:^|[\s;&|(){}])(['"])([A-Za-z0-9][A-Za-z0-9._+-]*)\1(?=\s|$|[;&|(){}])/g;
	for (const match of source.matchAll(expression)) if (match[2]) result.add(match[2]);
	return result;
}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let word = '';
	let quote: "'" | '"' | undefined;
	let escaped = false;
	const flush = (): void => {
		if (word !== '') {
			tokens.push({ value: word, operator: false });
			word = '';
		}
	};
	for (let index = 0; index < source.length; index++) {
		const character = source[index]!;
		if (escaped) {
			if (!quote) word += character;
			escaped = false;
			continue;
		}
		if (character === '\\') {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			flush();
			quote = character;
			continue;
		}
		if (character === '#') {
			flush();
			while (index < source.length && source[index] !== '\n') index++;
			tokens.push({ value: ';', operator: true });
			continue;
		}
		if (/\s/.test(character)) {
			flush();
			if (character === '\n') tokens.push({ value: ';', operator: true });
			continue;
		}
		if (';&|(){}'.includes(character)) {
			flush();
			if ((character === '&' || character === '|') && source[index + 1] === character) index++;
			tokens.push({ value: character, operator: true });
			continue;
		}
		if (character === '<' || character === '>') {
			flush();
			tokens.push({ value: character, operator: true });
			continue;
		}
		word += character;
	}
	flush();
	return tokens;
}

function fallbackCommands(source: string): string[] {
	const tokens = tokenize(withoutHereDocuments(source).source);
	const found: string[] = [];
	let commandPosition = true;
	for (const token of tokens) {
		if (token.operator) {
			commandPosition = [
				';',
				'&',
				'|',
				'(',
				'{',
			].includes(token.value);
			continue;
		}
		if (!commandPosition) continue;
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value)) continue;
		if (bare(token.value)) found.push(token.value);
		commandPosition = false;
	}
	return found;
}

export function detectCommands(source: string, catalog: Catalog): string[] {
	const found: string[] = [];
	const quoted = quotedCommandNames(source);
	const unquotedCommands = new Set(fallbackCommands(source));
	const add = (value: string, nested = false): void => {
		if (
			bare(value) &&
			(nested || !quoted.has(value) || unquotedCommands.has(value)) &&
			catalog.byCommand.has(value) &&
			!found.includes(value)
		)
			found.push(value);
	};
	const inspect = (commandSource: string, depth: number): void => {
		if (depth > 4) return;
		const heredoc = withoutHereDocuments(commandSource);
		try {
			if (heredoc.hadHereDocument) throw new Error('heredoc uses conservative detection');
			const ast: unknown = parse(commandSource, { mode: 'posix' });
			walkBashAst(ast, (command) => {
				for (const candidate of dispatchedCommands(command.name, command.arguments)) {
					if (candidate.startsWith('__shell__:')) inspect(candidate.slice('__shell__:'.length), depth + 1);
					else add(candidate, depth > 0);
				}
			});
		} catch {
			for (const candidate of fallbackCommands(commandSource)) add(candidate);
		}
	};
	inspect(source, 0);
	return found;
}
