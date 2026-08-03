interface AstNode {
	type?: string;
	text?: string;
	name?: AstNode;
	suffix?: AstNode[];
	commands?: AstNode[];
	left?: AstNode;
	right?: AstNode;
	body?: AstNode;
	list?: AstNode;
	expansion?: AstNode[];
	commandAST?: AstNode;
	[key: string]: unknown;
}

export interface AstCommand {
	name: string;
	arguments: string[];
}

function node(value: unknown): AstNode | undefined {
	return value !== null && typeof value === 'object' ? (value as AstNode) : undefined;
}

export function walkBashAst(value: unknown, visit: (command: AstCommand) => void): void {
	const seen = new Set<object>();
	const walk = (candidate: unknown): void => {
		const current = node(candidate);
		if (!current || seen.has(current)) return;
		seen.add(current);
		if (current.type === 'Command' && typeof current.name?.text === 'string') {
			visit({
				name: current.name.text,
				arguments: (current.suffix ?? []).flatMap((word) => (typeof word.text === 'string' ? [word.text] : [])),
			});
		}
		for (const key of [
			'commands',
			'left',
			'right',
			'body',
			'list',
			'commandAST',
			'expansion',
		] as const) {
			const child = current[key];
			if (Array.isArray(child)) for (const item of child) walk(item);
			else walk(child);
		}
		for (const word of current.suffix ?? [])
			for (const expansion of word.expansion ?? []) walk(expansion.commandAST);
	};
	walk(value);
}
