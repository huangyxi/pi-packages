import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

interface ConfigField<T> {
	defaultValue: T;
	validate(value: unknown): value is T;
	kind?: 'scalar' | 'ordered-list';
}

type ConfigFields = Record<string, ConfigField<unknown>>;

interface ConfigValidationGroup<Config extends Record<string, unknown>> {
	validate(config: Config): string | undefined;
}

interface ConfigSchema<Name extends string = string, Fields extends ConfigFields = ConfigFields> {
	name: Name;
	fields: Fields;
	validationGroups: readonly ConfigValidationGroup<InferFields<Fields>>[];
}

type InferFields<Fields extends ConfigFields> = {
	[Key in keyof Fields]: Fields[Key] extends ConfigField<infer Value> ? Value : never;
};

export type InferConfig<Schema extends ConfigSchema> = InferFields<Schema['fields']>;

export function defineConfigSchema<const Name extends string, const Fields extends ConfigFields>(
	name: Name,
	fields: Fields,
	options: { validationGroups?: readonly ConfigValidationGroup<InferFields<Fields>>[] } = {},
): ConfigSchema<Name, Fields> {
	return { name, fields, validationGroups: options.validationGroups ?? [] };
}

export function booleanField(defaultValue: boolean): ConfigField<boolean> {
	return { defaultValue, validate: (value): value is boolean => typeof value === 'boolean' };
}

/** Validates strings against an optional pattern without stateful `g` or `y` behavior. */
export function stringField(defaultValue: string, pattern?: RegExp): ConfigField<string> {
	const flags = pattern?.flags
		.split('')
		.filter((flag) => flag !== 'g' && flag !== 'y')
		.join('');
	const validator = pattern ? new RegExp(pattern.source, flags) : undefined;
	return {
		defaultValue,
		validate: (value): value is string => typeof value === 'string' && (validator?.test(value) ?? true),
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

/**
 * Defines an ordered string list with scope modifiers: `+key` prepends and
 * `key+` appends; bare `key` replaces and cannot coexist with either modifier.
 */
export function orderedStringListField(
	defaultValue: readonly string[],
	validateEntry: (value: string) => boolean = () => true,
): ConfigField<readonly string[]> {
	return {
		defaultValue: [...defaultValue],
		kind: 'ordered-list',
		validate: (value): value is readonly string[] =>
			Array.isArray(value) && value.every((entry) => typeof entry === 'string' && validateEntry(entry)),
	};
}

function getAgentDirectory(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	const configured = env.PI_CODING_AGENT_DIR;
	if (configured === undefined || configured === '') return join(home, '.pi', 'agent');
	const expanded =
		configured === '~' ? home : configured.startsWith('~/') ? join(home, configured.slice(2)) : configured;
	if (!isAbsolute(expanded)) throw new Error('PI_CODING_AGENT_DIR must be an absolute path');
	return resolve(expanded);
}

interface ReadConfigFileOptions {
	reportUnknownFields?: boolean;
}

/** Metadata used to invalidate parsed outcomes after edits and atomic replacements. */
interface Signature {
	dev: bigint;
	ino: bigint;
	size: bigint;
	mtimeNs: bigint;
	ctimeNs: bigint;
}

interface ParsedFile {
	status: 'missing' | 'loaded' | 'invalid';
	values: Record<string, unknown>;
	issues: readonly string[];
	signature: Signature | undefined;
}

interface CacheEntry {
	signature: Signature | undefined;
	parsed: ParsedFile;
}

interface ConfigReadResult<Config> {
	config: Config;
	issues: readonly string[];
	valid: boolean;
}

interface ConfigReaderReadOptions {
	cwd: string;
	trusted: boolean;
	reportIssue?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
	home?: string;
}

interface ConfigReader<Config> {
	read(options: ConfigReaderReadOptions): Promise<ConfigReadResult<Config>>;
	invalidate(): void;
}

interface CreateConfigReaderOptions extends ReadConfigFileOptions {
	/** Preserve the historical partial-field fallback used by older callers. */
	allowPartialFiles?: boolean;
}

function sameSignature(left: Signature | undefined, right: Signature | undefined): boolean {
	if (!left || !right) return left === right;
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs
	);
}

async function metadata(path: string): Promise<Signature | undefined> {
	try {
		const value = await stat(path, { bigint: true });
		return {
			dev: value.dev,
			ino: value.ino,
			size: value.size,
			mtimeNs: value.mtimeNs,
			ctimeNs: value.ctimeNs,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

function configDefaults<Schema extends ConfigSchema>(schema: Schema): InferConfig<Schema> {
	return Object.fromEntries(
		Object.entries(schema.fields).map(([key, field]) => [
			key,
			field.kind === 'ordered-list' ? [...(field.defaultValue as readonly unknown[])] : field.defaultValue,
		]),
	) as InferConfig<Schema>;
}

function allowedKeys(schema: ConfigSchema): Set<string> {
	const keys = new Set(Object.keys(schema.fields));
	for (const [key, field] of Object.entries(schema.fields)) {
		if (field.kind === 'ordered-list') {
			keys.add(`+${key}`);
			keys.add(`${key}+`);
		}
	}
	return keys;
}

function parseObject(
	schema: ConfigSchema,
	path: string,
	value: unknown,
	reportUnknownFields: boolean,
): { values: Record<string, unknown>; issues: string[] } {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { values: {}, issues: [`invalid configuration: ${path}`] };
	}
	const object = value as Record<string, unknown>;
	const issues: string[] = [];
	const values: Record<string, unknown> = {};
	const allowed = allowedKeys(schema);
	if (reportUnknownFields) {
		for (const key of Object.keys(object)) {
			if (!allowed.has(key)) issues.push(`unknown ${key} in ${path}`);
		}
	}
	for (const [key, field] of Object.entries(schema.fields)) {
		const names = field.kind === 'ordered-list' ? [`+${key}`, key, `${key}+`] : [key];
		if (field.kind === 'ordered-list' && key in object && (`+${key}` in object || `${key}+` in object)) {
			issues.push(`invalid ${key} in ${path}`);
			continue;
		}
		for (const name of names) {
			if (!(name in object)) continue;
			const candidate = object[name];
			if (field.validate(candidate)) values[name] = candidate;
			else issues.push(`invalid ${name} in ${path}`);
		}
	}
	return { values, issues };
}

function applyScope<Schema extends ConfigSchema>(
	schema: Schema,
	inherited: InferConfig<Schema>,
	values: Record<string, unknown>,
	path: string,
): { config: InferConfig<Schema>; issues: string[] } {
	const next = { ...inherited } as Record<string, unknown>;
	for (const [key, field] of Object.entries(schema.fields)) {
		if (field.kind !== 'ordered-list') {
			if (key in values) next[key] = values[key];
			continue;
		}
		if (key in values) {
			next[key] = [...(values[key] as readonly string[])];
			continue;
		}
		const prepend = (values[`+${key}`] as readonly string[] | undefined) ?? [];
		const append = (values[`${key}+`] as readonly string[] | undefined) ?? [];
		next[key] = [...prepend, ...(next[key] as readonly string[]), ...append];
	}
	const issues = schema.validationGroups.flatMap((group) => {
		const field = group.validate(next);
		return field ? [`invalid ${field} in ${path}`] : [];
	});
	return { config: next as InferConfig<Schema>, issues };
}

/** Creates an independently cached global/project reader bound to one schema. */
export function createConfigReader<Schema extends ConfigSchema>(
	schema: Schema,
	options: CreateConfigReaderOptions = {},
): ConfigReader<InferConfig<Schema>> {
	const cache = new Map<string, CacheEntry>();

	async function load(path: string): Promise<ParsedFile> {
		let before: Signature | undefined;
		try {
			before = await metadata(path);
		} catch {
			return {
				status: 'invalid',
				values: {},
				issues: [`invalid configuration: ${path}`],
				signature: undefined,
			};
		}
		const cached = cache.get(path);
		if (cached && sameSignature(cached.signature, before)) return cached.parsed;
		if (!before) {
			const parsed: ParsedFile = {
				status: 'missing',
				values: {},
				issues: [],
				signature: undefined,
			};
			cache.set(path, { signature: undefined, parsed });
			return parsed;
		}

		for (let attempt = 0; attempt < 2; attempt += 1) {
			// A disappearance during the first read must remain missing on a fresh stat.
			if (!before) {
				try {
					before = await metadata(path);
				} catch {
					before = undefined;
				}
				if (!before) {
					const parsed: ParsedFile = {
						status: 'missing',
						values: {},
						issues: [],
						signature: undefined,
					};
					cache.set(path, { signature: undefined, parsed });
					return parsed;
				}
			}
			try {
				const source = await readFile(path, 'utf8');
				const after = await metadata(path);
				if (!sameSignature(before, after)) {
					before = after;
					continue;
				}
				let parsedObject: { values: Record<string, unknown>; issues: string[] };
				try {
					parsedObject = parseObject(
						schema,
						path,
						JSON.parse(source) as unknown,
						options.reportUnknownFields ?? true,
					);
				} catch {
					parsedObject = { values: {}, issues: [`invalid configuration: ${path}`] };
				}
				const parsed: ParsedFile = {
					status: parsedObject.issues.length === 0 ? 'loaded' : 'invalid',
					values: parsedObject.values,
					issues: parsedObject.issues,
					signature: after,
				};
				cache.set(path, { signature: after, parsed });
				return parsed;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					before = undefined;
					continue;
				}
				const parsed: ParsedFile = {
					status: 'invalid',
					values: {},
					issues: [`invalid configuration: ${path}`],
					signature: before,
				};
				cache.set(path, { signature: before, parsed });
				return parsed;
			}
		}
		const parsed: ParsedFile = {
			status: 'invalid',
			values: {},
			issues: [`unstable configuration: ${path}`],
			signature: before,
		};
		cache.set(path, { signature: before, parsed });
		return parsed;
	}

	return {
		async read(readOptions) {
			const globalPath = join(
				getAgentDirectory(readOptions.env, readOptions.home),
				'extensions',
				`${schema.name}.json`,
			);
			const projectPath = join(readOptions.cwd, '.pi', 'extensions', `${schema.name}.json`);
			const loaded = [await load(globalPath)];
			if (readOptions.trusted) loaded.push(await load(projectPath));
			let config = configDefaults(schema);
			const issues: string[] = [];
			for (const file of loaded) {
				issues.push(...file.issues);
				const path = file === loaded[0] ? globalPath : projectPath;
				const applied = applyScope(schema, config, file.values, path);
				issues.push(...applied.issues);
				if ((file.issues.length === 0 && applied.issues.length === 0) || options.allowPartialFiles) {
					config = applied.config;
				}
			}
			for (const issue of issues) readOptions.reportIssue?.(issue);
			return { config, issues, valid: issues.length === 0 };
		},
		invalidate() {
			cache.clear();
		},
	};
}
