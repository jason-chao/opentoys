// My devices: changing the list of devices a person has (the sanitising is in settings.ts).
import type { Registry } from './registry.ts';

/** Add the device, or take it out; kept in the registry's order, so the screens list devices the same way. */
export function toggleDevice(mine: readonly string[], id: string, registry: Registry): string[] {
	if (!registry.has(id)) return [...mine];
	const next = new Set(mine);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return registry.ids.filter((x) => next.has(x));
}

/** A device was connected: it belongs to the list from now on. */
export function withDevice(mine: readonly string[], id: string, registry: Registry): string[] {
	if (!registry.has(id) || mine.includes(id)) return [...mine];
	return registry.ids.filter((x) => x === id || mine.includes(x));
}
