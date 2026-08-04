export type BypassMode = 'filter' | 'redaction' | 'all';

const DIRECTIVES = new Map<string, BypassMode>([
	['<pi-envguard:skip-filter!>', 'filter'],
	['<pi-envguard:skip-redaction!>', 'redaction'],
	['<pi-envguard:skip-all!>', 'all'],
]);

interface ParsedDirectives {
	text: string;
	mode?: BypassMode;
	found: boolean;
}

function unionBypass(left: BypassMode | undefined, right: BypassMode): BypassMode {
	if (!left) return right;
	if (left === 'all' || right === 'all' || left !== right) return 'all';
	return left;
}

export function parseDirectives(text: string): ParsedDirectives {
	const lines = text.split('\n');
	let index = 0;
	while (index < lines.length && lines[index]?.trim() === '') index += 1;
	const start = index;
	let mode: BypassMode | undefined;
	while (index < lines.length) {
		const directive = DIRECTIVES.get(lines[index]?.trim() ?? '');
		if (!directive) break;
		mode = unionBypass(mode, directive);
		index += 1;
	}
	if (index === start) return { text, found: false };
	return {
		text: [...lines.slice(0, start), ...lines.slice(index)].join('\n'),
		...(mode ? { mode } : {}),
		found: true,
	};
}

export function bypassesFilter(mode: BypassMode | undefined): boolean {
	return mode === 'filter' || mode === 'all';
}

export function bypassesRedaction(mode: BypassMode | undefined): boolean {
	return mode === 'redaction' || mode === 'all';
}
