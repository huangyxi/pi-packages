import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { processAttachmentInput } from './attachment-input';
import { registerFileResolver } from './resolvers/file-resolver';
import { ResolverRegistry } from './resolvers/resolver-registry';
import { registerSkillResolver } from './resolvers/skill-resolver';
import { registerUrlResolver } from './resolvers/url-resolver';

export default function attach(pi: ExtensionAPI): void {
	const registry = new ResolverRegistry();
	registerUrlResolver(registry);
	registerFileResolver(registry);
	registerSkillResolver(registry, pi);

	pi.on('before_agent_start', async (event, context) => {
		const reportIssue = (message: string): void => {
			if (context.hasUI) context.ui.notify(message, 'warning');
		};
		const result = await processAttachmentInput(
			event.prompt,
			context.cwd,
			context.isProjectTrusted(),
			registry,
			reportIssue,
		);
		if (!result) return;
		return {
			message: {
				customType: 'attach-context',
				content: result.content,
				display: true,
				details: result.details,
			},
		};
	});
}
