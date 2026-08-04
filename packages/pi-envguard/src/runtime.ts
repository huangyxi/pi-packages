import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';

import { createConfigReader } from '@/src/utils/config';

import { BypassController } from './bypass';
import { ENVGUARD_CONFIG_SCHEMA, ENVGUARD_DEFAULT_CONFIG, type EnvguardConfig } from './config';
import { parseDirectives } from './directives';
import { type CompiledRule, compileRules } from './environment';
import { ToolGuard } from './tool-guard';

/** Owns resolved policy and routes Pi lifecycle events to focused state modules. */
export class EnvguardRuntime {
	private readonly configReader = createConfigReader(ENVGUARD_CONFIG_SCHEMA);
	private readonly bypass = new BypassController();
	private readonly toolGuard: ToolGuard;
	private config: EnvguardConfig = ENVGUARD_DEFAULT_CONFIG;
	private rules: readonly CompiledRule[] = compileRules(this.config.protectedEnvironmentVariables);

	public constructor(pi: ExtensionAPI) {
		this.toolGuard = new ToolGuard(
			pi,
			() => ({ config: this.config, rules: this.rules, bypass: this.bypass.mode }),
			(context, message) => {
				this.notify(context, message, 'error');
			},
		);
	}

	public readonly handleInput = async (event: InputEvent, context: ExtensionContext): Promise<InputEventResult> => {
		const issues = await this.refreshConfiguration(context);
		if (issues.length > 0) return this.blockInvalidInput(event, context, issues);
		if (event.source === 'extension') return { action: 'continue' };
		return this.applyUserDirectives(event, context);
	};

	public readonly handleToolCall = (
		event: ToolCallEvent,
		context: ExtensionContext,
	): ToolCallEventResult | undefined => this.toolGuard.handleCall(event, context);

	public readonly handleToolResult = (event: ToolResultEvent, context: ExtensionContext) =>
		this.toolGuard.handleResult(event, context);

	public readonly cleanupToolCalls = (): void => {
		this.toolGuard.cleanupCalls();
	};

	public readonly handleSessionStart = (_event: SessionStartEvent, context: ExtensionContext): void => {
		if (this.bypass.mode) this.bypass.activate(this.bypass.mode, context);
	};

	public readonly handleSessionShutdown = (_event: SessionShutdownEvent, context: ExtensionContext): void => {
		this.toolGuard.cleanupCalls();
		this.bypass.clear(context);
		this.configReader.invalidate();
	};

	private async refreshConfiguration(context: ExtensionContext): Promise<readonly string[]> {
		const result = await this.configReader.read({
			cwd: context.cwd,
			trusted: context.isProjectTrusted(),
		});
		if (!result.valid) return result.issues;
		this.config = result.config;
		this.rules = compileRules(result.config.protectedEnvironmentVariables);
		return [];
	}

	private blockInvalidInput(
		event: InputEvent,
		context: ExtensionContext,
		issues: readonly string[],
	): InputEventResult {
		this.notify(
			context,
			`Pi Envguard blocked input because configuration is invalid:\n${issues.join('\n')}`,
			'error',
		);
		if (event.source !== 'extension') {
			if (event.streamingBehavior === 'steer') context.abort();
			else this.bypass.clearAfterBlockedInput(context);
		}
		return { action: 'handled' };
	}

	private applyUserDirectives(event: InputEvent, context: ExtensionContext): InputEventResult {
		const steering = event.streamingBehavior === 'steer';
		const parsed = parseDirectives(event.text);
		if (!steering) this.bypass.prepareNonSteeringInput(context);
		if (!parsed.found) {
			this.bypass.showStatus(context);
			return { action: 'continue' };
		}

		const hasRetainedContent = parsed.text.trim() !== '' || (event.images?.length ?? 0) > 0;
		if (!steering && !hasRetainedContent) {
			this.notify(context, 'Pi Envguard directives must be followed by text or an image.', 'warning');
			return { action: 'handled' };
		}

		this.bypass.activate(parsed.mode, context);
		if (!hasRetainedContent) return { action: 'handled' };
		return {
			action: 'transform',
			text: parsed.text,
			...(event.images ? { images: event.images } : {}),
		};
	}

	private notify(context: ExtensionContext, message: string, severity: 'warning' | 'error'): void {
		if (context.hasUI) context.ui.notify(message, severity);
		else console.error(message);
	}
}
