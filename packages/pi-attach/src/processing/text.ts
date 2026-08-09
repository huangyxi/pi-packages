import { readFile, stat } from 'node:fs/promises';

import type { AttachConfig } from '../config';
import type { MentionCandidate, ProcessedAttachment } from '../types';
import { applyHardCap, applyPreviewBudgetIfUnselected, combinePreviewWarnings, isText, selectContext } from './preview';

export async function processText(
	path: string,
	candidates: readonly MentionCandidate[],
	config: AttachConfig,
	signal: AbortSignal,
): Promise<ProcessedAttachment> {
	const [source, metadata] = await Promise.all([readFile(path, { signal }), stat(path)]);
	if (!isText(source.subarray(0, 8192))) throw new Error('non-text source requires Markit');
	const content = new TextDecoder('utf-8', { fatal: true }).decode(source);
	const lines = content.split(/\r?\n/);
	const selection = selectContext(content, candidates);
	const budget = applyPreviewBudgetIfUnselected(
		selection.content,
		selection.ranges !== undefined,
		config.perAttachLength,
	);
	const hardCap = applyHardCap(budget.value);
	const warningForModel = combinePreviewWarnings(selection.warningForModel, hardCap);
	return {
		path,
		mentions: candidates.map((candidate) => candidate.raw),
		sourceBytes: metadata.size,
		contentChars: Array.from(content).length,
		contentLines: lines.length,
		...(selection.ranges ? { requestedLines: selection.ranges.map((range) => range.join('-')).join(',') } : {}),
		...(selection.ranges === undefined || selection.ranges.length === 1 ? { readPath: path } : {}),
		preview: hardCap.value,
		truncated: budget.truncated || hardCap.truncated,
		...(hardCap.truncatedBy ? { truncatedBy: hardCap.truncatedBy } : {}),
		...(warningForModel ? { warningForModel } : {}),
	};
}
