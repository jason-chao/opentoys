// The DG-LAB Coyote 3.0's own settings: whether it is enabled, the maximum intensity per channel, and how its
// extras behave. Stored as the `coyote` block of the settings (lib/app/settings.ts). Intensity is the device's
// own number, 0..200 per channel.
//
// Everything read back is sanitised. A maximum never goes above 100 unless the user confirmed going higher in
// this browser (above100), and never above 200. The device is enabled only after its set-up (the safety notes
// were read, a maximum was set with the device on, and that was confirmed). A file never carries the
// confirmation or the permission (`lockedCoyote`).
export const COYOTE_ID = 'coyote-3';

/** The device's own ceiling per channel. */
export const INTENSITY_MAX = 200;
/** The highest maximum without the confirmation. */
export const DEFAULT_CAP = 100;

export type Channel = 'a' | 'b';
export const CHANNELS: readonly Channel[] = ['a', 'b'];

export interface CoyoteSettings {
	/** The Coyote's safety notes were agreed to, in this browser: needed before any output on a real one. */
	agreed: boolean;
	/** Set up and confirmed in this browser: patterns can be started on the device. */
	enabled: boolean;
	/** The user's maximum per channel, 0..cap. 0 = this channel is not used. */
	maxA: number;
	maxB: number;
	/** The user confirmed, in this browser, that the maximum may go above 100. */
	above100: boolean;
	/** Burst: how far above the current intensity it goes while held. */
	burst: number;
	/** Random pauses: the longest play time and the longest pause, in seconds (the shortest is 5). */
	pauseWorkS: number;
	pausePauseS: number;
	/** Slow increase: +1 this often (seconds), up to this much above the set intensity. */
	increaseEveryS: number;
	increaseUpTo: number;
}

/** The shortest play time and pause of random pauses, in seconds. */
export const PAUSE_SHORTEST_S = 5;

export const DEFAULT_COYOTE: Readonly<CoyoteSettings> = Object.freeze({
	agreed: false,
	enabled: false,
	maxA: 0,
	maxB: 0,
	above100: false,
	burst: 10,
	pauseWorkS: 30,
	pausePauseS: 30,
	increaseEveryS: 60,
	increaseUpTo: 20
});

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

/** A whole number within [lo, hi]; anything else is the fallback. */
function int(x: unknown, lo: number, hi: number, fallback: number): number {
	const v = typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : Number.NaN;
	return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
}

/** The highest a maximum may be set: 100, or 200 after the confirmation. */
export const capOf = (above100: boolean): number => (above100 ? INTENSITY_MAX : DEFAULT_CAP);

/** Defaults filled in, every number a whole number in its range, maxima never above what is allowed. */
export function sanitizeCoyote(stored: unknown): CoyoteSettings {
	const s = isObj(stored) ? stored : {};
	const d = DEFAULT_COYOTE;
	const above100 = s.above100 === true;
	const cap = capOf(above100);
	const maxA = int(s.maxA, 0, cap, d.maxA);
	const maxB = int(s.maxB, 0, cap, d.maxB);
	// A Coyote that was enabled before the agreement was its own field was enabled with that agreement.
	const agreed = typeof s.agreed === 'boolean' ? s.agreed : s.enabled === true;
	return {
		agreed,
		// A stored flag alone never enables it: there must be the agreement, and a maximum on a channel.
		enabled: s.enabled === true && agreed && (maxA > 0 || maxB > 0),
		maxA,
		maxB,
		above100,
		burst: int(s.burst, 1, 50, d.burst),
		pauseWorkS: int(s.pauseWorkS, 10, 120, d.pauseWorkS),
		pausePauseS: int(s.pausePauseS, 10, 120, d.pausePauseS),
		increaseEveryS: int(s.increaseEveryS, 10, 300, d.increaseEveryS),
		increaseUpTo: int(s.increaseUpTo, 1, 50, d.increaseUpTo)
	};
}

/**
 * What a file may carry: never the safety agreement, the permission to use the device, nor to go above 100.
 * Each needs its
 * confirmation in this browser, by the person using it (a file may come from someone else). Without the
 * permission nothing can be started until the set-up is done again, which sets the maxima anew.
 */
export function lockedCoyote(coyote: CoyoteSettings): CoyoteSettings {
	return sanitizeCoyote({ ...coyote, agreed: false, enabled: false, above100: false });
}

/**
 * The caps written to the device itself (they persist on it after power-off, and bound its own wheels too).
 * Never 0: that would leave a wheel dead until another app rewrites the cap. A channel the user set up gets
 * their maximum. A channel that is not used, a device that is not enabled yet, and the channel a set-up is
 * finding the maximum of get the app's general limit (100, or 200 once that was confirmed): there the app's
 * own lock is what holds, since the engine never commands a channel whose maximum in force is 0.
 */
export function deviceCapsFor(coyote: CoyoteSettings, setup: Channel | null = null): Record<Channel, number> {
	const cap = capOf(coyote.above100);
	const own = (ch: Channel, v: number) => (coyote.enabled && v > 0 && setup !== ch ? v : cap);
	return { a: own('a', coyote.maxA), b: own('b', coyote.maxB) };
}

/**
 * Imported settings never raise a limit this browser has: each channel's maximum is the lower of what the file
 * says and what is set here now, and the general limit stays at 100 unless both allow more (a file never does:
 * `lockedCoyote`).
 */
export function coyoteNotAbove(imported: CoyoteSettings, current: CoyoteSettings): CoyoteSettings {
	return sanitizeCoyote({
		...imported,
		above100: imported.above100 && current.above100,
		maxA: Math.min(imported.maxA, current.maxA),
		maxB: Math.min(imported.maxB, current.maxB)
	});
}

export const maxOf = (coyote: CoyoteSettings, channel: Channel): number =>
	channel === 'a' ? coyote.maxA : coyote.maxB;

/**
 * The maximum in force per channel.
 * - On a real device: the user's own maxima once it is enabled, and 0 (nothing can be started) until then.
 *   This is the app's own lock: the device's caps are never 0 (deviceCapsFor).
 * - `setup` is the set-up step for one channel: that channel may go up to the cap so that a maximum can be
 *   found, the other stays at 0.
 * - `preview` is looking around without a device: nothing is felt, so everything can be tried on screen, with
 *   the user's maxima where they exist and the default otherwise. Nothing about it is stored.
 */
export function maximaFor(
	coyote: CoyoteSettings,
	mode: { preview?: boolean; setup?: Channel | null } = {}
): Record<Channel, number> {
	if (mode.preview) {
		const own = (v: number) => (coyote.enabled && v > 0 ? v : DEFAULT_CAP);
		return { a: own(coyote.maxA), b: own(coyote.maxB) };
	}
	if (mode.setup) {
		const cap = capOf(coyote.above100);
		return { a: mode.setup === 'a' ? cap : 0, b: mode.setup === 'b' ? cap : 0 };
	}
	return coyote.enabled ? { a: coyote.maxA, b: coyote.maxB } : { a: 0, b: 0 };
}
