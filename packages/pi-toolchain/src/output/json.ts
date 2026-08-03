export interface CliEnvelope<T = unknown> {
	schemaVersion: 1;
	ok: boolean;
	command: string;
	data?: T;
	error?: { code: string; message: string; toolchainId?: string; recovery?: string[]; details?: unknown };
}

export function success<T>(command: string, data: T): CliEnvelope<T> {
	return { schemaVersion: 1, ok: true, command, data };
}
export function failure(
	command: string,
	error: { code: string; message: string; toolchainId?: string; recovery?: string[] },
): CliEnvelope {
	return { schemaVersion: 1, ok: false, command, error };
}
