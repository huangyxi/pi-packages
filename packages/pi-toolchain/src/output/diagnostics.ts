export const EXIT_CODES = {
	usage: 2,
	unsupported: 3,
	dependencyConflict: 4,
	deadline: 5,
	lifecycle: 6,
	ownership: 7,
	cancelled: 130,
} as const;

export class ToolchainError extends Error {
	readonly code: keyof typeof EXIT_CODES;
	readonly toolchainId: string | undefined;
	readonly recovery: string[];
	constructor(code: keyof typeof EXIT_CODES, message: string, toolchainId?: string, recovery: string[] = []) {
		super(message);
		this.name = 'ToolchainError';
		this.code = code;
		this.toolchainId = toolchainId;
		this.recovery = recovery;
	}
}

export function sanitizeDiagnostic(value: unknown): string {
	const message = value instanceof Error ? value.message : String(value);
	return message.replace(/([a-z]+:\/\/)[^/@\s]+@/gi, '$1[redacted]@').slice(0, 2000);
}
