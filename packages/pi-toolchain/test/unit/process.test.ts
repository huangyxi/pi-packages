import { describe, expect, test } from 'vitest';
import { runProcess } from '../../src/installation/process';

describe('process execution', () => {
	test('preserves argument boundaries', async () => {
		const result = await runProcess(process.execPath, [
			'-e',
			'console.log(JSON.stringify(process.argv.slice(1)))',
			'a b',
			'$x',
		]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(['a b', '$x']);
	});
	test('supports cancellation', async () => {
		const controller = new AbortController();
		const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
		setTimeout(() => {
			controller.abort(new Error('cancelled'));
		}, 50);
		await expect(pending).rejects.toThrow('cancelled');
	});
	test('rejects a pre-aborted signal before attempting spawn', async () => {
		const controller = new AbortController();
		controller.abort(new Error('already cancelled'));
		await expect(runProcess('/definitely/not/a/command', [], { signal: controller.signal })).rejects.toThrow(
			'already cancelled',
		);
	});
});
