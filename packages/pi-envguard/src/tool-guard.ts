import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';

import type { EnvguardConfig } from './config';
import { bypassesFilter, bypassesRedaction, type BypassMode } from './directives';
import { type CompiledRule, resolveProtectedEnvironment } from './environment';
import { createLiteralRedactor } from './redaction';
import { injectUnset, removeInjectedSegment } from './shell';

const WITHHELD_OUTPUT = '[pi-envguard: output withheld because redaction failed]';

interface RuntimePolicy {
	config: EnvguardConfig;
	rules: readonly CompiledRule[];
	bypass: BypassMode | undefined;
}

interface FrozenToolPolicy {
	redact: boolean;
	rules: readonly CompiledRule[];
	minimumRedactionValueLength: number;
	visiblePrefixLength: number;
	visibleSuffixLength: number;
	redactionMarker: string;
}

interface MutableToolInput {
	command?: unknown;
}

interface ToolCallRecord {
	input: MutableToolInput;
	injectedSegment?: string;
	policy: FrozenToolPolicy;
	protectedValuesAtCall: readonly string[];
}

interface ToolResultPatch {
	content: ToolResultEvent['content'];
}

interface TextBlock {
	type: 'text';
	text: string;
	[key: string]: unknown;
}

function isTextBlock(value: unknown): value is TextBlock {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { type?: unknown }).type === 'text' &&
		typeof (value as { text?: unknown }).text === 'string'
	);
}

function categoryEnabled(pi: ExtensionAPI, toolName: string, config: EnvguardConfig): boolean {
	if (toolName === 'bash') return config.redactBashToolResults;
	const tool = pi.getAllTools().find((candidate) => candidate.name === toolName);
	return tool?.sourceInfo.source === 'builtin'
		? config.redactOtherBuiltinToolResults
		: config.redactThirdPartyToolResults;
}

function withholdText(content: ToolResultEvent['content']): ToolResultEvent['content'] {
	return content.map((block) => (isTextBlock(block) ? { ...block, text: WITHHELD_OUTPUT } : block));
}

/** Captures immutable call policy and composes command cleanup with result redaction. */
export class ToolGuard {
	private readonly calls = new Map<string, ToolCallRecord>();
	private readonly pi: ExtensionAPI;
	private readonly getRuntimePolicy: () => RuntimePolicy;
	private readonly reportFailure: (context: ExtensionContext, message: string) => void;

	public constructor(
		pi: ExtensionAPI,
		getRuntimePolicy: () => RuntimePolicy,
		reportFailure: (context: ExtensionContext, message: string) => void,
	) {
		this.pi = pi;
		this.getRuntimePolicy = getRuntimePolicy;
		this.reportFailure = reportFailure;
	}

	public handleCall(event: ToolCallEvent, context: ExtensionContext): ToolCallEventResult | undefined {
		const runtime = this.getRuntimePolicy();
		const protectedEnvironment = resolveProtectedEnvironment(
			process.env,
			runtime.rules,
			runtime.config.minimumRedactionValueLength,
		);
		const record = this.captureCall(event, runtime, protectedEnvironment.values);

		if (!this.requiresBashFiltering(event, runtime, protectedEnvironment.names)) return;
		if (typeof record.input.command !== 'string') {
			this.calls.delete(event.toolCallId);
			this.reportFailure(context, `Pi Envguard blocked malformed bash tool input (${event.toolName}).`);
			return { block: true, reason: 'Pi Envguard could not filter the bash environment.' };
		}

		const injected = injectUnset(record.input.command, protectedEnvironment.names);
		record.input.command = injected.command;
		record.injectedSegment = injected.injectedSegment;
	}

	public handleResult(event: ToolResultEvent, context: ExtensionContext): ToolResultPatch | undefined {
		const record = this.takeCall(event.toolCallId);
		const policy = record?.policy ?? this.fallbackPolicy(event.toolName);
		if (!policy.redact) return;

		// Without the call snapshot, current process.env cannot reconstruct deleted values.
		if (!record) {
			this.reportFailure(context, 'Pi Envguard withheld tool output because its call policy was unavailable.');
			return { content: withholdText(event.content) };
		}

		const protectedAtResult = resolveProtectedEnvironment(
			process.env,
			policy.rules,
			policy.minimumRedactionValueLength,
		);
		const values = [...new Set([...record.protectedValuesAtCall, ...protectedAtResult.values])];
		if (values.length === 0) return;
		return this.redactResult(event, context, policy, values);
	}

	public cleanupCalls(): void {
		for (const record of this.calls.values()) this.cleanupCommand(record);
		this.calls.clear();
	}

	private captureCall(
		event: ToolCallEvent,
		runtime: RuntimePolicy,
		protectedValues: readonly string[],
	): ToolCallRecord {
		const record: ToolCallRecord = {
			input: event.input as MutableToolInput,
			policy: Object.freeze({
				redact: categoryEnabled(this.pi, event.toolName, runtime.config) && !bypassesRedaction(runtime.bypass),
				rules: runtime.rules,
				minimumRedactionValueLength: runtime.config.minimumRedactionValueLength,
				visiblePrefixLength: runtime.config.visiblePrefixLength,
				visibleSuffixLength: runtime.config.visibleSuffixLength,
				redactionMarker: runtime.config.redactionMarker,
			}),
			protectedValuesAtCall: protectedValues,
		};
		this.calls.set(event.toolCallId, record);
		return record;
	}

	private requiresBashFiltering(
		event: ToolCallEvent,
		runtime: RuntimePolicy,
		protectedNames: readonly string[],
	): boolean {
		return (
			event.toolName === 'bash' &&
			runtime.config.filterBashEnvironment &&
			!bypassesFilter(runtime.bypass) &&
			protectedNames.length > 0
		);
	}

	private takeCall(toolCallId: string): ToolCallRecord | undefined {
		const record = this.calls.get(toolCallId);
		if (!record) return;
		this.cleanupCommand(record);
		this.calls.delete(toolCallId);
		return record;
	}

	private cleanupCommand(record: ToolCallRecord): void {
		if (record.injectedSegment && typeof record.input.command === 'string') {
			record.input.command = removeInjectedSegment(record.input.command, record.injectedSegment);
		}
	}

	private fallbackPolicy(toolName: string): FrozenToolPolicy {
		const { config, rules } = this.getRuntimePolicy();
		return {
			redact: categoryEnabled(this.pi, toolName, config),
			rules,
			minimumRedactionValueLength: config.minimumRedactionValueLength,
			visiblePrefixLength: config.visiblePrefixLength,
			visibleSuffixLength: config.visibleSuffixLength,
			redactionMarker: config.redactionMarker,
		};
	}

	private redactResult(
		event: ToolResultEvent,
		context: ExtensionContext,
		policy: FrozenToolPolicy,
		values: readonly string[],
	): ToolResultPatch {
		try {
			const redactor = createLiteralRedactor(values, policy);
			return {
				content: event.content.map((block) =>
					isTextBlock(block) ? { ...block, text: redactor.redact(block.text) } : block,
				),
			};
		} catch {
			this.reportFailure(context, 'Pi Envguard withheld tool output because redaction failed.');
			return { content: withholdText(event.content) };
		}
	}
}
