import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${process.pid}-${crypto.randomUUID()}.tmp`);
	const handle = await open(temporary, 'wx', 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
}
export async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}
