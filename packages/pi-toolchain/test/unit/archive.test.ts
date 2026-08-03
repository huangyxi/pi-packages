import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from 'tar-stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { readFile as readBinaryFile, writeFile } from 'node:fs/promises';
import { ZipFile } from 'yazl';
import { describe, expect, test } from 'vitest';
import { extractTar, extractZip } from '../../src/installation/archive';

describe('safe archive extraction', () => {
	test('extracts regular files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'archive-'));
		const archive = join(root, 'a.tar');
		const stream = pack();
		stream.entry({ name: 'bin/tool', type: 'file', mode: 0o755 }, 'ok');
		stream.finalize();
		await pipeline(stream, createWriteStream(archive));
		const out = join(root, 'out');
		await extractTar(archive, out, false);
		expect(await readFile(join(out, 'bin/tool'), 'utf8')).toBe('ok');
	});
	test('rejects traversal', async () => {
		const root = await mkdtemp(join(tmpdir(), 'archive-'));
		const archive = join(root, 'bad.tar');
		const stream = pack();
		stream.entry({ name: '../escape', type: 'file' }, 'bad');
		stream.finalize();
		await pipeline(stream, createWriteStream(archive));
		await expect(extractTar(archive, join(root, 'out'), false)).rejects.toThrow('escapes');
		await expect(readFile(join(root, 'escape'))).rejects.toThrow();
	});
	test('extracts zip files and rejects symlink entries', async () => {
		const root = await mkdtemp(join(tmpdir(), 'archive-'));
		const archive = join(root, 'a.zip');
		const zip = new ZipFile();
		zip.addBuffer(Buffer.from('ok'), 'bin/tool');
		zip.end();
		await pipeline(zip.outputStream, createWriteStream(archive));
		await extractZip(archive, join(root, 'out'));
		expect(await readFile(join(root, 'out/bin/tool'), 'utf8')).toBe('ok');
		const links = new ZipFile();
		links.addBuffer(Buffer.from('target'), 'link', { mode: 0o120777 });
		links.end();
		const linkArchive = join(root, 'link.zip');
		await pipeline(links.outputStream, createWriteStream(linkArchive));
		await expect(extractZip(linkArchive, join(root, 'links'))).rejects.toThrow('symlinks');
	});
	test('rejects zip traversal names', async () => {
		const root = await mkdtemp(join(tmpdir(), 'archive-'));
		const archive = join(root, 'bad.zip');
		const zip = new ZipFile();
		zip.addBuffer(Buffer.from('bad'), 'safe.txt');
		zip.end();
		await pipeline(zip.outputStream, createWriteStream(archive));
		const bytes = await readBinaryFile(archive);
		for (let offset = 0; offset <= bytes.length - 8; offset++)
			if (bytes.subarray(offset, offset + 8).toString() === 'safe.txt') bytes.write('../x.txt', offset);
		await writeFile(archive, bytes);
		await expect(extractZip(archive, join(root, 'out'))).rejects.toThrow(/escapes|invalid relative path/);
	});
	test('rejects archives over deterministic entry and extracted-size bounds', async () => {
		const root = await mkdtemp(join(tmpdir(), 'archive-'));
		const archive = join(root, 'bounded.tar');
		const stream = pack();
		stream.entry({ name: 'one', type: 'file' }, '1234');
		stream.entry({ name: 'two', type: 'file' }, '5');
		stream.finalize();
		await pipeline(stream, createWriteStream(archive));
		await expect(extractTar(archive, join(root, 'entries'), false, { maxEntries: 1 })).rejects.toThrow(
			'entry limit',
		);
		await expect(extractTar(archive, join(root, 'size'), false, { maxExtractedBytes: 3 })).rejects.toThrow(
			'size limit',
		);
	});
});
