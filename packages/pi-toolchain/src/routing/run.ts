import { spawn } from 'node:child_process';
export async function dispatchExecutable(
	executable: string,
	args: readonly string[],
	environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { env: environment, cwd: process.cwd(), stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			resolve(code ?? (signal === 'SIGINT' ? 130 : 1));
		});
	});
}
