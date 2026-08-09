import { fileURLToPath } from 'node:url';

import { createConfigReader } from '@/src/utils/config';

import { ATTACH_CONFIG_SCHEMA } from './config';
import { processSourceGroups } from './processing/process-file-groups';
import { renderContext } from './rendering';
import type { ResolverRegistry } from './resolvers/resolver-registry';
import { scanMentions } from './scanner';
import type { AttachmentInputResult, MentionCandidate, SourceGroup } from './types';

const workerPath = fileURLToPath(import.meta.resolve('./markit-worker.js'));
const configReader = createConfigReader(ATTACH_CONFIG_SCHEMA, {
	allowPartialFiles: true,
	reportUnknownFields: false,
});

/** Resolves mentions and coalesces repeated files/URLs without losing first-mention order. */
async function resolveMentions(
	candidates: readonly MentionCandidate[],
	cwd: string,
	registry: ResolverRegistry,
): Promise<{ sources: SourceGroup[] }> {
	const sources = new Map<string, SourceGroup>();

	for (const [index, candidate] of candidates.entries()) {
		const resolution = await registry.resolve(candidate, { cwd });
		if (resolution?.kind !== 'file' && resolution?.kind !== 'url') continue;
		const resolvedCandidate = resolution.candidate;
		const value = resolution.kind === 'file' ? resolution.path : resolution.url;
		const key = `${resolution.kind}:${value}`;
		const existing = sources.get(key);
		if (existing) existing.mentions.push(resolvedCandidate);
		else
			sources.set(key, {
				source: { kind: resolution.kind, value },
				mentions: [resolvedCandidate],
				firstMention: index,
			});
	}

	return { sources: [...sources.values()] };
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

	const config = (await configReader.read({ cwd, trusted, reportIssue })).config;
	const signal = config.attachmentProcessingTimeoutSeconds
		? AbortSignal.timeout(config.attachmentProcessingTimeoutSeconds * 1000)
		: new AbortController().signal;
	const resolved = await resolveMentions(candidates, cwd, registry);
	const completed = (await processSourceGroups(resolved.sources, config, workerPath, signal, reportIssue)).sort(
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
