// The envelope language for built-in presets (reference spec §6.4): a list of segments per channel, rendered once
// to a lane of one value per 50 ms tick. Values are fractions of the calibrated felt range (0 = off).
//
//   ["hold", level, ms]                                  hold a level
//   ["rest", ms]                                         output 0
//   ["ramp", a, b, ms, curve?]                           a → b; curve lin | ease | exp (default lin)
//   ["sine", lo, hi, period_ms, cycles, skew?]           starts at lo; skew = share of the period spent rising
//   ["pulse", hi, on_ms, off_ms, count, lo?, soft_ms?]   square pulses; lo instead of 0 between; soft = ramped edges
//   ["steps", start, ratio, dwell_ms, count, soft_ms?]   Weber-sized staircase start·ratio^k (capped at 1)
//   ["euclid", k, n, step_ms, on_ms, accent, level, swing?]   E(k, n) onsets; first onset at accent; swing
//                                                             lengthens even steps / shortens odd ones (0–0.5)
//   ["seq", [values…], step_ms]                          explicit values, each held for step_ms
//   ["repeat", n, [segments…]]
//
// A channel may instead be {"follow": "vib", "scale": s, "lag_ms": l, "smooth_ms": m, "invert": bool}: derived
// from the vibration lane (inverted = 1 − vib), smoothed by a one-pole filter so its edges are soft.

import { PyValueError, pmax, pmin, pyFloat, pyInt, pyMod, pyRound, truthy } from '../py.ts';

export const TICK_MS = 50;

export type Segment = readonly unknown[];
export interface FollowSpec {
	follow: string;
	scale?: number;
	lag_ms?: number;
	smooth_ms?: number;
	invert?: boolean;
}
export type ChannelSpec = readonly Segment[] | FollowSpec;

export class RenderError extends PyValueError {
	override name = 'RenderError';
}

function ticks(ms: unknown): number {
	const n = pyInt(pyRound(pyFloat(ms) / TICK_MS));
	if (n < 1) throw new RenderError(`duration ${String(ms)} ms is shorter than one tick (${TICK_MS} ms)`);
	return n;
}

// Plain arithmetic on a value, as Python does it without float(): numbers and booleans only.
function num(x: unknown): number {
	if (typeof x === 'number') return x;
	if (typeof x === 'boolean') return x ? 1 : 0;
	throw new PyValueError(`not a number: ${String(x)}`);
}

function curve(name: unknown, f: number): number {
	if (name === 'lin') return f;
	if (name === 'ease') return f * f * (3 - 2 * f); // smoothstep
	if (name === 'exp') return (Math.exp(3 * f) - 1) / (Math.exp(3) - 1); // slow start, fast finish
	throw new RenderError(`unknown curve ${String(name)}`);
}

/** Bjorklund / Bresenham spread of k onsets over n steps, rotated to start on an onset. */
export function euclid(k: number, n: number): number[] {
	if (!(0 < k && k <= n)) throw new RenderError('euclid needs 0 < k <= n');
	const pat: number[] = [];
	for (let i = 0; i < n; i++) pat.push(pyMod(i * k, n) < k ? 1 : 0);
	return pat;
}

function softEdges(values: number[], n: number): number[] {
	if (n <= 0 || values.length === 0) return values;
	const out = [...values];
	for (let i = 0; i < Math.min(n, out.length); i++) {
		const f = (i + 1) / (n + 1);
		out[i] = (out[i] as number) * f;
		out[out.length - 1 - i] = (out[out.length - 1 - i] as number) * f;
	}
	return out;
}

function times<T>(xs: readonly T[], count: number): T[] {
	const out: T[] = [];
	for (let c = 0; c < count; c++) out.push(...xs);
	return out;
}

function fill(v: number, count: number): number[] {
	return count > 0 ? new Array<number>(count).fill(v) : [];
}

// Python unpacking: exactly (or at least) this many arguments.
function need(a: readonly unknown[], n: number, exact: boolean): void {
	if (exact ? a.length !== n : a.length < n) throw new PyValueError('wrong number of values to unpack');
}

function segment(seg: unknown): number[] {
	if (!Array.isArray(seg) || seg.length === 0) throw new RenderError(`bad segment ${JSON.stringify(seg)}`);
	const kind = seg[0];
	const a: unknown[] = seg.slice(1);
	try {
		if (kind === 'hold') {
			need(a, 2, true);
			const level = pyFloat(a[0]);
			return fill(level, ticks(a[1]));
		}
		if (kind === 'rest') {
			need(a, 1, true);
			return fill(0, ticks(a[0]));
		}
		if (kind === 'ramp') {
			need(a, 3, false);
			const n = ticks(a[2]);
			const c = a.length > 3 ? a[3] : 'lin';
			const lo = num(a[0]);
			const hi = num(a[1]);
			const out: number[] = [];
			for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * curve(c, (i + 1) / n));
			return out;
		}
		if (kind === 'sine') {
			need(a, 4, false);
			const skew = a.length > 4 ? pyFloat(a[4]) : 0.5;
			if (!(0.05 <= skew && skew <= 0.95)) throw new RenderError('sine skew must be 0.05..0.95');
			const n = ticks(a[2]);
			const lo = num(a[0]);
			const hi = num(a[1]);
			const one: number[] = [];
			for (let i = 0; i < n; i++) {
				const ph = i / n;
				const s =
					ph < skew
						? 0.5 - 0.5 * Math.cos((Math.PI * ph) / skew)
						: 0.5 + 0.5 * Math.cos((Math.PI * (ph - skew)) / (1 - skew));
				one.push(lo + (hi - lo) * s);
			}
			return times(one, pyInt(a[3]));
		}
		if (kind === 'pulse') {
			need(a, 4, false);
			const lo = a.length > 4 ? pyFloat(a[4]) : 0;
			const soft = a.length > 5 && truthy(a[5]) ? ticks(a[5]) : 0;
			let on = fill(pyFloat(a[0]), ticks(a[1]));
			if (soft) {
				const f = softEdges(fill(1, on.length), soft);
				on = on.map((v, i) => lo + (v - lo) * (f[i] as number));
			}
			return times([...on, ...fill(lo, ticks(a[2]))], pyInt(a[3]));
		}
		if (kind === 'steps') {
			need(a, 4, false);
			const soft = a.length > 4 && truthy(a[4]) ? ticks(a[4]) : 0;
			const out: number[] = [];
			let prev = 0;
			const count = pyInt(a[3]);
			for (let k = 0; k < count; k++) {
				const v = pmin(1, pyFloat(a[0]) * pyFloat(a[1]) ** k);
				const block = fill(v, ticks(a[2]));
				if (soft) {
					const m = Math.min(soft, block.length);
					for (let i = 0; i < m; i++) block[i] = prev + ((v - prev) * (i + 1)) / m;
				}
				out.push(...block);
				prev = v;
			}
			return out;
		}
		if (kind === 'euclid') {
			need(a, 6, false);
			const swing = a.length > 6 ? pyFloat(a[6]) : 0;
			if (!(0 <= swing && swing <= 0.5)) throw new RenderError('euclid swing must be 0..0.5');
			const step = num(a[2]);
			const out: number[] = [];
			let first = true;
			euclid(pyInt(a[0]), pyInt(a[1])).forEach((hit, i) => {
				const dur = i % 2 === 0 ? step * (1 + swing) : step * (1 - swing);
				const n = ticks(dur);
				const onT = hit ? Math.min(ticks(a[3]), n - 1) : 0;
				const v = first ? pyFloat(a[4]) : pyFloat(a[5]);
				if (hit) first = false;
				out.push(...fill(v, onT), ...fill(0, n - onT));
			});
			return out;
		}
		if (kind === 'seq') {
			need(a, 2, true);
			const n = ticks(a[1]);
			if (!Array.isArray(a[0])) throw new PyValueError('seq needs a list of values');
			return a[0].flatMap((v: unknown) => fill(pyFloat(v), n));
		}
		if (kind === 'repeat') {
			need(a, 2, true);
			const n = pyInt(a[0]);
			return times(renderSegments(a[1]), n);
		}
	} catch (e) {
		if (e instanceof RenderError) throw e;
		if (e instanceof PyValueError)
			throw new RenderError(`bad ${String(kind)} segment ${JSON.stringify(seg)}: ${e.message}`);
		throw e;
	}
	throw new RenderError(`unknown segment kind ${String(kind)}`);
}

export function renderSegments(segments: unknown): number[] {
	if (!Array.isArray(segments) || segments.length === 0)
		throw new RenderError('an envelope needs at least one segment');
	const out: number[] = [];
	for (const seg of segments) out.push(...segment(seg));
	return out.map((v) => pmin(1, pmax(0, pyRound(v, 4))));
}

/** One-pole low-pass run twice round the loop, so the result is the loop's steady state. */
export function smoothLoop(lane: readonly number[], smoothMs: number): number[] {
	if (smoothMs <= 0) return [...lane];
	const alpha = TICK_MS / (smoothMs + TICK_MS);
	let y = lane[lane.length - 1] as number;
	const out = new Array<number>(lane.length).fill(0);
	for (let pass = 0; pass < 2; pass++) {
		lane.forEach((x, i) => {
			y += alpha * (x - y);
			out[i] = y;
		});
	}
	return out;
}

export function renderFollow(spec: FollowSpec, vib: readonly number[]): number[] {
	if (spec.follow !== 'vib') throw new RenderError("only 'follow': 'vib' is supported");
	let src = truthy(spec.invert) ? vib.map((v) => 1 - v) : [...vib];
	const lag = pyMod(pyInt(pyRound(pyFloat(spec.lag_ms ?? 0) / TICK_MS)), Math.max(1, src.length));
	if (lag) src = [...src.slice(-lag), ...src.slice(0, -lag)];
	const out = smoothLoop(src, pyFloat(spec.smooth_ms ?? 0));
	const scale = pyFloat(spec.scale ?? 1.0);
	return out.map((v) => pmin(1, pmax(0, pyRound(v * scale, 4))));
}

export function renderChannel(spec: ChannelSpec, vibLane: readonly number[] = []): number[] {
	if (!Array.isArray(spec)) return renderFollow(spec as FollowSpec, vibLane);
	return renderSegments(spec);
}

/** The fastest rise in a looping lane, in % of the range per second. */
export function maxRisePctS(lane: readonly number[]): number {
	if (lane.length < 2) return 0;
	const rises = lane.map((a, i) => (lane[(i + 1) % lane.length] as number) - a);
	return pyRound((pmax(0, pmax(...rises)) * 100 * 1000) / TICK_MS, 1);
}
