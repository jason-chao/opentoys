// Fraction 0..1 → level byte, truncating like the vendor app; clamped (the vendor does not clamp). The same as
// the reference implementation's protocol/frame.py level(); the device layer builds its frames from these bytes.
export function level(x: number): number {
	if (!Number.isFinite(x)) return 0;
	return Math.trunc(Math.min(Math.max(x, 0), 1) * 255);
}
