import type { ProcessedAttachment } from './types';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const attribute = (value: string) => escape(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const ATTACHMENT_NOTICE =
	'The following context was resolved from explicit file or URI mentions.\n' +
	'Use the built-in `read` tool on a provided path when more content is required.';

export function renderContext(
	attachments: readonly ProcessedAttachment[],
	warningsForModel: readonly string[] = [],
): string {
	const body = attachments
		.map((attachment) => {
			const attributes = [
				`path="${attribute(attachment.path)}"`,
				`mentions="${attribute(attachment.mentions.join(', '))}"`,
				...(attachment.sourceBytes === undefined ? [] : [`source_bytes="${String(attachment.sourceBytes)}"`]),
				`content_chars="${String(attachment.contentChars)}"`,
				`content_lines="${String(attachment.contentLines)}"`,
				...(attachment.requestedLines ? [`requested_lines="${attribute(attachment.requestedLines)}"`] : []),
				...(attachment.parsedPath ? [`parsed_path="${attribute(attachment.parsedPath)}"`] : []),
				...(attachment.truncatedBy ? [`truncated_by="${attachment.truncatedBy}"`] : []),
			].join(' ');
			return `<attachment ${attributes}>\n${escape(attachment.preview)}${attachment.truncated ? '\n(TRUNCATED)' : ''}\n</attachment>`;
		})
		.join('\n\n');
	const warningText = warningsForModel.length ? `\n<warnings>${escape(warningsForModel.join('; '))}</warnings>` : '';
	return `<attachments>\n${ATTACHMENT_NOTICE}\n\n${body}${warningText}\n\n</attachments>`;
}
