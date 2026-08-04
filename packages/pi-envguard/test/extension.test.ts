import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import envguard from '../src/extension';

type Handler = (event: never, context: never) => unknown;

const temporaryDirectories: string[] = [];
const harnessCleanups: (() => Promise<void>)[] = [];
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR;
const originalSecret = process.env.ENVGUARD_TEST_KEY;
const originalChild = process.env.PI_SUBAGENT_CHILD;
const originalBypass = process.env.PI_ENVGUARD_BYPASS;

async function harness(config: Record<string, unknown> = {}): Promise<{
	handler(name: string): Handler;
	context: ExtensionContext;
	notify: ReturnType<typeof vi.fn>;
	setStatus: ReturnType<typeof vi.fn>;
	abort: ReturnType<typeof vi.fn>;
	configurationPath: string;
}> {
	const root = await mkdtemp(join(tmpdir(), 'envguard-extension-'));
	temporaryDirectories.push(root);
	process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
	const path = join(root, 'agent', 'extensions', 'envguard.json');
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, JSON.stringify({ protectedEnvironmentVariables: ['ENVGUARD_TEST_KEY'], ...config }));
	const handlers = new Map<string, Handler>();
	const api = {
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		getAllTools: () => [
			{ name: 'bash', sourceInfo: { source: 'builtin' } },
			{ name: 'read', sourceInfo: { source: 'builtin' } },
			{ name: 'custom', sourceInfo: { source: 'extension' } },
		],
	} as unknown as ExtensionAPI;
	const notify = vi.fn();
	const setStatus = vi.fn();
	const abort = vi.fn();
	const context = {
		cwd: join(root, 'project'),
		hasUI: true,
		mode: 'tui',
		isProjectTrusted: () => false,
		abort,
		ui: { notify, setStatus },
	} as unknown as ExtensionContext;
	envguard(api);
	harnessCleanups.push(async () => {
		await handlers.get('session_shutdown')?.({} as never, context as never);
	});
	return {
		handler(name) {
			const handler = handlers.get(name);
			if (!handler) throw new Error(`missing ${name} handler`);
			return handler;
		},
		context,
		notify,
		setStatus,
		abort,
		configurationPath: path,
	};
}

function restore(name: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, name);
	else process.env[name] = value;
}

afterEach(async () => {
	await Promise.all(harnessCleanups.splice(0).map((cleanup) => cleanup()));
	restore('PI_CODING_AGENT_DIR', originalAgentDirectory);
	restore('ENVGUARD_TEST_KEY', originalSecret);
	restore('PI_SUBAGENT_CHILD', originalChild);
	restore('PI_ENVGUARD_BYPASS', originalBypass);
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('envguard extension', () => {
	it('injects Bash filtering, redacts text, and cleans only its segment', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const input = { command: 'printf output' };
		await test.handler('tool_call')({ toolCallId: 'one', toolName: 'bash', input } as never, test.context as never);
		expect(input.command).toBe("unset -v -- 'ENVGUARD_TEST_KEY' 2>/dev/null || true; printf output");
		input.command = `prefix; ${input.command}; suffix`;
		const result = await test.handler('tool_result')(
			{
				toolCallId: 'one',
				toolName: 'bash',
				input,
				content: [
					{ type: 'text', text: 'value=abcdefgh1234' },
					{ type: 'image', data: 'abcdefgh1234' },
				],
				details: { raw: 'abcdefgh1234' },
				isError: false,
			} as never,
			test.context as never,
		);
		expect(input.command).toBe('prefix; printf output; suffix');
		expect(result).toEqual({
			content: [
				{ type: 'text', text: 'value=abcd****' },
				{ type: 'image', data: 'abcdefgh1234' },
			],
		});
	});

	it('unions call-time and result-time environment values', async () => {
		process.env.ENVGUARD_TEST_KEY = 'old-secret-value';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'union', toolName: 'bash', input } as never,
			test.context as never,
		);
		process.env.ENVGUARD_TEST_KEY = 'new-secret-value';
		const result = await test.handler('tool_result')(
			{
				toolCallId: 'union',
				toolName: 'bash',
				input,
				content: [{ type: 'text', text: 'old-secret-value new-secret-value' }],
			} as never,
			test.context as never,
		);
		expect(result).toEqual({ content: [{ type: 'text', text: 'old-**** new-****' }] });
	});

	it('freezes redaction policy at tool call across later steering', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'snapshot', toolName: 'bash', input } as never,
			test.context as never,
		);
		await test.handler('input')(
			{
				text: '<pi-envguard:skip-redaction!>',
				source: 'rpc',
				streamingBehavior: 'steer',
			} as never,
			test.context as never,
		);
		const result = await test.handler('tool_result')(
			{
				toolCallId: 'snapshot',
				toolName: 'bash',
				input,
				content: [{ type: 'text', text: 'abcdefgh1234' }],
			} as never,
			test.context as never,
		);
		expect(result).toEqual({ content: [{ type: 'text', text: 'abcd****' }] });
		expect(test.setStatus).toHaveBeenCalledWith('envguard', 'envguard: skip redaction');
	});

	it('bypasses filtering and redaction for a skip-all input', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		const transformed = await test.handler('input')(
			{ text: '<pi-envguard:skip-all!>\nrun', source: 'interactive' } as never,
			test.context as never,
		);
		expect(transformed).toMatchObject({ action: 'transform', text: 'run' });
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'bypass', toolName: 'bash', input } as never,
			test.context as never,
		);
		expect(input.command).toBe('run');
		const result = await test.handler('tool_result')(
			{
				toolCallId: 'bypass',
				toolName: 'bash',
				input,
				content: [{ type: 'text', text: 'abcdefgh1234' }],
			} as never,
			test.context as never,
		);
		expect(result).toBeUndefined();
	});

	it('does not activate bypass for rejected tag-only non-steering input', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		const result = await test.handler('input')(
			{ text: '<pi-envguard:skip-all!>', source: 'interactive' } as never,
			test.context as never,
		);
		expect(result).toEqual({ action: 'handled' });
		expect(process.env.PI_ENVGUARD_BYPASS).toBeUndefined();
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'tag-only', toolName: 'bash', input } as never,
			test.context as never,
		);
		expect(input.command).toContain("unset -v -- 'ENVGUARD_TEST_KEY'");
	});

	it('withholds enabled results when the call snapshot is unavailable', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		Reflect.deleteProperty(process.env, 'ENVGUARD_TEST_KEY');
		const result = await test.handler('tool_result')(
			{
				toolCallId: 'missing',
				toolName: 'bash',
				input: { command: 'run' },
				content: [
					{ type: 'text', text: 'abcdefgh1234' },
					{ type: 'image', data: 'abcdefgh1234' },
				],
			} as never,
			test.context as never,
		);
		expect(result).toEqual({
			content: [
				{ type: 'text', text: '[pi-envguard: output withheld because redaction failed]' },
				{ type: 'image', data: 'abcdefgh1234' },
			],
		});
	});

	it('blocks malformed named Bash input only when filtering is required', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const result = await test.handler('tool_call')(
			{ toolCallId: 'bad', toolName: 'bash', input: {} } as never,
			test.context as never,
		);
		expect(result).toMatchObject({ block: true });
		expect(test.notify).toHaveBeenCalled();
	});

	it('blocks invalid configuration and aborts active steering', async () => {
		const test = await harness({ unknownSetting: true });
		const idle = await test.handler('input')(
			{ text: 'run', source: 'interactive' } as never,
			test.context as never,
		);
		expect(idle).toEqual({ action: 'handled' });
		await test.handler('input')(
			{ text: 'steer', source: 'rpc', streamingBehavior: 'steer' } as never,
			test.context as never,
		);
		expect(test.abort).toHaveBeenCalledOnce();
		expect(test.notify.mock.calls[0]?.[0]).toContain('unknown unknownSetting');
	});

	it('inherits bypass only in a marked child and clears it after the initial input', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		process.env.PI_SUBAGENT_CHILD = '1';
		process.env.PI_ENVGUARD_BYPASS = 'all';
		const test = await harness();
		await test.handler('session_start')({ reason: 'startup' } as never, test.context as never);
		await test.handler('input')({ text: 'initial task', source: 'rpc' } as never, test.context as never);
		const initial = { command: 'initial' };
		await test.handler('tool_call')(
			{ toolCallId: 'initial', toolName: 'bash', input: initial } as never,
			test.context as never,
		);
		expect(initial.command).toBe('initial');

		await test.handler('input')({ text: 'next task', source: 'rpc' } as never, test.context as never);
		expect(process.env.PI_ENVGUARD_BYPASS).toBeUndefined();
		const next = { command: 'next' };
		await test.handler('tool_call')(
			{ toolCallId: 'next', toolName: 'bash', input: next } as never,
			test.context as never,
		);
		expect(next.command).toContain("unset -v -- 'ENVGUARD_TEST_KEY'");
	});

	it('does not preserve stale child initialization after invalid input', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		process.env.PI_SUBAGENT_CHILD = '1';
		process.env.PI_ENVGUARD_BYPASS = 'all';
		const test = await harness({ unknownSetting: true });
		await test.handler('session_start')({ reason: 'startup' } as never, test.context as never);
		await test.handler('input')({ text: 'blocked initial', source: 'rpc' } as never, test.context as never);
		await writeFile(
			test.configurationPath,
			JSON.stringify({ protectedEnvironmentVariables: ['ENVGUARD_TEST_KEY'] }),
		);
		await test.handler('input')(
			{
				text: '<pi-envguard:skip-all!>',
				source: 'rpc',
				streamingBehavior: 'steer',
			} as never,
			test.context as never,
		);
		await test.handler('input')({ text: 'ordinary task', source: 'rpc' } as never, test.context as never);
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'repaired-child', toolName: 'bash', input } as never,
			test.context as never,
		);
		expect(input.command).toContain("unset -v -- 'ENVGUARD_TEST_KEY'");
	});

	it('ignores an ambient bypass marker in a root session', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		Reflect.deleteProperty(process.env, 'PI_SUBAGENT_CHILD');
		process.env.PI_ENVGUARD_BYPASS = 'all';
		const test = await harness();
		expect(process.env.PI_ENVGUARD_BYPASS).toBeUndefined();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const input = { command: 'run' };
		await test.handler('tool_call')(
			{ toolCallId: 'root', toolName: 'bash', input } as never,
			test.context as never,
		);
		expect(input.command).toContain("unset -v -- 'ENVGUARD_TEST_KEY'");
	});

	it('keeps parallel call cleanup isolated', async () => {
		process.env.ENVGUARD_TEST_KEY = 'abcdefgh1234';
		const test = await harness();
		await test.handler('input')({ text: 'run', source: 'interactive' } as never, test.context as never);
		const first = { command: 'first' };
		const second = { command: 'second' };
		await test.handler('tool_call')(
			{ toolCallId: 'first', toolName: 'bash', input: first } as never,
			test.context as never,
		);
		await test.handler('tool_call')(
			{ toolCallId: 'second', toolName: 'bash', input: second } as never,
			test.context as never,
		);
		await test.handler('tool_result')(
			{ toolCallId: 'second', toolName: 'bash', input: second, content: [] } as never,
			test.context as never,
		);
		expect(second.command).toBe('second');
		expect(first.command).toContain("unset -v -- 'ENVGUARD_TEST_KEY'");
		await test.handler('turn_end')({} as never, test.context as never);
		expect(first.command).toBe('first');
	});
});
