import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { processAttachmentInput } from '../attachment-input';
import { registerFileResolver } from '../resolvers/file-resolver';
import { ResolverRegistry } from '../resolvers/resolver-registry';
import { registerUrlResolver } from '../resolvers/url-resolver';

export function registerAttachmentExtension(pi: ExtensionAPI): void {
	const registry = createResolverRegistry();

	pi.on('before_agent_start', async (event, context) => {
		const result = await processAttachmentInput(
			event.prompt,
			context.cwd,
			context.isProjectTrusted(),
			registry,
			(message) => {
				if (context.hasUI) context.ui.notify(message, 'warning');
			},
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

function createResolverRegistry(): ResolverRegistry {
	const registry = new ResolverRegistry();
	registerUrlResolver(registry);
	registerFileResolver(registry);
	return registry;
}
