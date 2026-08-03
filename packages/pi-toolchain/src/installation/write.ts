import { mkdir, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export async function atomicWriteFile(path: string, content: Uint8Array, mode = 0o600): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${process.pid}-${crypto.randomUUID()}.tmp`);
	const handle = await open(temporary, 'wx', mode);
	try {
		await handle.writeFile(content);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
}
