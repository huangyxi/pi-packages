import { booleanField, defineConfigSchema, integerField, numberField, type InferConfig } from '@/utils/config';

export const ATTACH_CONFIG_SCHEMA = defineConfigSchema('attach', {
	/** Maximum Unicode code points included in each ordinary attachment preview. */
	perAttachLength: integerField(500, 0),
	/** Deadline in seconds for processing all attachments in one input; zero disables it. */
	attachmentProcessingTimeoutSeconds: numberField(30, 0),
	/** Apply the ordinary preview length limit to explicitly selected line ranges. */
	limitExplicitLines: booleanField(false),
	/** Maximum number of file attachments processed concurrently. */
	maxAttachmentConcurrency: integerField(4, 1),
});

export type AttachConfig = InferConfig<typeof ATTACH_CONFIG_SCHEMA>;
