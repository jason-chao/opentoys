// Limits that every layer (engine, output loop, device) enforces independently.
// Ported from the reference implementation (safety.py).

/** The hardware's own ceiling for the intensity field. */
export const DEVICE_MAX = 200;

/** A number as an integer, truncated like Python's int(); anything that is not a finite number counts as 0
 * (the reference implementation raises there: for an intensity, 0 is the safe reading). */
export function toInt(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) + 0 : 0;
}

export interface CoyoteLimitValues {
	/** hard cap on any commanded intensity, 1..DEVICE_MAX */
	absoluteMax: number;
	/** the engine stops itself after this long of output, 60..86400 */
	sessionMaxS: number;
}

export class CoyoteLimits implements CoyoteLimitValues {
	absoluteMax: number;
	sessionMaxS: number;

	constructor(values: Partial<CoyoteLimitValues> = {}) {
		this.absoluteMax = values.absoluteMax ?? 100;
		this.sessionMaxS = values.sessionMaxS ?? 3600;
	}

	clamp(intensity: number): number {
		return Math.max(0, Math.min(this.absoluteMax, toInt(intensity)));
	}

	validate(): this {
		if (!(Number.isInteger(this.absoluteMax) && this.absoluteMax >= 1 && this.absoluteMax <= DEVICE_MAX))
			throw new RangeError('absolute_max must be 1..200');
		if (!(Number.isInteger(this.sessionMaxS) && this.sessionMaxS >= 60 && this.sessionMaxS <= 86400))
			throw new RangeError('session_max_s must be 60..86400');
		return this;
	}
}
