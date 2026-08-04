import type { MentionCandidate } from '../types';

const MAX_INJECTED_BYTES = 50 * 1024;
const MAX_INJECTED_LINES = 2_000;

/** Uses strict UTF-8 plus a small control-character allowance to reject binary input. */
export function isText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return false;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		const controls = Array.from(text).filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 && ![9, 10, 13].includes(code);
		}).length;
		return controls <= Math.max(2, text.length / 100);
	} catch {
		return false;
	}
}

function truncateCodePoints(value: string, length: number): { value: string; truncated: boolean } {
	const points = Array.from(value);
	return points.length > length
		? { value: points.slice(0, length).join(''), truncated: true }
		: { value, truncated: false };
}

function truncateBytes(value: string, maximum: number): string {
	if (Buffer.byteLength(value) <= maximum) return value;
	const points = Array.from(value);
	let low = 0;
	let high = points.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(points.slice(0, middle).join('')) <= maximum) low = middle;
		else high = middle - 1;
	}
	return points.slice(0, low).join('');
}

/** Enforces non-configurable safety caps after the user-configured preview limit. */
function enforceHardLimits(value: string): {
	value: string;
	truncated: boolean;
} {
	const byteLimited = truncateBytes(value, MAX_INJECTED_BYTES);
	const lines = byteLimited.split('\n');
	const lineLimited = lines.length > MAX_INJECTED_LINES ? lines.slice(0, MAX_INJECTED_LINES).join('\n') : byteLimited;
	return { value: lineLimited, truncated: lineLimited !== value };
}

/** Combines overlapping selectors so repeated mentions do not duplicate source lines. */
function mergeRanges(
	candidates: readonly MentionCandidate[],
	lineCount: number,
): { ranges?: [number, number][]; warningForModel?: string } {
	if (candidates.some((candidate) => !candidate.selector)) return {};
	const ranges = candidates.map(
		(candidate) => [candidate.selector?.start ?? 0, candidate.selector?.end ?? 0] as [number, number],
	);
	if (ranges.some(([start]) => start > lineCount))
		return {
			ranges: [],
			warningForModel: 'requested lines are out of bounds',
		};
	ranges.sort((left, right) => left[0] - right[0]);
	const merged: [number, number][] = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
		else merged.push(range);
	}
	return {
		ranges: merged.map(([start, end]) => [start, Math.min(end, lineCount)]),
	};
}

export function selectContext(
	content: string,
	candidates: readonly MentionCandidate[],
): { content: string; ranges?: [number, number][]; warningForModel?: string } {
	const lines = content.split(/\r?\n/);
	const selection = mergeRanges(candidates, lines.length);
	if (selection.ranges === undefined) return { content };
	return {
		content: selection.ranges
			.map(([start, end]) => lines.slice(start - 1, end).join('\n'))
			.join('\n--- source-line separator ---\n'),
		ranges: selection.ranges,
		...(selection.warningForModel ? { warningForModel: selection.warningForModel } : {}),
	};
}

export function createPreview(content: string, limit: number): { value: string; truncated: boolean } {
	const configured = truncateCodePoints(content, limit);
	const hard = enforceHardLimits(configured.value);
	return {
		value: hard.value,
		truncated: configured.truncated || hard.truncated,
	};
}
