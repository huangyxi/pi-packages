import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	type TruncationResult,
} from '@earendil-works/pi-coding-agent';

import type { MentionCandidate } from '../types';

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

export interface PreviewResult {
	value: string;
	truncated: boolean;
	truncatedBy?: TruncationResult['truncatedBy'];
	firstLineExceedsLimit?: boolean;
}

/** Applies Pi Attach's recurring-context budget to an unselected source. */
export function applyPreviewBudget(content: string, limit: number): PreviewResult {
	const result = truncateCodePoints(content, limit);
	return { value: result.value, truncated: result.truncated };
}

/** Applies the recurring-context budget only when no line selector was supplied. */
export function applyPreviewBudgetIfUnselected(content: string, selected: boolean, limit: number): PreviewResult {
	return selected ? { value: content, truncated: false } : applyPreviewBudget(content, limit);
}

/** Applies Pi's unconditional line and byte caps without splitting a line. */
export function applyHardCap(content: string): PreviewResult {
	const result = truncateHead(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	return {
		value: result.content,
		truncated: result.truncated,
		...(result.truncated ? { truncatedBy: result.truncatedBy } : {}),
		...(result.firstLineExceedsLimit ? { firstLineExceedsLimit: true } : {}),
	};
}

export function combinePreviewWarnings(
	selectionWarning: string | undefined,
	hardCap: PreviewResult,
): string | undefined {
	return (
		[
			selectionWarning,
			hardCap.firstLineExceedsLimit
				? "the first line exceeds Pi's hard byte cap, so no preview is available"
				: undefined,
		]
			.filter((warning): warning is string => warning !== undefined)
			.join('; ') || undefined
	);
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
