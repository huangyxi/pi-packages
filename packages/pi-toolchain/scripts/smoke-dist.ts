import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'pi-toolchain-smoke-'));
try {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn(process.execPath, ['dist/cli.js', '--json', 'list'], {
			cwd: join(import.meta.dirname, '..'),
			env: {
				...process.env,
				HOME: join(root, 'home'),
				PI_CODING_AGENT_DIR: join(root, 'agent'),
			},
			stdio: ['ignore', 'pipe', 'inherit'],
		});
		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`dist JSON smoke exited with ${String(code)}`));
		});
	});
	const envelope: unknown = JSON.parse(output);
	if (
		typeof envelope !== 'object' ||
		envelope === null ||
		!('schemaVersion' in envelope) ||
		envelope.schemaVersion !== 1 ||
		!('ok' in envelope) ||
		envelope.ok !== true ||
		!('command' in envelope) ||
		envelope.command !== 'list'
	) {
		throw new Error('dist JSON smoke returned an invalid envelope');
	}
} finally {
	await rm(root, { recursive: true, force: true });
}
