import { fork } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isJsonObject } from '../utils/validation';

export async function parseWithLiteParse(
	sourcePath: string,
	workerPath: string,
	signal: AbortSignal,
): Promise<{ text: string; parsedPath: string }> {
	const directory = await mkdtemp(join(tmpdir(), 'pi-attach-'));
	const parsedPath = join(directory, 'parsed.txt');
	return new Promise((resolve, reject) => {
		const child = fork(workerPath, [], {
			stdio: [
				'ignore',
				'ignore',
				'ignore',
				'ipc',
			],
		});
		let settled = false;
		const cleanup = () => {
			settled = true;
			signal.removeEventListener('abort', cancel);
		};
		const settleError = (error: unknown) => {
			if (settled) return;
			cleanup();
			reject(error instanceof Error ? error : new Error('LiteParse failed'));
		};
		const settleResult = (text: string) => {
			if (settled) return;
			cleanup();
			resolve({ text, parsedPath });
		};
		const cancel = () => {
			child.kill('SIGTERM');
			settleError(new Error('attachment processing timed out'));
		};
		if (signal.aborted) {
			cancel();
			return;
		}
		signal.addEventListener('abort', cancel, { once: true });
		child.once('error', settleError);
		child.once('message', (message: unknown) => {
			if (child.connected) child.disconnect();
			if (!isJsonObject(message) || typeof message.text !== 'string') {
				settleError(new Error('LiteParse failed'));
				return;
			}
			const text = message.text;
			void writeFile(parsedPath, text, { mode: 0o600 }).then(
				() => {
					settleResult(text);
				},
				(error: unknown) => {
					settleError(error);
				},
			);
		});
		child.send({ path: sourcePath });
	});
}
