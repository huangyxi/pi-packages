import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { registerOpsxInitCommand } from './opsx-init';

export default function piOpenspec(pi: ExtensionAPI): void {
	registerOpsxInitCommand(pi);
}
