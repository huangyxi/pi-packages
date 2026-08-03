import { fork } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AttachmentSource } from '../types';
import { isJsonObject } from '../utils/validation';

export async function convertWithMarkit(
	source: AttachmentSource,
	workerPath: string,
	signal: AbortSignal,
	temporaryDirectory: string,
): Promise<{ text: string; parsedPath: string }> {
	await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(temporaryDirectory, 'pi-attach-'));
	const parsedPath = join(directory, 'parsed.md');
	return new Promise((resolve, reject) => {
		const child = fork(workerPath, [], {
			execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
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
			reject(error instanceof Error ? error : new Error('Markit failed'));
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
		const exitBeforeResponse = (code: number | null, childSignal: NodeJS.Signals | null) => {
			settleError(new Error(`Markit worker exited before responding (${childSignal ?? String(code)})`));
		};
		child.once('error', settleError);
		child.once('exit', exitBeforeResponse);
		child.once('message', (message: unknown) => {
			child.removeListener('exit', exitBeforeResponse);
			if (child.connected) child.disconnect();
			if (!isJsonObject(message) || typeof message.text !== 'string') {
				settleError(new Error('Markit failed'));
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
		child.send(source);
	});
}
