declare module '@ericcornelissen/bash-parser' {
	function parse(source: string, options?: { mode?: 'posix' }): unknown;
	export = parse;
}
