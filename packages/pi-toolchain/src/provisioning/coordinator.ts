interface Active<T> {
	controller: AbortController;
	promise: Promise<T>;
	waiters: number;
}
const active = new Map<string, Active<unknown>>();

export async function coordinate<T>(
	key: string,
	signal: AbortSignal | undefined,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	if (signal?.aborted) throw signal.reason ?? new Error('cancelled');
	let entry = active.get(key) as Active<T> | undefined;
	if (!entry || entry.controller.signal.aborted) {
		const controller = new AbortController();
		const created: Active<T> = { controller, waiters: 0, promise: Promise.resolve(undefined as T) };
		created.promise = work(controller.signal).finally(() => {
			if (active.get(key) === created) active.delete(key);
		});
		active.set(key, created);
		entry = created;
	}
	entry.waiters++;
	let abortListener: (() => void) | undefined;
	let cancelled = false;
	try {
		if (!signal) return await entry.promise;
		return await Promise.race([
			entry.promise,
			new Promise<T>((_resolve, reject) => {
				abortListener = (): void => {
					cancelled = true;
					reject(signal.reason ?? new Error('cancelled'));
				};
				signal.addEventListener('abort', abortListener, { once: true });
			}),
		]);
	} finally {
		if (abortListener) signal?.removeEventListener('abort', abortListener);
		entry.waiters--;
		if (cancelled && entry.waiters === 0 && !entry.controller.signal.aborted)
			entry.controller.abort(new Error('all waiters cancelled'));
	}
}
