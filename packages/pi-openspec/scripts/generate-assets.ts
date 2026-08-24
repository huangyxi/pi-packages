/**
 * Generates the package's OpenSpec skills and /opsx-* prompt templates.
 *
 * Renders exactly the artifacts `openspec init --tools pi` would write into a
 * project, but into this package's `dist/` so Pi loads them from the package
 * manifest without a per-project init run. Content always comes from the
 * pinned `@fission-ai/openspec` devDependency — never from checked-in copies —
 * so the generated skills and prompts track the upstream release they were
 * rendered with (recorded in the `generatedBy` frontmatter).
 *
 * Usage: node scripts/generate-assets.ts [--out <dir>]
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOL_ID = 'pi';
const DELIVERY = 'both';

interface CommandContent {
	id: string;
	name: string;
	description: string;
	category: string;
	tags: string[];
	body: string;
}

interface CommandAdapter {
	toolId: string;
	getFilePath(commandId: string): string;
	formatFile(content: CommandContent): string;
}

interface CommandInvocation {
	style: 'namespaced' | 'flat';
	prefix: string;
}

type CommandSurfaceCapability = 'adapter-backed' | 'skills-invocable' | 'none';

interface SkillTemplate {
	name: string;
	description: string;
	instructions: string;
	license?: string;
	compatibility?: string;
	metadata?: Record<string, string>;
}

interface SkillGenerationModule {
	getSkillTemplates(
		workflowFilter?: readonly string[],
	): { template: SkillTemplate; dirName: string; workflowId: string }[];
	getCommandContents(workflowFilter?: readonly string[]): CommandContent[];
	generateSkillContent(
		template: SkillTemplate,
		generatedByVersion: string,
		transformInstructions?: (instructions: string) => string,
	): string;
}

interface CommandGeneratorModule {
	generateCommands(contents: CommandContent[], adapter: CommandAdapter): { path: string; fileContent: string }[];
}

interface CommandSurfaceModule {
	resolveCommandInvocation(toolId: string): CommandInvocation | undefined;
	resolveCommandSurfaceCapability(toolId: string): CommandSurfaceCapability;
}

interface CommandReferencesModule {
	getTransformerForTool(
		toolId: string,
		delivery: 'both' | 'skills' | 'commands',
		capability: CommandSurfaceCapability,
		invocation: CommandInvocation | undefined,
	): ((text: string) => string) | undefined;
}

interface PiAdapterModule {
	piAdapter: CommandAdapter;
}

/** Resolves the installed package root from its exported entry point. */
function resolveOpenspecRoot(): string {
	const entry = createRequire(import.meta.url).resolve('@fission-ai/openspec');
	return dirname(dirname(entry));
}

async function loadModule<T>(file: string): Promise<T> {
	return (await import(pathToFileURL(file).href)) as T;
}

async function generateAssets(outDir: string): Promise<{ skills: number; prompts: number; version: string }> {
	const openspecRoot = resolveOpenspecRoot();
	const dist = join(openspecRoot, 'dist');
	const manifest = JSON.parse(await readFile(join(openspecRoot, 'package.json'), 'utf8')) as { version: string };

	const [
		skillGeneration,
		commandGenerator,
		commandSurface,
		commandReferences,
		piAdapterModule,
	] = await Promise.all([
		loadModule<SkillGenerationModule>(join(dist, 'core', 'shared', 'skill-generation.js')),
		loadModule<CommandGeneratorModule>(join(dist, 'core', 'command-generation', 'generator.js')),
		loadModule<CommandSurfaceModule>(join(dist, 'core', 'command-surface.js')),
		loadModule<CommandReferencesModule>(join(dist, 'utils', 'command-references.js')),
		loadModule<PiAdapterModule>(join(dist, 'core', 'command-generation', 'adapters', 'pi.js')),
	]);

	const invocation = commandSurface.resolveCommandInvocation(TOOL_ID);
	if (invocation === undefined) {
		throw new Error(`@fission-ai/openspec no longer provides a ${TOOL_ID} command adapter`);
	}
	const transformer = commandReferences.getTransformerForTool(
		TOOL_ID,
		DELIVERY,
		commandSurface.resolveCommandSurfaceCapability(TOOL_ID),
		invocation,
	);

	const skillsDir = join(outDir, 'skills');
	const promptsDir = join(outDir, 'prompts');
	await rm(skillsDir, { recursive: true, force: true });
	await rm(promptsDir, { recursive: true, force: true });
	await mkdir(skillsDir, { recursive: true });
	await mkdir(promptsDir, { recursive: true });

	let skillCount = 0;
	for (const { template, dirName } of skillGeneration.getSkillTemplates()) {
		const skillFile = join(skillsDir, dirName, 'SKILL.md');
		await mkdir(dirname(skillFile), { recursive: true });
		await writeFile(skillFile, skillGeneration.generateSkillContent(template, manifest.version, transformer));
		skillCount += 1;
	}

	const commands = commandGenerator.generateCommands(skillGeneration.getCommandContents(), piAdapterModule.piAdapter);
	for (const command of commands) {
		await writeFile(join(promptsDir, basename(command.path)), command.fileContent);
	}

	return { skills: skillCount, prompts: commands.length, version: manifest.version };
}

const outIndex = process.argv.indexOf('--out');
const outArg = outIndex === -1 ? undefined : process.argv[outIndex + 1];
if (outIndex !== -1 && outArg === undefined) {
	throw new Error('--out requires a directory');
}
const outDir = outArg ?? join(import.meta.dirname, '..', 'dist');
const { skills, prompts, version } = await generateAssets(outDir);
const summary = JSON.stringify({ skills, prompts, version, outDir });
console.log(`Generated OpenSpec assets from @fission-ai/openspec ${version}: ${summary}`);
