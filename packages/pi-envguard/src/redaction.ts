interface RedactionShape {
	visiblePrefixLength: number;
	visibleSuffixLength: number;
	redactionMarker: string;
}

interface TrieNode {
	children: Map<string, TrieNode>;
	value?: readonly string[];
}

interface LiteralRedactor {
	redact(text: string): string;
}

function replacement(value: readonly string[], shape: RedactionShape): string {
	const prefix = value.slice(0, shape.visiblePrefixLength).join('');
	const suffix = shape.visibleSuffixLength ? value.slice(-shape.visibleSuffixLength).join('') : '';
	return `${prefix}${shape.redactionMarker}${suffix}`;
}

export function createLiteralRedactor(values: readonly string[], shape: RedactionShape): LiteralRedactor {
	const root: TrieNode = { children: new Map() };
	for (const value of new Set(values)) {
		const characters = Array.from(value);
		if (characters.length === 0) continue;
		let node = root;
		for (const character of characters) {
			let child = node.children.get(character);
			if (!child) {
				child = { children: new Map() };
				node.children.set(character, child);
			}
			node = child;
		}
		node.value = characters;
	}

	return {
		redact(text) {
			const input = Array.from(text);
			const output: string[] = [];
			let index = 0;
			while (index < input.length) {
				let node = root;
				let cursor = index;
				let match: readonly string[] | undefined;
				while (cursor < input.length) {
					const child = node.children.get(input[cursor] ?? '');
					if (!child) break;
					node = child;
					cursor += 1;
					if (node.value) match = node.value;
				}
				if (match) {
					output.push(replacement(match, shape));
					index += match.length;
				} else {
					output.push(input[index] ?? '');
					index += 1;
				}
			}
			return output.join('');
		},
	};
}
