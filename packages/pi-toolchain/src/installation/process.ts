import { spawn } from 'node:child_process';

export interface ProcessOptions {
	cwd?: string | undefined;
	environment?: NodeJS.ProcessEnv | undefined;
	signal?: AbortSignal | undefined;
	timeoutMs?: number;
	captureLimit?: number;
	stdio?: 'inherit' | 'pipe';
}
export interface ProcessResult {
	code: number;
	stdout: string;
	stderr: string;
}

export async function runProcess(
	command: string,
	args: readonly string[],
	options: ProcessOptions = {},
): Promise<ProcessResult> {
	if (options.signal?.aborted) throw options.signal.reason ?? new Error('cancelled');
	const controller = new AbortController();
	const onAbort = (): void => {
		controller.abort(options.signal?.reason);
	};
	options.signal?.addEventListener('abort', onAbort, { once: true });
	if (options.signal?.aborted) {
		options.signal.removeEventListener('abort', onAbort);
		throw options.signal.reason ?? new Error('cancelled');
	}
	const timer =
		options.timeoutMs && options.timeoutMs > 0
			? setTimeout(() => {
					controller.abort(new Error('process deadline expired'));
				}, options.timeoutMs)
			: undefined;
	const child = spawn(command, args, {
		cwd: options.cwd,
		env: options.environment,
		detached: process.platform !== 'win32',
		stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
	});
	const limit = options.captureLimit ?? 64 * 1024;
	let stdout = Buffer.alloc(0);
	let stderr = Buffer.alloc(0);
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout = Buffer.concat([stdout, chunk]).subarray(-limit);
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr = Buffer.concat([stderr, chunk]).subarray(-limit);
	});
	const terminate = (): void => {
		if (child.exitCode !== null) return;
		try {
			process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGTERM');
		} catch {}
		setTimeout(() => {
			try {
				process.kill(process.platform === 'win32' ? child.pid! : -child.pid!, 'SIGKILL');
			} catch {}
		}, 500).unref();
	};
	controller.signal.addEventListener('abort', terminate, { once: true });
	try {
		const result = await new Promise<ProcessResult>((resolve, reject) => {
			child.once('error', reject);
			child.once('close', (code, signal) => {
				if (controller.signal.aborted) reject(controller.signal.reason ?? new Error('cancelled'));
				else
					resolve({
						code: code ?? (signal === 'SIGINT' ? 130 : 1),
						stdout: stdout.toString(),
						stderr: stderr.toString(),
					});
			});
		});
		return result;
	} finally {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener('abort', onAbort);
	}
}
