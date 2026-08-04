import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

import { type BypassMode } from './directives';

const STATUS_KEY = 'envguard';
const BYPASS_MARKER = 'PI_ENVGUARD_BYPASS';
const ownershipKey = Symbol.for('@hyxi/pi-envguard/ownership');

interface OwnershipState {
	marker?: symbol;
	status?: symbol;
}

function isBypassMode(value: unknown): value is BypassMode {
	return value === 'filter' || value === 'redaction' || value === 'all';
}

/** Coordinates ownership across extension instances during reload and replacement. */
function globalOwnership(): OwnershipState {
	const existing = Reflect.get(globalThis, ownershipKey) as OwnershipState | undefined;
	if (existing) return existing;
	const created: OwnershipState = {};
	Reflect.set(globalThis, ownershipKey, created);
	return created;
}

/** Owns temporary bypass lifetime, UI status, and subagent propagation metadata. */
export class BypassController {
	private readonly owner = Symbol('envguard-instance');
	private modeValue: BypassMode | undefined;
	private inheritedInitialInputPending: boolean;

	public constructor() {
		const ambientMode = process.env[BYPASS_MARKER];
		const isChild = process.env.PI_SUBAGENT_CHILD === '1';

		// A root must not accidentally pass a stale ambient marker to a future child.
		if (!isChild && isBypassMode(ambientMode) && !globalOwnership().marker) {
			Reflect.deleteProperty(process.env, BYPASS_MARKER);
		}
		this.modeValue = isChild && isBypassMode(ambientMode) ? ambientMode : undefined;
		this.inheritedInitialInputPending = this.modeValue !== undefined;
	}

	public get mode(): BypassMode | undefined {
		return this.modeValue;
	}

	/** Preserve child inheritance for its initial task; later ordinary inputs clear it. */
	public prepareNonSteeringInput(context: ExtensionContext): void {
		if (this.inheritedInitialInputPending && this.modeValue) {
			this.inheritedInitialInputPending = false;
			return;
		}
		this.inheritedInitialInputPending = false;
		this.clear(context);
	}

	public activate(mode: BypassMode | undefined, context: ExtensionContext): void {
		this.modeValue = mode;
		this.updateProcessMarker(mode);
		this.showStatus(context);
	}

	public clearAfterBlockedInput(context: ExtensionContext): void {
		this.inheritedInitialInputPending = false;
		this.clear(context);
	}

	public clear(context: ExtensionContext): void {
		this.activate(undefined, context);
	}

	public showStatus(context: ExtensionContext): void {
		if (!context.hasUI) return;
		const ownership = globalOwnership();
		if (this.modeValue) {
			context.ui.setStatus(STATUS_KEY, `envguard: skip ${this.modeValue}`);
			ownership.status = this.owner;
		} else if (ownership.status === this.owner) {
			context.ui.setStatus(STATUS_KEY, undefined);
			delete ownership.status;
		}
	}

	private updateProcessMarker(mode: BypassMode | undefined): void {
		const ownership = globalOwnership();
		if (mode) {
			process.env[BYPASS_MARKER] = mode;
			ownership.marker = this.owner;
		} else if (ownership.marker === this.owner) {
			Reflect.deleteProperty(process.env, BYPASS_MARKER);
			delete ownership.marker;
		}
	}
}
