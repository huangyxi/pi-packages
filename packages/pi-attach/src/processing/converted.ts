import { stat } from 'node:fs/promises';

import type { AttachConfig } from '../config';
import type { AttachmentSource, MentionCandidate, ProcessedAttachment } from '../types';
import { convertWithMarkit } from './markit';
import { createPreview, selectContext } from './preview';

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
	// Explicit selectors may bypass the configured preview budget, but hard safety caps still apply.
	const limit =
		selection.ranges !== undefined && !config.limitExplicitLines
			? Number.POSITIVE_INFINITY
			: config.perAttachLength;
	const preview = createPreview(selection.content, limit);
	return {
		path: source.value,
		mentions: candidates.map((candidate) => candidate.raw),
		...(metadata ? { sourceBytes: metadata.size } : {}),
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
