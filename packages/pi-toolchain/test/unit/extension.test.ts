import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const state = vi.hoisted(() => ({
	ensure: vi.fn(),
	recover: vi.fn().mockResolvedValue(undefined),
	reconcile: vi.fn().mockResolvedValue(undefined),
	signal: undefined as AbortSignal | undefined,
}));
vi.mock('../../src/config', () => ({
	readToolchainConfig: async () => ({
		agentDirectory: '/agent',
		toolkitDirectory: '/toolkit',
		toolResolutionOrder: 'managed-first',
		automaticInstallationTimeoutSeconds: 0,
	}),
}));
vi.mock('../../src/routing/executable-resolver', () => ({ findSystemCommand: async () => undefined }));
vi.mock('../../src/routing/shim', () => ({
	recoverShims: state.recover,
	reconcileShims: state.reconcile,
}));
vi.mock('../../src/installation/platform', async (original) => {
	const actual = await original<typeof import('../../src/installation/platform')>();
	return { ...actual, supportsPlatform: (definition: { id: string }) => definition.id === 'pnpm' };
});
vi.mock('../../src/provisioning/provisioner', () => ({
	Provisioner: class {
		manifests(): Promise<{ shimCommands: string[] }[]> {
			return Promise.resolve([{ shimCommands: ['pnpm'] }]);
		}
		ensure(ids: readonly string[], signal?: AbortSignal): Promise<unknown> {
			state.signal = signal;
			return state.ensure(ids, signal) as Promise<unknown>;
		}
	},
}));

type Handler = (
	event: { toolName: string; input: { command: string } },
	context: { hasUI: boolean; signal?: AbortSignal },
) => Promise<unknown>;
describe('Pi extension adapter', () => {
	beforeEach(() => {
		state.ensure.mockReset();
		state.recover.mockClear();
		state.reconcile.mockClear();
		state.signal = undefined;
		vi.resetModules();
	});
	test('recovers and initializes the canonical shim on load', async () => {
		const pi = { on: vi.fn() };
		const extension = (await import('../../src/extension')).default;
		extension(pi as unknown as ExtensionAPI);
		await vi.waitFor(() => {
			expect(state.reconcile).toHaveBeenCalledWith('/agent', ['pnpm']);
		});
		expect(state.recover).toHaveBeenCalledWith('/agent');
		expect(state.recover.mock.invocationCallOrder[0]).toBeLessThan(state.reconcile.mock.invocationCallOrder[0]!);
	});
	test('awaits one preflight, propagates signal, and preserves exact bytes', async () => {
		let handler: Handler | undefined;
		const pi = {
			on: (event: string, callback: Handler) => {
				if (event === 'tool_call') handler = callback;
			},
		};
		const extension = (await import('../../src/extension')).default;
		extension(pi as unknown as ExtensionAPI);
		expect(handler).toBeDefined();
		let release!: () => void;
		state.ensure.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const controller = new AbortController();
		const command = "pnpm --version && printf 'unchanged\\n'";
		const event = { toolName: 'bash', input: { command } };
		let settled = false;
		const pending = handler!(event, { hasUI: false, signal: controller.signal }).then((value) => {
			settled = true;
			return value;
		});
		await vi.waitFor(() => {
			expect(state.ensure).toHaveBeenCalledOnce();
		});
		expect(settled).toBe(false);
		expect(state.signal).toBe(controller.signal);
		expect(event.input.command).toBe(command);
		release();
		await expect(pending).resolves.toBeUndefined();
		expect(event.input.command).toBe(command);
	});
	test('provisions supported work and silently ignores unsupported branches', async () => {
		let handler: Handler | undefined;
		const pi = {
			on: (_event: string, callback: Handler) => {
				handler = callback;
			},
		};
		const extension = (await import('../../src/extension')).default;
		extension(pi as unknown as ExtensionAPI);
		state.ensure.mockResolvedValue([]);
		await expect(
			handler!({ toolName: 'bash', input: { command: 'pnpm --version && rg TODO' } }, { hasUI: false }),
		).resolves.toBeUndefined();
		expect(state.ensure).toHaveBeenCalledWith(['pnpm'], undefined);
	});
	test('does nothing for non-bash tools', async () => {
		let handler: Handler | undefined;
		const pi = {
			on: (_event: string, callback: Handler) => {
				handler = callback;
			},
		};
		const extension = (await import('../../src/extension')).default;
		extension(pi as unknown as ExtensionAPI);
		await expect(
			handler!({ toolName: 'read', input: { command: 'pnpm' } }, { hasUI: false }),
		).resolves.toBeUndefined();
		expect(state.ensure).not.toHaveBeenCalled();
	});
});
