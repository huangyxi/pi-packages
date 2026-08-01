import { readFile } from 'node:fs/promises';
import type { AttachConfig } from '../config';
import type { CompletedAttachment, FileGroup } from '../types';
import { mapConcurrent } from '../utils/concurrency';
import { processBinary } from './binary';
import { isText } from './preview';
import { processText } from './text';

async function processFile(
	group: FileGroup,
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
): Promise<CompletedAttachment> {
	const sample = (await readFile(group.path, { signal })).subarray(0, 8192);
	const attachment = isText(sample)
		? await processText(group.path, group.mentions, config, signal)
		: await processBinary(group.path, group.mentions, config, workerPath, signal);
	return {
		attachment,
		mentions: group.mentions,
		firstMention: group.firstMention,
	};
}

export async function processFileGroups(
	groups: readonly FileGroup[],
	config: AttachConfig,
	workerPath: string,
	signal: AbortSignal,
	reportIssue: (message: string) => void,
): Promise<CompletedAttachment[]> {
	const results = await mapConcurrent(groups, config.maxAttachmentConcurrency, async (group) => {
		try {
			return await processFile(group, config, workerPath, signal);
		} catch {
			reportIssue(`could not attach ${group.mentions.map(({ raw }) => raw).join(', ')}`);
			return undefined;
		}
	});
	return results.filter((result) => result !== undefined);
}
