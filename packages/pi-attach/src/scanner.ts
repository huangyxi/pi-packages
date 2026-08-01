import type { MentionCandidate } from './types';

const isWhitespace = (value: string | undefined) => value === undefined || /\s/.test(value);
const isName = (value: string) => /[^\s@]/.test(value);

function protectedEnd(text: string, start: number): number | undefined {
	const rest = text.slice(start);
	const fence = /^(?:`{3,}|~{3,})/.exec(rest)?.[0];
	if (fence) {
		const close = text.indexOf(fence, start + fence.length);
		return close < 0 ? text.length : close + fence.length;
	}
	if (text.startsWith('\\(', start) || text.startsWith('\\[', start)) {
		const close = text.indexOf(text[start] === '(' ? '\\)' : '\\]', start + 2);
		return close < 0 ? text.length : close + 2;
	}
	if (text.startsWith('$$', start)) {
		const close = text.indexOf('$$', start + 2);
		return close < 0 ? text.length : close + 2;
	}
	if (text[start] === '$' || text[start] === '`' || text[start] === "'" || text[start] === '"') {
		const marker = text[start];
		let run = 1;
		while (text[start + run] === marker) run++;
		for (let index = start + run; index < text.length; index++) {
			if (text[index] === '\\') {
				index++;
				continue;
			}
			if (text.slice(index, index + run) === marker.repeat(run)) return index + run;
		}
		return text.length;
	}
	return undefined;
}

function parseValue(raw: string): Pick<MentionCandidate, 'value' | 'selector'> | undefined {
	const match = /^(.*?)(?:#L(\d+)(?:-(\d+))?)?$/.exec(raw);
	if (!match?.[1]) return undefined;
	if (raw.includes('#') && !match[2]) return undefined;
	const start = match[2] === undefined ? undefined : Number(match[2]);
	if (start === undefined) return { value: match[1] };
	const end = match[3] === undefined ? start : Number(match[3]);
	if (start < 1 || end < start) return undefined;
	return { value: match[1], selector: { start, end } };
}

/** Deterministic lexer that returns source spans without altering input. */
export function scanMentions(text: string): MentionCandidate[] {
	const result: MentionCandidate[] = [];
	for (let index = 0; index < text.length;) {
		const end = protectedEnd(text, index);
		if (end !== undefined) {
			index = end;
			continue;
		}
		if (text[index] !== '@' || !isWhitespace(text[index - 1]) || text[index - 1] === '\\') {
			index++;
			continue;
		}
		const start = index;
		let raw = '';
		if (text[index + 1] === '"') {
			const close = text.indexOf('"', index + 2);
			if (close < 0) {
				index++;
				continue;
			}
			raw = text.slice(index + 2, close);
			index = close + 1;
		} else {
			index++;
			while (index < text.length && isName(text[index] ?? '') && text[index] !== ')' && text[index] !== ']')
				raw += text[index++] ?? '';
		}
		const parsed = parseValue(raw);
		if (parsed)
			result.push({
				raw: text.slice(start, index),
				start,
				end: index,
				...parsed,
			});
	}
	return result;
}
