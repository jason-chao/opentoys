// The user's settings. Stored in IndexedDB (storage.ts), never sent anywhere. What is shared across devices
// lives at the top (18 or over, My devices, the session limit, the lead-in, favourites); each
// kind of device keeps its own block under its own key (the ring: `ring`), read and sanitised by that kind
// (devices/registry.ts). Everything read back is sanitised, whatever shape it was stored in: settings from
// before there were several devices were flat, and are read into the same shape without losing anything and
// without ever enabling anything.
import type { CoyoteSettings } from '$lib/devices/coyote/settings';
import type { RingSettings } from '$lib/devices/ring/settings';
import { REGISTRY, type Registry } from './devices/registry.ts';

/** A starred built-in pattern: which device it belongs to, and its id there. */
export interface Favourite {
	device: string;
	id: string;
}

export interface Settings {
	/**
	 * 18 or over, confirmed on the welcome screen: needed for anything, the preview included. Each device's
	 * safety notes are agreed to separately, in its set-up (the `agreed` of its own block).
	 */
	adult: boolean;
	/** My devices: the kinds of device this person has (registered model ids), in the registry's order. */
	devices: string[];
	/** Playback on every device stops after this long, by the clock. */
	sessionMaxMin: number;
	/** Three slow breaths before a pattern starts (optional). */
	leadIn: boolean;
	/** Starred built-in patterns, in the order they were starred. */
	favourites: Favourite[];
	/** The Dragon S1's own settings. */
	ring: RingSettings;
	/** The DG-LAB Coyote 3.0's own settings. */
	coyote: CoyoteSettings;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

function num(x: unknown, lo: number, hi: number, fallback: number): number {
	const v = typeof x === 'number' ? x : Number.NaN;
	return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
}
const bool = (x: unknown, fallback: boolean): boolean => (typeof x === 'boolean' ? x : fallback);

/**
 * My devices: registered kinds only, each once, in the registry's order (the order devices are listed in
 * everywhere). With one kind registered there is nothing to choose: the list is that device. Settings from
 * before the list existed belong to someone who was using the legacy kind (the ring), so it starts with that.
 */
export function sanitizeDevices(stored: unknown, legacy: Obj, registry: Registry = REGISTRY): string[] {
	if (registry.kinds.length === 1) return [registry.kinds[0].id];
	if (!Array.isArray(stored)) return wasOnboarded(legacy) ? [registry.legacy.id] : [];
	const seen = new Set<string>();
	for (const id of stored) if (typeof id === 'string' && registry.has(id)) seen.add(id);
	return registry.ids.filter((id) => seen.has(id));
}

/**
 * Favourites: known patterns of registered kinds only, each once, in their stored order. Before favourites
 * carried their device they were plain pattern ids, all of them the ring's (the legacy kind).
 */
export function sanitizeFavourites(stored: unknown, registry: Registry = REGISTRY): Favourite[] {
	if (!Array.isArray(stored)) return [];
	const out: Favourite[] = [];
	const seen = new Set<string>();
	for (const f of stored) {
		const fav =
			typeof f === 'string'
				? { device: registry.legacy.id, id: f }
				: isObj(f) && typeof f.device === 'string' && typeof f.id === 'string'
					? { device: f.device, id: f.id }
					: null;
		if (!fav || !registry.get(fav.device)?.hasPattern(fav.id)) continue;
		const key = `${fav.device}\n${fav.id}`;
		if (!seen.has(key)) out.push(fav);
		seen.add(key);
	}
	return out;
}

/**
 * Before the 18+ confirmation and the devices' safety agreements were separate there was one flag,
 * `onboarded`: the safety notes (the ring's, then) were read and 18+ confirmed. It counts as both.
 */
export const wasOnboarded = (stored: Record<string, unknown>): boolean => stored.onboarded === true;

/** Defaults filled in, every number clamped, every device's block read by its own kind. */
export function sanitizeSettings(input: unknown, registry: Registry = REGISTRY): Settings {
	const s = isObj(input) ? input : {};
	const out: Obj = {
		adult: bool(s.adult, wasOnboarded(s)),
		devices: sanitizeDevices(s.devices, s, registry),
		sessionMaxMin: num(s.sessionMaxMin, 1, 1440, 60),
		leadIn: bool(s.leadIn, false),
		favourites: sanitizeFavourites(s.favourites, registry)
	};
	for (const kind of registry.kinds)
		if (kind.settings) out[kind.settings.key] = kind.settings.sanitize(s[kind.settings.key], s);
	return out as unknown as Settings;
}

/** A fresh visitor's settings. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(sanitizeSettings({}));

/**
 * Settings from a file: sanitised (from any earlier shape), and without anything that needs a confirmation in
 * this browser: each device's safety agreement, the permission to use e-stim or the Coyote, and the raised
 * limits (every kind decides its own). The 18+ confirmation is not the file's to give either: `adult` says
 * whether the person importing has confirmed it here.
 *
 * With `current` (what this browser has now), a file also never raises a limit: the session limit is the
 * shorter of the two, and each device's caps, maxima and rates are the lower (each kind's `notAbove`). So
 * someone who lowered a limit here keeps it, whatever a file says. A browser that was never set up (no 18+
 * confirmation yet) has no limits of its own, only untouched defaults, so a backup restored there keeps the
 * file's values.
 */
export function importedSettings(
	input: unknown,
	registry: Registry = REGISTRY,
	adult = false,
	current?: Settings
): Settings {
	const s = sanitizeSettings(input, registry) as unknown as Obj;
	s.adult = adult;
	const own = current?.adult ? current : undefined;
	if (own) s.sessionMaxMin = Math.min(s.sessionMaxMin as number, own.sessionMaxMin);
	const now = own as unknown as Obj | undefined;
	for (const kind of registry.kinds) {
		const spec = kind.settings;
		if (!spec) continue;
		let block = spec.locked(s[spec.key]);
		if (now && now[spec.key] !== undefined) block = spec.notAbove(block, now[spec.key]);
		s[spec.key] = block;
	}
	return sanitizeSettings(s, registry);
}
