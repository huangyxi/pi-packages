import { fileURLToPath } from 'node:url';
import { readConfig } from '@/utils/config';
import { ATTACH_CONFIG_SCHEMA } from './config';
import { processFileGroups } from './processing/process-file-groups';
import { renderContext } from './rendering';
import type { ResolverRegistry } from './resolvers/resolver-registry';
import { scanMentions } from './scanner';
import type { AttachmentInputResult, CompletedAttachment, FileGroup, MentionCandidate } from './types';

const workerPath = fileURLToPath(import.meta.resolve('./liteparse-worker.js'));

async function resolveMentions(
	candidates: readonly MentionCandidate[],
	cwd: string,
	registry: ResolverRegistry,
): Promise<{ files: FileGroup[]; completed: CompletedAttachment[] }> {
	const files = new Map<string, FileGroup>();
	const completed: CompletedAttachment[] = [];

	for (const [index, candidate] of candidates.entries()) {
		const resolution = await registry.resolve(candidate, { cwd });
		if (resolution?.kind === 'content') {
			completed.push({
				attachment: resolution.attachment,
				mentions: [candidate],
				firstMention: index,
			});
			continue;
		}
		if (resolution?.kind !== 'file') continue;
		const existing = files.get(resolution.path);
		if (existing) existing.mentions.push(candidate);
		else
			files.set(resolution.path, {
				path: resolution.path,
				mentions: [candidate],
				firstMention: index,
			});
	}

	return { files: [...files.values()], completed };
}

export async function processAttachmentInput(
	text: string,
	cwd: string,
	trusted: boolean,
	registry: ResolverRegistry,
	reportIssue: (message: string) => void,
): Promise<AttachmentInputResult | undefined> {
	const candidates = scanMentions(text);
	if (candidates.length === 0) return undefined;

	const config = await readConfig(ATTACH_CONFIG_SCHEMA, cwd, trusted, reportIssue);
	const signal = config.attachmentProcessingTimeoutSeconds
		? AbortSignal.timeout(config.attachmentProcessingTimeoutSeconds * 1000)
		: new AbortController().signal;
	const resolved = await resolveMentions(candidates, cwd, registry);
	const processed = await processFileGroups(resolved.files, config, workerPath, signal, reportIssue);
	const completed = [...resolved.completed, ...processed].sort(
		(left, right) => left.firstMention - right.firstMention,
	);
	const details = completed.map(({ attachment }) => attachment);
	const warningsForModel = details.flatMap(({ mentions, warningForModel }) =>
		warningForModel ? [`${mentions.join(', ')}: ${warningForModel}`] : [],
	);
	if (completed.length === 0) return undefined;

	return {
		content: renderContext(details, warningsForModel),
		details,
	};
}
