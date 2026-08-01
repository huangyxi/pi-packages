import type { AttachmentResolver, MentionCandidate, Resolution, ResolveContext } from '../types';

export class ResolverRegistry {
	readonly #resolvers: AttachmentResolver[] = [];

	register(resolver: AttachmentResolver): void {
		this.#resolvers.push(resolver);
	}

	async resolve(candidate: MentionCandidate, context: ResolveContext): Promise<Resolution | undefined> {
		for (const resolver of this.#resolvers) {
			const resolution = await resolver.resolve(candidate, context);
			if (resolution) return resolution;
		}
		return undefined;
	}
}
