import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { EnvguardRuntime } from './runtime';

export default function envguard(pi: ExtensionAPI): void {
	const runtime = new EnvguardRuntime(pi);

	pi.on('input', runtime.handleInput);
	pi.on('tool_call', runtime.handleToolCall);
	pi.on('tool_result', runtime.handleToolResult);
	pi.on('context', runtime.cleanupToolCalls);
	pi.on('turn_end', runtime.cleanupToolCalls);
	pi.on('session_start', runtime.handleSessionStart);
	pi.on('session_shutdown', runtime.handleSessionShutdown);
}
