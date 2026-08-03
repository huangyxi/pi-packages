import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import yauzl from 'yauzl';

function safePath(root: string, name: string): string {
	if (isAbsolute(name) || name.includes('\0')) throw new Error(`unsafe archive path: ${name}`);
	const destination = normalize(join(root, name));
	const rel = relative(root, destination);
	if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error(`archive path escapes destination: ${name}`);
	return destination;
}
export interface ExtractionLimits {
	maxEntries?: number;
	maxExtractedBytes?: number;
}
const defaultLimits = { maxEntries: 100_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 };

export async function extractTar(
	path: string,
	destination: string,
	gzip = path.endsWith('.gz'),
	limits: ExtractionLimits = {},
): Promise<void> {
	const maxEntries = limits.maxEntries ?? defaultLimits.maxEntries;
	const maxExtractedBytes = limits.maxExtractedBytes ?? defaultLimits.maxExtractedBytes;
	let entries = 0;
	let extractedBytes = 0;
	await mkdir(destination, { recursive: true });
	const extract = tar.extract();
	let extractionError: unknown;
	extract.on('entry', (header, stream, next) => {
		void (async () => {
			try {
				entries++;
				extractedBytes += header.size ?? 0;
				if (entries > maxEntries) throw new Error('archive exceeds entry limit');
				if (extractedBytes > maxExtractedBytes) throw new Error('archive exceeds extracted size limit');
				if (extractionError) {
					stream.resume();
					next();
					return;
				}
				const target = safePath(destination, header.name);
				if (header.type === 'directory') await mkdir(target, { recursive: true });
				else if (header.type === 'file') {
					await mkdir(dirname(target), { recursive: true });
					await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: header.mode ?? 0o600 }));
					await chmod(target, (header.mode ?? 0o600) & 0o777);
					next();
					return;
				} else throw new Error(`unsafe tar entry type: ${header.type}`);
				stream.resume();
				next();
			} catch (error) {
				extractionError = error;
				stream.resume();
				next();
			}
		})();
	});
	const input = createReadStream(path);
	try {
		if (gzip) await pipeline(input, createGunzip(), extract);
		else await pipeline(input, extract);
		if (extractionError) {
			throw extractionError instanceof Error ? extractionError : new Error('tar extraction failed');
		}
	} catch (error) {
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
}
export async function extractZip(path: string, destination: string, limits: ExtractionLimits = {}): Promise<void> {
	await mkdir(destination, { recursive: true });
	try {
		await extractZipEntries(path, destination, limits);
	} catch (error) {
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
}
async function extractZipEntries(path: string, destination: string, limits: ExtractionLimits): Promise<void> {
	const maxEntries = limits.maxEntries ?? defaultLimits.maxEntries;
	const maxExtractedBytes = limits.maxExtractedBytes ?? defaultLimits.maxExtractedBytes;
	let entries = 0;
	let extractedBytes = 0;
	const archive = await new Promise<yauzl.ZipFile>((resolve, reject) => {
		yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, file) => {
			if (error || !file) reject(error ?? new Error('invalid zip'));
			else resolve(file);
		});
	});
	await new Promise<void>((resolve, reject) => {
		archive.once('error', reject);
		archive.once('end', resolve);
		archive.on('entry', (entry) => {
			void (async () => {
				try {
					entries++;
					extractedBytes += Number(entry.uncompressedSize);
					if (entries > maxEntries) throw new Error('archive exceeds entry limit');
					if (extractedBytes > maxExtractedBytes) throw new Error('archive exceeds extracted size limit');
					const target = safePath(destination, entry.fileName);
					const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
					const type = mode & 0o170000;
					if (type === 0o120000) throw new Error('zip symlinks are not allowed');
					if (entry.fileName.endsWith('/')) {
						await mkdir(target, { recursive: true });
						archive.readEntry();
						return;
					}
					await mkdir(dirname(target), { recursive: true });
					const input = await new Promise<NodeJS.ReadableStream>((res, rej) => {
						archive.openReadStream(entry, (error, stream) => {
							if (error || !stream) rej(error ?? new Error('invalid zip entry'));
							else res(stream);
						});
					});
					await pipeline(input, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
					if (mode) await chmod(target, mode & 0o777);
					archive.readEntry();
				} catch (error) {
					reject(error);
					archive.close();
				}
			})();
		});
		archive.readEntry();
	});
}
