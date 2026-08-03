import { describe, expect, test } from 'vitest';
import { coordinate } from '../../src/provisioning/coordinator';

describe('in-process coordination', () => {
	test('joins work while isolating a cancelled waiter', async () => {
		let calls = 0;
		let finish!: () => void;
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const work = async (): Promise<number> => {
			calls++;
			await gate;
			return 42;
		};
		const short = new AbortController();
		const first = coordinate('same', short.signal, work);
		const second = coordinate('same', undefined, work);
		short.abort(new Error('short'));
		await expect(first).rejects.toThrow('short');
		finish();
		await expect(second).resolves.toBe(42);
		expect(calls).toBe(1);
	});
});
