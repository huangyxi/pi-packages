import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withFilesystemLease } from '../../src/provisioning/lock';

describe('filesystem reader/writer leases', () => {
	test('allows readers together and makes a writer wait', async () => {
		const locks = await mkdtemp(join(tmpdir(), 'lease-'));
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let writerEntered = false;
		const reader1 = withFilesystemLease(locks, 'rust', 'shared', undefined, 'reader-1', () => gate);
		const reader2 = withFilesystemLease(locks, 'rust', 'shared', undefined, 'reader-2', () => gate);
		await new Promise((resolve) => setTimeout(resolve, 80));
		const writer = withFilesystemLease(locks, 'rust', 'exclusive', undefined, 'writer', async () => {
			writerEntered = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(writerEntered).toBe(false);
		release();
		await Promise.all([reader1, reader2, writer]);
		expect(writerEntered).toBe(true);
	});
	test('reclaims only a stale dead same-host lease', async () => {
		const locks = await mkdtemp(join(tmpdir(), 'lease-'));
		const directory = join(locks, 'tool');
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, 'writer.json'),
			JSON.stringify({
				schemaVersion: 1,
				mode: 'exclusive',
				token: 'dead',
				pid: 2_147_483_647,
				hostname: hostname(),
				operation: 'dead',
				startedAt: '2000-01-01T00:00:00.000Z',
				heartbeatAt: '2000-01-01T00:00:00.000Z',
			}),
		);
		await expect(
			withFilesystemLease(locks, 'tool', 'exclusive', undefined, 'new', async () => 42, { staleMs: 1 }),
		).resolves.toBe(42);
	});
	test('reclaims a stale gate whose owner record was never published', async () => {
		const locks = await mkdtemp(join(tmpdir(), 'lease-'));
		const gate = join(locks, 'tool', '.gate');
		await mkdir(gate, { recursive: true });
		await utimes(gate, new Date(0), new Date(0));
		await expect(withFilesystemLease(locks, 'tool', 'exclusive', undefined, 'new', async () => 7)).resolves.toBe(7);
	});
});
