import { createHash } from 'node:crypto';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { atomicWriteFile } from './write';
import { sanitizeDiagnostic } from '../output/diagnostics';

function effective(env: NodeJS.ProcessEnv, lower: string): string | undefined {
	return Object.hasOwn(env, lower) ? env[lower] : env[lower.toUpperCase()];
}
export interface ProxyPolicy {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string;
}
export function resolveProxyPolicy(env: NodeJS.ProcessEnv): ProxyPolicy {
	const all = effective(env, 'all_proxy');
	const configuredHttp = effective(env, 'http_proxy');
	const configuredHttps = effective(env, 'https_proxy');
	const httpProxy = configuredHttp === undefined || configuredHttp === '' ? all : configuredHttp;
	const httpsProxy = configuredHttps === undefined || configuredHttps === '' ? all : configuredHttps;
	const noProxy = effective(env, 'no_proxy');
	return {
		...(httpProxy ? { httpProxy } : {}),
		...(httpsProxy ? { httpsProxy } : {}),
		...(noProxy !== undefined ? { noProxy } : {}),
	};
}
export function createNetworkDispatcher(env: NodeJS.ProcessEnv = process.env): EnvHttpProxyAgent {
	const { httpProxy, httpsProxy, noProxy } = resolveProxyPolicy(env);
	for (const value of [httpProxy, httpsProxy])
		if (value) {
			const url = new URL(value);
			if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported proxy URL protocol');
		}
	return new EnvHttpProxyAgent({
		...(httpProxy ? { httpProxy } : {}),
		...(httpsProxy ? { httpsProxy } : {}),
		...(noProxy !== undefined ? { noProxy } : {}),
	});
}
interface RequestOptions {
	signal?: AbortSignal | undefined;
	timeoutMs?: number | undefined;
	maxBytes: number;
	allowedHosts: readonly string[];
	environment?: NodeJS.ProcessEnv | undefined;
}
async function requestBytes(url: string, options: RequestOptions): Promise<{ bytes: Buffer; finalUrl: string }> {
	let current = new URL(url);
	const dispatcher = createNetworkDispatcher(options.environment);
	const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	let redirects = 0;
	try {
		while (true) {
			if (current.protocol !== 'https:' || !options.allowedHosts.includes(current.hostname))
				throw new Error(`download host is not allowed: ${current.hostname}`);
			const response = await fetch(current, {
				dispatcher,
				signal,
				redirect: 'manual',
				headers: { 'user-agent': '@hyxi/pi-toolchain' },
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				if (!location || ++redirects > 5) throw new Error('invalid download redirect');
				current = new URL(location, current);
				continue;
			}
			if (!response.ok || !response.body) throw new Error(`download failed with HTTP ${String(response.status)}`);
			const chunks: Uint8Array[] = [];
			let size = 0;
			for await (const raw of response.body) {
				const chunk = raw as Uint8Array;
				size += chunk.byteLength;
				if (size > options.maxBytes) throw new Error('download exceeds size limit');
				chunks.push(chunk);
			}
			return { bytes: Buffer.concat(chunks), finalUrl: current.toString() };
		}
	} catch (error) {
		throw new Error(sanitizeDiagnostic(error));
	} finally {
		await dispatcher.close();
	}
}
export async function fetchJson(url: string, options: RequestOptions): Promise<unknown> {
	const result = await requestBytes(url, options);
	try {
		return JSON.parse(result.bytes.toString('utf8')) as unknown;
	} catch {
		throw new Error('release metadata was not valid JSON');
	}
}
export async function fetchText(url: string, options: RequestOptions): Promise<string> {
	return (await requestBytes(url, options)).bytes.toString('utf8');
}
export async function download(
	url: string,
	destination: string,
	options: RequestOptions & { expectedSha256?: string },
): Promise<{ url: string; sha256: string; authenticated: boolean }> {
	const result = await requestBytes(url, options);
	const sha256 = createHash('sha256').update(result.bytes).digest('hex');
	if (options.expectedSha256 && sha256.toLowerCase() !== options.expectedSha256.toLowerCase())
		throw new Error('download checksum mismatch');
	await atomicWriteFile(destination, result.bytes, 0o600);
	return { url: result.finalUrl, sha256, authenticated: options.expectedSha256 !== undefined };
}
