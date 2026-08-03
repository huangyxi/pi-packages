import { isAbsolute, join, resolve } from 'node:path';
import {
	getAgentDirectory,
	defineConfigSchema,
	integerField,
	readGlobalConfig,
	stringEnumField,
	stringField,
} from '@/src/utils/config';

const schema = defineConfigSchema('toolchain', {
	toolkitDirectory: stringField(''),
	toolResolutionOrder: stringEnumField('managed-first', ['managed-first', 'system-first']),
	automaticInstallationTimeoutSeconds: integerField(600, 0),
});

export interface ToolchainConfig {
	agentDirectory: string;
	toolkitDirectory: string;
	toolResolutionOrder: 'managed-first' | 'system-first';
	automaticInstallationTimeoutSeconds: number;
}

function expandHome(value: string, home: string): string {
	return value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
}

export async function readToolchainConfig(
	reportIssue: (message: string) => void = () => undefined,
	env: NodeJS.ProcessEnv = process.env,
	home = env.HOME ?? '',
): Promise<ToolchainConfig> {
	const agentDirectory = getAgentDirectory(env, home);
	const raw = await readGlobalConfig(schema, reportIssue, { env, home, reportUnknownFields: true });
	const configured =
		raw.toolkitDirectory === '' ? join(agentDirectory, 'toolchain') : expandHome(raw.toolkitDirectory, home);
	const toolkitDirectory = isAbsolute(configured) ? resolve(configured) : resolve(agentDirectory, configured);
	return {
		agentDirectory,
		toolkitDirectory,
		toolResolutionOrder: raw.toolResolutionOrder,
		automaticInstallationTimeoutSeconds: raw.automaticInstallationTimeoutSeconds,
	};
}
