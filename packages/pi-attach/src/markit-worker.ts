import { isJsonObject } from './utils/validation';

async function processRequest(message: unknown): Promise<void> {
	try {
		if (
			!isJsonObject(message) ||
			(message.kind !== 'file' && message.kind !== 'url') ||
			typeof message.value !== 'string'
		)
			throw new Error('invalid request');
		const { Markit } = await import('markit-ai');
		const markit = new Markit();
		const result =
			message.kind === 'file' ? await markit.convertFile(message.value) : await markit.convertUrl(message.value);
		process.send?.({ text: result.markdown });
	} catch (error) {
		process.send?.({
			error: error instanceof Error ? error.message : 'Markit failed',
		});
	}
}

process.on('message', (message: unknown) => {
	void processRequest(message);
});
