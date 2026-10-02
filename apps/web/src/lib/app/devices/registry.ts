// The kinds of device the app implements. Everything that depends on which devices exist goes through here:
// settings (each kind reads its own block), My devices, favourites, the history, and the sessions the manager
// creates. Adding a device is adding its kind to REGISTRY, and its screens to lib/devices/screens.ts.
//
// The order is the order devices are listed in everywhere. Separate from that is the *legacy* kind: the one
// that owns whatever was stored before records said which device they were for (the Dragon S1, the only
// device there was).
import { COYOTE } from '$lib/devices/coyote/kind';
import { RING } from '$lib/devices/ring/kind';
import type { DeviceKind } from './types.ts';

export class Registry {
	readonly kinds: readonly DeviceKind[];
	/** The kind that records without a device belong to. */
	readonly legacy: DeviceKind;
	private readonly byId: ReadonlyMap<string, DeviceKind>;

	/** `legacyId` names the legacy kind (the first kind when it isn't said). */
	constructor(kinds: readonly DeviceKind[], legacyId?: string) {
		if (kinds.length === 0) throw new Error('a registry needs at least one kind of device');
		this.byId = new Map(kinds.map((k) => [k.id, k]));
		if (this.byId.size !== kinds.length) throw new Error('duplicate device id');
		const keys = kinds.flatMap((k) => (k.settings ? [k.settings.key] : []));
		if (new Set(keys).size !== keys.length) throw new Error('duplicate settings key');
		this.kinds = kinds;
		const legacy = legacyId === undefined ? kinds[0] : this.byId.get(legacyId);
		if (!legacy) throw new Error('the legacy kind must be one of the kinds');
		this.legacy = legacy;
	}

	get ids(): string[] {
		return this.kinds.map((k) => k.id);
	}

	has(id: string): boolean {
		return this.byId.has(id);
	}

	get(id: string): DeviceKind | undefined {
		return this.byId.get(id);
	}

	/** The kind an entry belongs to; entries from before devices were recorded are the legacy kind's. */
	of(id: string | undefined | null): DeviceKind {
		return (id && this.byId.get(id)) || this.legacy;
	}

	/** There is something to choose (the question "Which devices do you have?" is only asked then). */
	get several(): boolean {
		return this.kinds.length > 1;
	}
}

/** The DG-LAB Coyote 3.0 first, wherever devices are listed. What predates device records is the ring's. */
export const REGISTRY = new Registry([COYOTE, RING], RING.id);
