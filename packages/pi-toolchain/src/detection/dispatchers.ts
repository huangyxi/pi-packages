const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function dispatchedCommands(name: string, args: readonly string[]): string[] {
	if (name === 'command') {
		for (const value of args) {
			if (value === '--') continue;
			if (value.startsWith('-') || assignment.test(value)) continue;
			return [value];
		}
	}
	if (name === 'env') {
		for (let index = 0; index < args.length; index++) {
			const value = args[index]!;
			if (value === '--') continue;
			if (value === '-u' || value === '--unset' || value === '-C' || value === '--chdir') {
				index++;
				continue;
			}
			if (
				value.startsWith('--unset=') ||
				value.startsWith('--chdir=') ||
				value.startsWith('-') ||
				assignment.test(value)
			)
				continue;
			return [value];
		}
	}
	if (name === 'which' || name === 'type') return args.filter((value) => !value.startsWith('-'));
	if (name === 'xargs') {
		for (let index = 0; index < args.length; index++) {
			const value = args[index]!;
			if (value === '--') return args[index + 1] ? [args[index + 1]!] : [];
			if (
				[
					'-a',
					'--arg-file',
					'-d',
					'--delimiter',
					'-E',
					'-I',
					'-L',
					'-n',
					'-P',
					'-s',
				].includes(value)
			) {
				index++;
				continue;
			}
			if (!value.startsWith('-')) return [value];
		}
	}
	if (name === 'find') {
		const result: string[] = [];
		for (let index = 0; index < args.length - 1; index++)
			if (
				[
					'-exec',
					'-execdir',
					'-ok',
					'-okdir',
				].includes(args[index]!)
			)
				result.push(args[index + 1]!);
		return result;
	}
	if (['bash', 'sh'].includes(name)) {
		const commandIndex = args.findIndex((value) => value === '-c' || value === '-lc');
		return commandIndex >= 0 && args[commandIndex + 1] ? [`__shell__:${args[commandIndex + 1]}`] : [];
	}
	return [name];
}
