import { isToolCallEventType, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { catalog } from './catalog/registry';
import { readToolchainConfig } from './config';
import { detectCommands } from './detection/detect-commands';
import { supportsPlatform } from './installation/platform';
import { runProcess } from './installation/process';
import { Provisioner } from './provisioning/provisioner';
import { findSystemCommand } from './routing/executable-resolver';
import { reconcileShims, recoverShims } from './routing/shim';
import { sanitizeDiagnostic } from './output/diagnostics';

export default function toolchain(pi: ExtensionAPI): void {
	void readToolchainConfig()
		.then(async (config) => {
			await recoverShims(config.agentDirectory);
			const manifests = await new Provisioner(config).manifests();
			await reconcileShims(
				config.agentDirectory,
				manifests.flatMap((manifest) => manifest.shimCommands),
			);
		})
		.catch(() => undefined);
	let warned = false;
	pi.on('tool_call', async (event, context) => {
		if (!isToolCallEventType('bash', event)) return;
		if (typeof event.input.command !== 'string') {
			if (!warned && context.hasUI)
				context.ui.notify('pi-toolchain: unexpected bash tool shape; provisioning disabled', 'warning');
			warned = true;
			return;
		}
		const originalCommand = event.input.command;
		const issues: string[] = [];
		let config;
		try {
			config = await readToolchainConfig((message) => issues.push(message));
		} catch (error) {
			if (!warned && context.hasUI) context.ui.notify(`pi-toolchain: ${sanitizeDiagnostic(error)}`, 'warning');
			warned = true;
			return;
		}
		if (issues.length && !warned && context.hasUI) {
			context.ui.notify(`pi-toolchain: ${issues.join('; ')}`, 'warning');
			warned = true;
		}
		const commands = detectCommands(originalCommand, catalog);
		if (commands.length === 0) return;
		const required = new Set<string>();
		for (const command of commands) {
			const definition = catalog.byCommand.get(command);
			if (!definition || !supportsPlatform(definition)) continue;
			const system = await findSystemCommand(command, process.env.PATH, [
				config.agentDirectory,
				config.toolkitDirectory,
			]);
			if (system) {
				const commandDefinition = definition.commands.find((entry) => entry.name === command)!;
				const probe = await runProcess(system, commandDefinition.versionArgs, {
					signal: context.signal,
					timeoutMs: 5000,
				});
				if (probe.code === 0) continue;
			}
			required.add(definition.id);
		}
		if (required.size === 0) return;
		const timeout = config.automaticInstallationTimeoutSeconds;
		const deadline = timeout > 0 ? AbortSignal.timeout(timeout * 1000) : undefined;
		const signal =
			context.signal && deadline ? AbortSignal.any([context.signal, deadline]) : (context.signal ?? deadline);
		if (context.hasUI) context.ui.setStatus('pi-toolchain', `Provisioning ${[...required].join(', ')}`);
		try {
			const service = new Provisioner({ ...config });
			await service.ensure([...required], signal);
		} catch (error) {
			if ((error as Error & { code?: string }).code === 'unsupported') return;
			return {
				block: true,
				reason: `pi-toolchain provisioning failed: ${sanitizeDiagnostic(error)}. Recovery: pi-toolchain install ${[...required].join(' ')}`,
			};
		} finally {
			if (context.hasUI) context.ui.setStatus('pi-toolchain', undefined);
		}
		if (event.input.command !== originalCommand)
			return { block: true, reason: 'pi-toolchain refused mutated bash input' };
	});
}
