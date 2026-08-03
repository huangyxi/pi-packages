import { fileURLToPath } from 'node:url';
import { readConfig } from '@/src/utils/config';
import { ATTACH_CONFIG_SCHEMA } from './config';
import { processSourceGroups } from './processing/process-file-groups';
import { renderContext } from './rendering';
import type { ResolverRegistry } from './resolvers/resolver-registry';
import { scanMentions } from './scanner';
import type { AttachmentInputResult, CompletedAttachment, MentionCandidate, SourceGroup } from './types';

const workerPath = fileURLToPath(import.meta.resolve('./markit-worker.js'));

async function resolveMentions(
	candidates: readonly MentionCandidate[],
	cwd: string,
	registry: ResolverRegistry,
): Promise<{ sources: SourceGroup[]; completed: CompletedAttachment[] }> {
	const sources = new Map<string, SourceGroup>();
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
		if (resolution?.kind !== 'file' && resolution?.kind !== 'url') continue;
		const value = resolution.kind === 'file' ? resolution.path : resolution.url;
		const key = `${resolution.kind}:${value}`;
		const existing = sources.get(key);
		if (existing) existing.mentions.push(candidate);
		else
			sources.set(key, {
				source: { kind: resolution.kind, value },
				mentions: [candidate],
				firstMention: index,
			});
	}

	return { sources: [...sources.values()], completed };
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
	const processed = await processSourceGroups(resolved.sources, config, workerPath, signal, reportIssue);
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
