import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export interface InstalledAssets {
	skills: string[];
	prompts: string[];
}

export function resolveAssetsRoot(): string {
	return dirname(fileURLToPath(import.meta.url));
}

/** Copies generated OpenSpec assets into a project's `.pi/` directory. */
export async function installOpenspecAssets(assetsRoot: string, projectDir: string): Promise<InstalledAssets> {
	const skillsSource = join(assetsRoot, 'skills');
	const promptsSource = join(assetsRoot, 'prompts');
	const skillsTarget = join(projectDir, '.pi', 'skills');
	const promptsTarget = join(projectDir, '.pi', 'prompts');
	await mkdir(skillsTarget, { recursive: true });
	await mkdir(promptsTarget, { recursive: true });

	const skills = (await readdir(skillsSource)).sort();
	for (const dir of skills) {
		await cp(join(skillsSource, dir), join(skillsTarget, dir), { recursive: true });
	}

	const prompts = (await readdir(promptsSource)).filter((name) => name.endsWith('.md')).sort();
	for (const name of prompts) {
		await cp(join(promptsSource, name), join(promptsTarget, name));
	}

	return { skills, prompts };
}

export function registerOpsxInitCommand(pi: ExtensionAPI, assetsRoot: string = resolveAssetsRoot()): void {
	pi.registerCommand('opsx-init', {
		description: 'Copy the OpenSpec skills and /opsx-* prompts from this package into the project .pi directory',
		handler: async (_args, ctx) => {
			try {
				const { skills, prompts } = await installOpenspecAssets(assetsRoot, ctx.cwd);
				ctx.ui.notify(
					`Wrote ${String(skills.length)} skills and ${String(prompts.length)} /opsx-* prompts to ${join(ctx.cwd, '.pi')}`,
					'info',
				);
				try {
					await ctx.reload();
				} catch {
					ctx.ui.notify('Restart pi to load the new skills and prompts.', 'warning');
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					ctx.ui.notify(
						`Package assets not found under ${assetsRoot}; install the package from npm or run its build`,
						'error',
					);
				} else {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
				}
			}
		},
	});
}
