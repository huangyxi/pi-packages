import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { registerAttachmentExtension } from './pi/attachment-extension';

export default function attach(pi: ExtensionAPI): void {
	registerAttachmentExtension(pi);
}
