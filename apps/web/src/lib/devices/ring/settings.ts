// The Dragon S1's own settings: calibration, the e-stim permission, limits and what happens when the page is
// left. Stored as the `ring` block of the settings (lib/app/settings.ts). Everything read back is sanitised: a
// stored value can lower a limit, never raise it above the caps. E-stim stops at 80 % unless the user confirmed
// going higher in this browser (estimAbove80); a file never carries that confirmation, nor the permission to
// use e-stim at all (`lockedRing`).
import { DEFAULT_CAPS, MAX_CAPS, type LimitValues } from '@opentoys/core';

export const RING_ID = 'dragon-s1';

export interface Calibration {
	/** The lowest level that is felt, and the comfortable maximum, per channel (fractions 0..1). */
	vibFloor: number;
	vibMax: number;
	estimFloor: number;
	estimMax: number;
	vibDone: boolean;
	estimDone: boolean;
}

export interface RingSettings {
	/** The ring's safety notes were agreed to, in this browser: needed before any output on a real ring. */
	agreed: boolean;
	/** Its set-up was offered once after a first connection (the vibration levels can be skipped). */
	setupOffered: boolean;
	calibration: Calibration;
	/** E-stim is usable only after its own calibration and an explicit confirmation. */
	estimUnlocked: boolean;
	/** The fastest e-stim may rise, % of the range per second. */
	estimRampPctS: number;
	warmupS: number;
	/** The user's own caps. Vibration up to 100 %; e-stim up to 80 %, or 100 % with estimAbove80. */
	capVib: number;
	capEstim: number;
	/** The user confirmed, in this browser, that e-stim may go above 80 %. */
	estimAbove80: boolean;
	/** "Stop everything when I leave the page" (default: e-stim stops, vibration continues). */
	stopEverythingOnLeave: boolean;
	/** The protocol header learned on connecting, so a reconnection can silence the ring first. */
	knownHeader: number | null;
}

const DEFAULT_CALIBRATION: Readonly<Calibration> = Object.freeze({
	vibFloor: 0.1,
	vibMax: 1.0,
	estimFloor: 0.02,
	estimMax: 0.6,
	vibDone: false,
	estimDone: false
});

export const DEFAULT_RING: Readonly<RingSettings> = Object.freeze({
	agreed: false,
	setupOffered: false,
	calibration: DEFAULT_CALIBRATION,
	estimUnlocked: false,
	estimRampPctS: 25,
	warmupS: 3,
	capVib: DEFAULT_CAPS.vib,
	capEstim: DEFAULT_CAPS.estim,
	estimAbove80: false,
	stopEverythingOnLeave: false,
	knownHeader: null
});

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

function num(x: unknown, lo: number, hi: number, fallback: number): number {
	const v = typeof x === 'number' ? x : Number.NaN;
	return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
}
const bool = (x: unknown, fallback: boolean): boolean => (typeof x === 'boolean' ? x : fallback);
const byte = (x: unknown): number | null =>
	typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xff ? x : null;

/** The keys the ring's settings had when they were stored flat, at the top of the settings. */
const LEGACY_KEYS = [
	'calibration',
	'estimUnlocked',
	'estimRampPctS',
	'warmupS',
	'capVib',
	'capEstim',
	'estimAbove80',
	'stopEverythingOnLeave'
] as const;

/**
 * The ring's block as it was before settings were per device: the flat keys of the stored object, and its
 * header out of `knownHeaders`. Nothing is lost, and nothing is added: the result goes through the same
 * sanitising as any stored block.
 */
export function ringFromLegacy(legacy: Obj): Obj {
	const out: Obj = {};
	for (const key of LEGACY_KEYS) if (key in legacy) out[key] = legacy[key];
	if (isObj(legacy.knownHeaders)) out.knownHeader = legacy.knownHeaders[RING_ID];
	return out;
}

/**
 * Defaults filled in, every number clamped, caps never above what is allowed.
 *
 * The safety agreement: settings from before it was the ring's own were made by someone who had read the
 * ring's safety notes on the welcome screen (`onboarded`), which counts. E-stim that was enabled keeps its
 * agreement too: it was given with the e-stim set-up.
 */
export function sanitizeRing(stored: unknown, legacy: Obj = {}): RingSettings {
	const s = isObj(stored) ? stored : ringFromLegacy(legacy);
	const agreed = typeof s.agreed === 'boolean' ? s.agreed : legacy.onboarded === true;
	const d = DEFAULT_RING;
	const c = isObj(s.calibration) ? s.calibration : {};
	const estimAbove80 = bool(s.estimAbove80, false);
	const capVib = num(s.capVib, 0.05, MAX_CAPS.vib, d.capVib);
	const capEstim = num(s.capEstim, 0, estimAbove80 ? MAX_CAPS.estim : DEFAULT_CAPS.estim, d.capEstim);
	const vibMax = num(c.vibMax, 0.05, capVib, Math.min(d.calibration.vibMax, capVib));
	const estimMax = num(c.estimMax, 0, capEstim, Math.min(d.calibration.estimMax, capEstim));
	const calibration: Calibration = {
		vibFloor: num(c.vibFloor, 0, Math.min(0.5, vibMax), d.calibration.vibFloor),
		vibMax,
		estimFloor: num(c.estimFloor, 0, Math.min(0.5, estimMax), Math.min(d.calibration.estimFloor, estimMax)),
		estimMax,
		vibDone: bool(c.vibDone, false),
		estimDone: bool(c.estimDone, false)
	};
	return {
		agreed,
		// Whoever has calibrated or agreed before this existed has been through it.
		setupOffered: bool(s.setupOffered, agreed) || calibration.vibDone,
		calibration,
		// Unlocking needs the agreement and the e-stim calibration; a stored flag alone never unlocks it.
		estimUnlocked: bool(s.estimUnlocked, false) && agreed && calibration.estimDone && capEstim > 0,
		estimRampPctS: num(s.estimRampPctS, 1, 100, d.estimRampPctS),
		warmupS: num(s.warmupS, 0, 30, d.warmupS),
		capVib,
		capEstim,
		estimAbove80,
		stopEverythingOnLeave: bool(s.stopEverythingOnLeave, false),
		knownHeader: byte(s.knownHeader)
	};
}

/**
 * What a file may carry: never the safety agreement, the permission to use e-stim, nor to go above 80 %. Each
 * needs its confirmation in this browser, by the person using it (a file may come from someone else).
 */
export function lockedRing(ring: RingSettings): RingSettings {
	return sanitizeRing({ ...ring, agreed: false, estimUnlocked: false, estimAbove80: false });
}

/**
 * Imported settings never raise a limit this browser has: the caps, the comfort maxima and the e-stim rise
 * speed are each the lower (the slower) of what the file says and what is set here now.
 */
export function ringNotAbove(imported: RingSettings, current: RingSettings): RingSettings {
	const low = Math.min;
	return sanitizeRing({
		...imported,
		capVib: low(imported.capVib, current.capVib),
		capEstim: low(imported.capEstim, current.capEstim),
		estimRampPctS: low(imported.estimRampPctS, current.estimRampPctS),
		calibration: {
			...imported.calibration,
			vibMax: low(imported.calibration.vibMax, current.calibration.vibMax),
			estimMax: low(imported.calibration.estimMax, current.calibration.estimMax)
		}
	});
}

/**
 * The engine's limits for these settings. The comfort maxima are already under the user's caps
 * (sanitizeRing), and the engine's own caps (the device's full range) stay underneath. E-stim is held at 0
 * until it is enabled.
 *
 * `preview` is for looking around without a device: nothing is felt, so e-stim is shown on screen with the
 * default range even when it is not enabled. Nothing about it is stored.
 */
export function limitsFor(ring: RingSettings, sessionMaxMin: number, preview = false): LimitValues {
	const d = DEFAULT_RING.calibration;
	const show = preview && !ring.estimUnlocked;
	return {
		maxVib: ring.calibration.vibMax,
		maxEstim: ring.estimUnlocked ? ring.calibration.estimMax : show ? d.estimMax : 0,
		estimRampPctS: ring.estimRampPctS,
		warmupS: ring.warmupS,
		sessionMaxS: Math.round(sessionMaxMin * 60),
		vibFloor: ring.calibration.vibFloor,
		estimFloor: show ? d.estimFloor : ring.calibration.estimFloor
	};
}
