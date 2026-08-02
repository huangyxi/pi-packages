import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { AttachConfig } from '../config';
import type { CompletedAttachment, SourceGroup } from '../types';
import { mapConcurrent } from '../utils/concurrency';
import { processConverted } from './converted';
import { isText } from './preview';
import { processText } from './text';

const MARKDOWN_CONVERSION_EXTENSIONS = new Set([
	'.atom',
	'.csv',
	'.htm',
	'.html',
	'.ipynb',
	'.json',
	'.rss',
	'.tsv',
	'.xml',
	'.svg',
	'.yaml',
	'.yml',
]);

async function processSource(
	group: SourceGroup,
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
): Promise<CompletedAttachment> {
	let directText = false;
	if (
		group.source.kind === 'file' &&
		!MARKDOWN_CONVERSION_EXTENSIONS.has(extname(group.source.value).toLowerCase())
	) {
		const sample = (await readFile(group.source.value, { signal })).subarray(0, 8192);
		directText = isText(sample);
	}
	const attachment = directText
		? await processText(group.source.value, group.mentions, config, signal)
		: await processConverted(group.source, group.mentions, config, workerPath, signal);
	return {
		attachment,
		mentions: group.mentions,
		firstMention: group.firstMention,
	};
}

export async function processSourceGroups(
	groups: readonly SourceGroup[],
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
	reportIssue: (message: string) => void,
): Promise<CompletedAttachment[]> {
	const results = await mapConcurrent(groups, config.maxAttachmentConcurrency, async (group) => {
		try {
			return await processSource(group, config, workerPath, signal);
		} catch {
			reportIssue(`could not attach ${group.mentions.map(({ raw }) => raw).join(', ')}`);
			return undefined;
		}
	});
	return results.filter((result) => result !== undefined);
}
