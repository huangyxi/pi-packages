import { stat } from 'node:fs/promises';

import type { AttachConfig } from '../config';
import type { AttachmentSource, MentionCandidate, ProcessedAttachment } from '../types';
import { convertWithMarkit } from './markit';
import { applyHardCap, applyPreviewBudgetIfUnselected, combinePreviewWarnings, selectContext } from './preview';

export async function processConverted(
	source: AttachmentSource,
	candidates: readonly MentionCandidate[],
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
): Promise<ProcessedAttachment> {
	const [metadata, parsed] = await Promise.all([
		source.kind === 'file' ? stat(source.value) : undefined,
		convertWithMarkit(source, workerPath, signal, config.temporaryDirectory),
	]);
	const lines = parsed.text.split(/\r?\n/);
	const selection = selectContext(parsed.text, candidates);
	const budget = applyPreviewBudgetIfUnselected(
		selection.content,
		selection.ranges !== undefined,
		config.perAttachLength,
	);
	const hardCap = applyHardCap(budget.value);
	const warningForModel = combinePreviewWarnings(selection.warningForModel, hardCap);
	return {
		path: source.value,
		mentions: candidates.map((candidate) => candidate.raw),
		...(metadata ? { sourceBytes: metadata.size } : {}),
		contentChars: Array.from(parsed.text).length,
		contentLines: lines.length,
		...(selection.ranges ? { requestedLines: selection.ranges.map((range) => range.join('-')).join(',') } : {}),
		...(parsed.parsedPath && (selection.ranges === undefined || selection.ranges.length === 1)
			? { readPath: parsed.parsedPath }
			: {}),
		parsedPath: parsed.parsedPath,
		preview: hardCap.value,
		truncated: budget.truncated || hardCap.truncated,
		...(hardCap.truncatedBy ? { truncatedBy: hardCap.truncatedBy } : {}),
		...(warningForModel ? { warningForModel } : {}),
	};
}
