import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

interface ConfigField<T> {
	defaultValue: T;
	validate(value: unknown): value is T;
}

type ConfigFields = Record<string, ConfigField<unknown>>;

interface ConfigSchema<Name extends string = string, Fields extends ConfigFields = ConfigFields> {
	name: Name;
	fields: Fields;
}

export type InferConfig<Schema extends ConfigSchema> = {
	[Key in keyof Schema['fields']]: Schema['fields'][Key] extends ConfigField<infer Value> ? Value : never;
};

export function defineConfigSchema<const Name extends string, const Fields extends ConfigFields>(
	name: Name,
	fields: Fields,
): ConfigSchema<Name, Fields> {
	return { name, fields };
}

export function booleanField(defaultValue: boolean): ConfigField<boolean> {
	return {
		defaultValue,
		validate: (value): value is boolean => typeof value === 'boolean',
	};
}

export function stringField(defaultValue: string, pattern = /.*/): ConfigField<string> {
	const validator = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
	return {
		defaultValue,
		validate: (value): value is string => typeof value === 'string' && validator.test(value),
	};
}

export function numberField(
	defaultValue: number,
	minimum = Number.NEGATIVE_INFINITY,
	maximum = Number.POSITIVE_INFINITY,
): ConfigField<number> {
	return {
		defaultValue,
		validate: (value): value is number =>
			typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum,
	};
}

export function integerField(
	defaultValue: number,
	minimum = Number.MIN_SAFE_INTEGER,
	maximum = Number.MAX_SAFE_INTEGER,
): ConfigField<number> {
	return {
		defaultValue,
		validate: (value): value is number =>
			typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum,
	};
}

export function stringEnumField<const Values extends readonly [string, ...string[]]>(
	defaultValue: Values[number],
	values: Values,
): ConfigField<Values[number]> {
	const allowed = new Set<string>(values);
	return {
		defaultValue,
		validate: (value): value is Values[number] => typeof value === 'string' && allowed.has(value),
	};
}

export function getAgentDirectory(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	const configured = env.PI_CODING_AGENT_DIR;
	if (configured === undefined || configured === '') return join(home, '.pi', 'agent');
	const expanded =
		configured === '~' ? home : configured.startsWith('~/') ? join(home, configured.slice(2)) : configured;
	if (!isAbsolute(expanded)) throw new Error('PI_CODING_AGENT_DIR must be an absolute path');
	return resolve(expanded);
}

export interface ReadConfigFileOptions {
	reportUnknownFields?: boolean;
}

async function readJsonObject(
	path: string,
): Promise<{ status: 'missing' } | { status: 'invalid' } | { status: 'loaded'; value: Record<string, unknown> }> {
	try {
		const value: unknown = JSON.parse(await readFile(path, 'utf8'));
		return value !== null && typeof value === 'object' && !Array.isArray(value)
			? { status: 'loaded', value: value as Record<string, unknown> }
			: { status: 'invalid' };
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing' } : { status: 'invalid' };
	}
}

async function readConfigFile<Schema extends ConfigSchema>(
	schema: Schema,
	path: string,
	reportIssue: (message: string) => void,
	options: ReadConfigFileOptions = {},
): Promise<Partial<InferConfig<Schema>>> {
	const result = await readJsonObject(path);
	if (result.status === 'missing') return {};
	if (result.status === 'invalid') {
		reportIssue(`invalid configuration: ${path}`);
		return {};
	}

	const config: Record<string, unknown> = {};
	if (options.reportUnknownFields) {
		for (const key of Object.keys(result.value)) {
			if (!(key in schema.fields)) reportIssue(`unknown ${key} in ${path}`);
		}
	}
	for (const [key, field] of Object.entries(schema.fields)) {
		if (!(key in result.value)) continue;
		const value = result.value[key];
		if (field.validate(value)) config[key] = value;
		else reportIssue(`invalid ${key} in ${path}`);
	}
	return config as Partial<InferConfig<Schema>>;
}

function configDefaults<Schema extends ConfigSchema>(schema: Schema): InferConfig<Schema> {
	return Object.fromEntries(
		Object.entries(schema.fields).map(([key, field]) => [key, field.defaultValue]),
	) as InferConfig<Schema>;
}

export interface ReadGlobalConfigOptions extends ReadConfigFileOptions {
	env?: NodeJS.ProcessEnv;
	home?: string;
}

export async function readGlobalConfig<Schema extends ConfigSchema>(
	schema: Schema,
	reportIssue: (message: string) => void,
	options: ReadGlobalConfigOptions = {},
): Promise<InferConfig<Schema>> {
	const agentDirectory = getAgentDirectory(options.env, options.home);
	const global = await readConfigFile(
		schema,
		join(agentDirectory, 'extensions', `${schema.name}.json`),
		reportIssue,
		options,
	);
	return { ...configDefaults(schema), ...global };
}

export async function readConfig<Schema extends ConfigSchema>(
	schema: Schema,
	cwd: string,
	trusted: boolean,
	reportIssue: (message: string) => void,
): Promise<InferConfig<Schema>> {
	const global = await readConfigFile(
		schema,
		join(getAgentDirectory(), 'extensions', `${schema.name}.json`),
		reportIssue,
	);
	const project = trusted
		? await readConfigFile(schema, join(cwd, '.pi', 'extensions', `${schema.name}.json`), reportIssue)
		: {};
	return { ...configDefaults(schema), ...global, ...project };
}
