function quoteShellWord(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function createUnsetSegment(names: readonly string[]): string {
	return `unset -v -- ${names.map(quoteShellWord).join(' ')} 2>/dev/null || true; `;
}

export function injectUnset(
	command: string,
	names: readonly string[],
): {
	command: string;
	injectedSegment: string;
} {
	const injectedSegment = createUnsetSegment(names);
	return { command: `${injectedSegment}${command}`, injectedSegment };
}

export function removeInjectedSegment(command: string, injectedSegment: string): string {
	const index = command.indexOf(injectedSegment);
	return index < 0 ? command : `${command.slice(0, index)}${command.slice(index + injectedSegment.length)}`;
}
