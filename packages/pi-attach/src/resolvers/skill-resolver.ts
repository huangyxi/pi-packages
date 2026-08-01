import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import type { ResolverRegistry } from './resolver-registry';

function stripFrontmatter(source: string): string {
	return source.startsWith('---') ? source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : source;
}

function isBareSkillName(value: string): boolean {
	return !/[./~\\]/.test(value);
}

export function registerSkillResolver(registry: ResolverRegistry, pi: ExtensionAPI): void {
	registry.register({
		async resolve(candidate) {
			if (candidate.selector || !isBareSkillName(candidate.value)) return undefined;
			const command = pi.getCommands().find((item) => item.name === `skill:${candidate.value}`);
			const location = command?.sourceInfo.path;
			if (!location) return undefined;
			try {
				const body = stripFrontmatter(await readFile(location, 'utf8'));
				const content = `${body}\n\nSkill location: ${location}\nResolve relative references from this location.`;
				return {
					kind: 'content',
					candidate,
					attachment: {
						path: location,
						mentions: [candidate.raw],
						sourceBytes: Buffer.byteLength(body),
						contentChars: Array.from(content).length,
						contentLines: content.split(/\r?\n/).length,
						preview: content,
						truncated: false,
					},
				};
			} catch {
				return undefined;
			}
		},
	});
}
