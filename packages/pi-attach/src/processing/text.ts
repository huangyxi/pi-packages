import { readFile, stat } from 'node:fs/promises';

import type { AttachConfig } from '../config';
import type { MentionCandidate, ProcessedAttachment } from '../types';
import { createPreview, isText, selectContext } from './preview';

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
	// Explicit selectors may bypass the configured preview budget, but hard safety caps still apply.
	const explicit = selection.ranges !== undefined;
	const budget = explicit && !config.limitExplicitLines ? Number.POSITIVE_INFINITY : config.perAttachLength;
	const preview = createPreview(selection.content, budget);
	return {
		path,
		mentions: candidates.map((candidate) => candidate.raw),
		sourceBytes: metadata.size,
		contentChars: Array.from(content).length,
		contentLines: lines.length,
		...(selection.ranges
			? {
					requestedLines: selection.ranges.map((range) => range.join('-')).join(','),
				}
			: {}),
		preview: preview.value,
		truncated: preview.truncated,
		...(selection.warningForModel ? { warningForModel: selection.warningForModel } : {}),
	};
}
