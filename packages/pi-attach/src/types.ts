export interface LineRange {
	start: number;
	end: number;
}

export interface MentionCandidate {
	raw: string;
	value: string;
	start: number;
	end: number;
	selector?: LineRange;
}

export interface ProcessedAttachment {
	path: string;
	mentions: string[];
	sourceBytes: number;
	contentChars: number;
	contentLines: number;
	requestedLines?: string;
	parsedPath?: string;
	preview: string;
	truncated: boolean;
	warningForModel?: string;
}

export interface ResolveContext {
	cwd: string;
}

export type Resolution =
	| {
			kind: 'file';
			path: string;
			candidate: MentionCandidate;
	  }
	| {
			kind: 'content';
			attachment: ProcessedAttachment;
			candidate: MentionCandidate;
	  };

export interface AttachmentResolver {
	resolve(candidate: MentionCandidate, context: ResolveContext): Promise<Resolution | undefined>;
}

export interface FileGroup {
	path: string;
	mentions: MentionCandidate[];
	firstMention: number;
}

export interface CompletedAttachment {
	attachment: ProcessedAttachment;
	mentions: MentionCandidate[];
	firstMention: number;
}

export interface AttachmentInputResult {
	content: string;
	details: ProcessedAttachment[];
}
