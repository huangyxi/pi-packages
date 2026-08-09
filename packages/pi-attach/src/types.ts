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
	selectorDelimiter?: ':' | '#L';
}

export interface ProcessedAttachment {
	path: string;
	mentions: string[];
	sourceBytes?: number;
	contentChars: number;
	contentLines: number;
	requestedLines?: string;
	parsedPath?: string;
	readPath?: string;
	preview: string;
	truncated: boolean;
	truncatedBy?: 'lines' | 'bytes';
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
			kind: 'url';
			url: string;
			candidate: MentionCandidate;
	  };

export interface AttachmentResolver {
	resolve(candidate: MentionCandidate, context: ResolveContext): Promise<Resolution | undefined>;
}

export type AttachmentSource = { kind: 'file'; value: string } | { kind: 'url'; value: string };

export interface SourceGroup {
	source: AttachmentSource;
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
