// Limits that the engine enforces on every tick (reference spec §7). Values are fractions 0..1 unless named *Pct.

import { PyValueError, pmax, pmin, pyFloat, pyInt, pyRound } from '../py.ts';

/** float(x) clamped to 0..1; anything unreadable (or NaN) is 0 (the reference implementation's _frac / clamp01). */
export function clamp01(x: unknown): number {
	let v: number;
	try {
		v = pyFloat(x);
	} catch (e) {
		if (e instanceof PyValueError) return 0;
		throw e;
	}
	if (v !== v) return 0;
	return pmin(pmax(v, 0), 1);
}

/** Set by whoever builds the app (the reference implementation: the bridge's environment); nothing a page sends can raise them. */
export class HardCaps {
	readonly vib: number;
	readonly estim: number;

	/** Defaults are opentoys' (e-stim 80 %); the reference implementation's dataclass default is REFERENCE_CAPS. */
	constructor(vib = 1.0, estim = 0.8) {
		this.vib = vib;
		this.estim = estim;
	}

	static fromPercent(vibPct: number, estimPct: number): HardCaps {
		return new HardCaps(clamp01(vibPct / 100), clamp01(estimPct / 100));
	}
}

/** the reference implementation's default caps (its HardCaps() dataclass default). */
export const REFERENCE_CAPS = new HardCaps(1.0, 0.6);

/** opentoys' default caps: vibration 100 %, e-stim 80 % (the highest level tested on a wearer). The user can
 * lower them in Settings, or raise e-stim up to MAX_CAPS after a confirmation. */
export const DEFAULT_CAPS = new HardCaps(1.0, 0.8);

/** The most the app ever allows: the device's full range. The engine runs under these; the user's own cap
 * (DEFAULT_CAPS unless changed) reaches it through the limits. */
export const MAX_CAPS = new HardCaps(1.0, 1.0);

export interface LimitValues {
	/** comfort maximum, vibration */
	maxVib: number;
	/** comfort maximum, e-stim */
	maxEstim: number;
	/** the fastest e-stim may rise, % per second (falls are immediate) */
	estimRampPctS: number;
	/** both channels fade in over this long from every start */
	warmupS: number;
	/** output stops after this much output time */
	sessionMaxS: number;
	/** calibration: the lowest level that is felt (presets map onto floor..max) */
	vibFloor: number;
	estimFloor: number;
}

const DEFAULTS: LimitValues = {
	maxVib: 1.0,
	maxEstim: 0.6,
	estimRampPctS: 25.0,
	warmupS: 3.0,
	sessionMaxS: 3600,
	vibFloor: 0.1,
	estimFloor: 0.02
};

const KEYS = Object.keys(DEFAULTS) as (keyof LimitValues)[];

// NaN takes the safe end of the range (as in the reference implementation; otherwise min() would drop the rise limit).
function bound(x: unknown, lo: number, hi: number, safe: number): number {
	const v = pyFloat(x);
	return v !== v ? safe : pmin(pmax(v, lo), hi);
}

export class Limits implements LimitValues {
	maxVib = DEFAULTS.maxVib;
	maxEstim = DEFAULTS.maxEstim;
	estimRampPctS = DEFAULTS.estimRampPctS;
	warmupS = DEFAULTS.warmupS;
	sessionMaxS = DEFAULTS.sessionMaxS;
	vibFloor = DEFAULTS.vibFloor;
	estimFloor = DEFAULTS.estimFloor;

	constructor(values: Partial<LimitValues> = {}) {
		for (const k of KEYS) if (values[k] !== undefined) this[k] = values[k];
	}

	/** A copy with every field forced into its valid range and under the hard caps. */
	bounded(caps: HardCaps): Limits {
		return new Limits({
			maxVib: pmin(clamp01(this.maxVib), caps.vib),
			maxEstim: pmin(clamp01(this.maxEstim), caps.estim),
			estimRampPctS: bound(this.estimRampPctS, 1, 100, 1),
			warmupS: bound(this.warmupS, 0, 30, 30),
			sessionMaxS: Number.isNaN(this.sessionMaxS)
				? 60
				: pyInt(pmin(pmax(pyInt(this.sessionMaxS), 60), 86400)),
			vibFloor: pmin(clamp01(this.vibFloor), 0.5),
			estimFloor: pmin(clamp01(this.estimFloor), 0.5)
		});
	}

	/** The given fields changed (undefined/null and unknown keys ignored), then bounded. */
	update(caps: HardCaps, kw: Partial<Record<keyof LimitValues, unknown>>): Limits {
		const d: Record<string, unknown> = { ...this.values() };
		for (const [k, v] of Object.entries(kw)) if (k in d && v !== undefined && v !== null) d[k] = v;
		return new Limits(d as Partial<LimitValues>).bounded(caps);
	}

	values(): LimitValues {
		return Object.fromEntries(KEYS.map((k) => [k, this[k]])) as unknown as LimitValues;
	}

	asDict(): LimitValues {
		return Object.fromEntries(KEYS.map((k) => [k, pyRound(this[k], 4)])) as unknown as LimitValues;
	}
}
