import { lstat, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson } from '../state/json';

export type LeaseMode = 'shared' | 'exclusive';
interface LeaseRecord {
	schemaVersion: 1;
	mode: LeaseMode;
	token: string;
	pid: number;
	hostname: string;
	operation: string;
	startedAt: string;
	heartbeatAt: string;
}
export interface LeaseOptions {
	heartbeatMs?: number;
	staleMs?: number;
}

function abortError(signal: AbortSignal | undefined): Error {
	return signal?.reason instanceof Error
		? signal.reason
		: new Error(signal?.aborted ? 'cancelled' : 'lease wait interrupted');
}
async function pause(signal: AbortSignal | undefined, milliseconds = 40): Promise<void> {
	if (signal?.aborted) throw abortError(signal);
	await new Promise<void>((resolve, reject) => {
		const cancel = (): void => {
			clearTimeout(timer);
			reject(abortError(signal));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', cancel);
			resolve();
		}, milliseconds);
		signal?.addEventListener('abort', cancel, { once: true });
	});
}
async function withGate<T>(directory: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
	const gate = join(directory, '.gate');
	while (true) {
		if (signal?.aborted) throw abortError(signal);
		try {
			await mkdir(gate);
			await writeFile(
				join(gate, 'owner.json'),
				JSON.stringify({ pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() }),
			);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			try {
				const owner = JSON.parse(await readFile(join(gate, 'owner.json'), 'utf8')) as {
					pid?: number;
					hostname?: string;
					createdAt?: string;
				};
				if (owner.hostname !== hostname())
					throw new Error(`toolkit lock gate belongs to another host: ${String(owner.hostname)}`);
				if (
					typeof owner.pid === 'number' &&
					typeof owner.createdAt === 'string' &&
					!processAlive(owner.pid) &&
					Date.now() - Date.parse(owner.createdAt) > 5000
				) {
					await rm(gate, { recursive: true, force: true });
					continue;
				}
			} catch (gateError) {
				if (gateError instanceof Error && gateError.message.includes('another host')) throw gateError;
				try {
					const stat = await lstat(gate);
					if (Date.now() - stat.mtimeMs > 5000) {
						await rm(gate, { recursive: true, force: true });
						continue;
					}
				} catch {}
			}
			await pause(signal);
		}
	}
	try {
		return await work();
	} finally {
		await rm(gate, { recursive: true, force: true });
	}
}
function isRecord(value: unknown): value is LeaseRecord {
	if (value === null || typeof value !== 'object') return false;
	const record = value as Partial<LeaseRecord>;
	return (
		record.schemaVersion === 1 &&
		(record.mode === 'shared' || record.mode === 'exclusive') &&
		typeof record.token === 'string' &&
		typeof record.pid === 'number' &&
		typeof record.hostname === 'string' &&
		typeof record.heartbeatAt === 'string'
	);
}
async function readRecord(path: string): Promise<LeaseRecord | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(path, 'utf8'));
		return isRecord(value) ? value : undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		return undefined;
	}
}
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}
async function activeRecord(path: string, staleMs: number): Promise<LeaseRecord | undefined> {
	const record = await readRecord(path);
	if (!record) return undefined;
	if (record.hostname !== hostname()) throw new Error(`toolkit lease belongs to another host: ${record.hostname}`);
	const stale = Date.now() - Date.parse(record.heartbeatAt) > staleMs;
	if (stale && !processAlive(record.pid)) {
		await rm(path, { force: true });
		return undefined;
	}
	return record;
}
async function allReaders(directory: string, staleMs: number): Promise<LeaseRecord[]> {
	const readers = join(directory, 'readers');
	await mkdir(readers, { recursive: true });
	const result: LeaseRecord[] = [];
	for (const entry of await readdir(readers)) {
		const record = await activeRecord(join(readers, entry), staleMs);
		if (record) result.push(record);
	}
	return result;
}

export async function withFilesystemLease<T>(
	locks: string,
	id: string,
	mode: LeaseMode,
	signal: AbortSignal | undefined,
	operation: string,
	work: () => Promise<T>,
	options: LeaseOptions = {},
): Promise<T> {
	const directory = join(locks, id);
	const readers = join(directory, 'readers');
	await mkdir(readers, { recursive: true });
	const token = crypto.randomUUID();
	const path = mode === 'exclusive' ? join(directory, 'writer.json') : join(readers, `${token}.json`);
	const heartbeatMs = options.heartbeatMs ?? 1000;
	const staleMs = options.staleMs ?? 5000;
	while (true) {
		const acquired = await withGate(directory, signal, async () => {
			const writer = await activeRecord(join(directory, 'writer.json'), staleMs);
			const activeReaders = await allReaders(directory, staleMs);
			if (writer || (mode === 'exclusive' && activeReaders.length > 0)) return false;
			const now = new Date().toISOString();
			const record: LeaseRecord = {
				schemaVersion: 1,
				mode,
				token,
				pid: process.pid,
				hostname: hostname(),
				operation,
				startedAt: now,
				heartbeatAt: now,
			};
			const handle = await open(path, 'wx', 0o600);
			try {
				await handle.writeFile(JSON.stringify(record));
				await handle.sync();
			} finally {
				await handle.close();
			}
			return true;
		});
		if (acquired) break;
		await pause(signal);
	}
	const heartbeat = setInterval(() => {
		void (async () => {
			try {
				const record = await readRecord(path);
				if (record?.token !== token) return;
				await atomicWriteJson(path, { ...record, heartbeatAt: new Date().toISOString() });
			} catch {
				// Lease acquisition/cleanup owns error reporting; heartbeats must never reject globally.
			}
		})();
	}, heartbeatMs);
	heartbeat.unref();
	try {
		return await work();
	} finally {
		clearInterval(heartbeat);
		await withGate(directory, undefined, async () => {
			const record = await readRecord(path);
			if (record?.token === token) await rm(path, { force: true });
		});
	}
}
export async function withLease<T>(
	locks: string,
	id: string,
	signal: AbortSignal | undefined,
	operation: string,
	work: () => Promise<T>,
): Promise<T> {
	return withFilesystemLease(locks, id, 'exclusive', signal, operation, work);
}
export async function withSharedLease<T>(
	locks: string,
	id: string,
	signal: AbortSignal | undefined,
	operation: string,
	work: () => Promise<T>,
): Promise<T> {
	return withFilesystemLease(locks, id, 'shared', signal, operation, work);
}
