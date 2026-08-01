import { stat } from 'node:fs/promises';
import type { AttachConfig } from '../config';
import type { MentionCandidate, ProcessedAttachment } from '../types';
import { parseWithLiteParse } from './liteparse';
import { createPreview, selectContext } from './preview';

export async function processBinary(
	path: string,
	candidates: readonly MentionCandidate[],
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
): Promise<ProcessedAttachment> {
	const [metadata, parsed] = await Promise.all([stat(path), parseWithLiteParse(path, workerPath, signal)]);
	const lines = parsed.text.split(/\r?\n/);
	const selection = selectContext(parsed.text, candidates);
	const limit =
		selection.ranges !== undefined && !config.limitExplicitLines
			? Number.POSITIVE_INFINITY
			: config.perAttachLength;
	const preview = createPreview(selection.content, limit);
	return {
		path,
		mentions: candidates.map((candidate) => candidate.raw),
		sourceBytes: metadata.size,
		contentChars: Array.from(parsed.text).length,
		contentLines: lines.length,
		...(selection.ranges
			? {
					requestedLines: selection.ranges.map((range) => range.join('-')).join(','),
				}
			: {}),
		parsedPath: parsed.parsedPath,
		preview: preview.value,
		truncated: preview.truncated,
		...(selection.warningForModel ? { warningForModel: selection.warningForModel } : {}),
	};
}
