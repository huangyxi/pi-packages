import {
	booleanField,
	defineConfigSchema,
	type InferConfig,
	integerField,
	orderedStringListField,
	stringField,
} from '@/src/utils/config';

const NON_EMPTY_STRING = /.+/s; // Dot-all allows a marker containing line breaks.

const DEFAULT_RULES = [
	'*_TOKEN',
	'*_SECRET',
	'*_PASSWORD',
	'*_KEY',
] as const;

function validRule(rule: string): boolean {
	return rule.startsWith('!') ? rule.length > 1 : rule.length > 0;
}

export const ENVGUARD_CONFIG_SCHEMA = defineConfigSchema(
	'envguard',
	{
		protectedEnvironmentVariables: orderedStringListField(DEFAULT_RULES, validRule),
		filterBashEnvironment: booleanField(true),
		redactBashToolResults: booleanField(true),
		redactOtherBuiltinToolResults: booleanField(false),
		redactThirdPartyToolResults: booleanField(false),
		minimumRedactionValueLength: integerField(8, 1),
		visiblePrefixLength: integerField(4, 0),
		visibleSuffixLength: integerField(0, 0),
		redactionMarker: stringField('****', NON_EMPTY_STRING),
	},
	{
		validationGroups: [
			{
				validate: (config) =>
					config.visiblePrefixLength + config.visibleSuffixLength < config.minimumRedactionValueLength
						? undefined
						: 'visiblePrefixLength',
			},
		],
	},
);

export type EnvguardConfig = InferConfig<typeof ENVGUARD_CONFIG_SCHEMA>;

export const ENVGUARD_DEFAULT_CONFIG = Object.freeze(
	Object.fromEntries(
		Object.entries(ENVGUARD_CONFIG_SCHEMA.fields).map(([key, field]) => [key, field.defaultValue]),
	) as EnvguardConfig,
);
