import { isJsonObject } from './utils/validation';

async function processRequest(message: unknown): Promise<void> {
	try {
		if (!isJsonObject(message) || typeof message.path !== 'string') throw new Error('invalid request');
		const { LiteParse } = await import('@llamaindex/liteparse');
		const result = await new LiteParse().parse(message.path);
		process.send?.({ text: result.text });
	} catch (error) {
		process.send?.({
			error: error instanceof Error ? error.message : 'LiteParse failed',
		});
	}
}

process.on('message', (message: unknown) => {
	void processRequest(message);
});
