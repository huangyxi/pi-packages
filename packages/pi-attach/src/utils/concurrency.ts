export async function mapConcurrent<Input, Output>(
	items: readonly Input[],
	concurrency: number,
	map: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
	const output = new Array<Output>(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			for (;;) {
				const index = next++;
				if (index >= items.length) return;
				output[index] = await map(items[index] as Input, index);
			}
		}),
	);
	return output;
}
