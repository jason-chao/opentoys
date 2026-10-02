// SVG paths for the waveform previews: values 0..1 drawn left to right, 1 at the top.

/** Points spread evenly across the width; `inset` keeps the stroke inside the box. */
function points(values: readonly number[], w: number, h: number, inset: number): [number, number][] {
	const n = values.length;
	if (n === 0) return [];
	const usable = h - 2 * inset;
	const step = n > 1 ? w / (n - 1) : 0;
	return values.map((v, i) => [
		round(n > 1 ? i * step : w / 2),
		round(inset + usable * (1 - Math.min(1, Math.max(0, v))))
	]);
}

const round = (x: number) => Math.round(x * 10) / 10;

/** A line through the values ("" for none). */
export function linePath(values: readonly number[], w: number, h: number, inset = 1): string {
	let pts = points(values, w, h, inset);
	if (pts.length === 1)
		pts = [
			[0, pts[0][1]],
			[w, pts[0][1]]
		];
	return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
}

/** The same line closed down to the baseline, for a filled area. */
export function areaPath(values: readonly number[], w: number, h: number, inset = 1): string {
	const line = linePath(values, w, h, inset);
	return line ? `${line}L${w} ${h}L0 ${h}Z` : '';
}

/** Evenly spaced "nice" time marks (seconds) for an axis over `seconds`, at most `max` of them, 0 included. */
export function timeTicks(seconds: number, max = 6): number[] {
	if (!(seconds > 0)) return [0];
	const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
	const step = nice.find((s) => seconds / s <= max - 1) ?? Math.ceil(seconds / (max - 1) / 60) * 60;
	const out: number[] = [];
	for (let t = 0; t <= seconds + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
	return out;
}

/** True when a channel has anything to draw. */
export const hasSignal = (values: readonly number[]): boolean => values.some((v) => v > 0);

/** At most `max` evenly picked values (for thumbnails of long recordings). */
export function downsample(values: readonly number[], max = 120): number[] {
	const every = Math.max(1, Math.ceil(values.length / max));
	return values.filter((_, i) => i % every === 0);
}
