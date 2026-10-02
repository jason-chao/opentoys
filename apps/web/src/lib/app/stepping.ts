// Stepping a value with − and +: what every output row on Control does, whatever the output's scale (the
// Coyote's 0–200 in steps of 1, the ring's 0–100 % in steps of 5).

/**
 * `value` moved by `steps` steps of size `step`, kept on the step grid and within [min, max]. A value between
 * two grid points (a wheel on the device, a slider elsewhere) goes to the next grid point in the direction
 * asked, not a whole step past it. The maximum itself can always be reached, on the grid or not.
 */
export function stepValue(value: number, steps: number, step: number, min: number, max: number): number {
	if (!(step > 0) || !Number.isFinite(value) || !Number.isFinite(steps) || steps === 0)
		return clamp(Number.isFinite(value) ? value : min, min, max);
	const at = (value - min) / step;
	// Rounded first, so 0.15000000000000002 counts as on the grid.
	const near = Math.round(at);
	const onGrid = Math.abs(at - near) < 1e-6;
	const from = onGrid ? near : steps > 0 ? Math.floor(at) : Math.ceil(at);
	const next = min + (from + Math.trunc(steps)) * step;
	// One rounding at the end keeps 5 % steps at 5 %, 10 %, 15 % (no 0.15000000000000002).
	return clamp(Math.round(next * 1e6) / 1e6, min, max);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
