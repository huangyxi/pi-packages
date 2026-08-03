import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { withFilesystemLease } from '../../src/provisioning/lock';

async function waitFor(path: string): Promise<void> {
	for (let index = 0; index < 100; index++) {
		try {
			await access(path);
			return;
		} catch {
			await new Promise((resolveWait) => setTimeout(resolveWait, 20));
		}
	}
	throw new Error('child did not acquire lease');
}
describe('cross-process lease', () => {
	test('exclusive waits for a live reader process', async () => {
		const root = await mkdtemp(join(tmpdir(), 'cross-lease-'));
		const ready = join(root, 'ready');
		const modulePath = resolve('src/provisioning/lock.ts');
		const script = `import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier.startsWith('.')&&! /\\.[^/]+$/.test(specifier)?specifier+'.ts':specifier,context);}});const {withFilesystemLease}=await import(${JSON.stringify(modulePath)});const {writeFile}=await import('node:fs/promises');await withFilesystemLease(${JSON.stringify(root)},'rust','shared',undefined,'child',async()=>{await writeFile(${JSON.stringify(ready)},'ready');await new Promise(r=>setTimeout(r,350));});`;
		const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'inherit' });
		await waitFor(ready);
		const started = Date.now();
		await withFilesystemLease(root, 'rust', 'exclusive', undefined, 'parent', async () => undefined);
		expect(Date.now() - started).toBeGreaterThan(200);
		if (child.exitCode === null)
			await new Promise<void>((resolveExit, reject) => {
				child.once('error', reject);
				child.once('exit', (code) => {
					if (code === 0) resolveExit();
					else reject(new Error(`child exited ${String(code)}`));
				});
			});
		else expect(child.exitCode).toBe(0);
	});
});
