import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { processAttachmentInput } from './attachment-input';
import { registerFileResolver } from './resolvers/file-resolver';
import { ResolverRegistry } from './resolvers/resolver-registry';
import { registerSkillResolver } from './resolvers/skill-resolver';
import type { ProcessedAttachment } from './types';

interface PendingContext {
	content: string;
	details: ProcessedAttachment[];
}

export default function attach(pi: ExtensionAPI): void {
	const pending: PendingContext[] = [];
	const registry = new ResolverRegistry();
	registerFileResolver(registry);
	registerSkillResolver(registry, pi);

	pi.on('input', async (event, context) => {
		if (event.source === 'extension') return;
		const reportIssue = (message: string): void => {
			if (context.hasUI) context.ui.notify(message, 'warning');
		};
		const result = await processAttachmentInput(
			event.text,
			context.cwd,
			context.isProjectTrusted(),
			registry,
			reportIssue,
		);
		if (!result) return;
		pending.push({ content: result.content, details: result.details });
		return { action: 'continue' };
	});

	pi.on('before_agent_start', () => {
		const next = pending.shift();
		if (!next) return;
		return {
			message: {
				customType: 'attach-context',
				content: next.content,
				display: true,
				details: next.details,
			},
		};
	});
}
