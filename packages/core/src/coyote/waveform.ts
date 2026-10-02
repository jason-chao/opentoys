// The Coyote waveform model, in opentoys' own format, and its renderer.
//
// A waveform is a list of sections; each section sweeps between two frequencies over a duration using one of four
// modes, and carries a list of strength points (0..100):
//
//   { restTime: 0..100,          silent render frames after the last section
//     speed: 1 | 2 | 4,          rendered points per 100 ms frame (4 gives 25 ms resolution)
//     sections: [{
//       freq1, freq2: 10..1000,  frequency parameters (integers; the protocol's own unit, see encodeFreq)
//       duration: 1..3000,       render frames the section lasts (rounded up to whole passes over its points)
//       mode: 1..4,              1 constant freq1 · 2 sweep over the whole section · 3 sweep within each pass ·
//                                4 step once per pass
//       enabled: boolean,
//       points: [0..100, ...]    at least one, integers
//     }] }
//
// All values are real ones: there are no lookup tables behind them. The renderer is ported from the reference implementation
// (waveform/generator.py) and gives the same frames for the same values, including its behaviour for
// single-point sections in modes 2 and 3 (the sweep is undefined there, and the frequency falls back to 10).

import { PulseFrame, decodeFreq, encodeFreq } from './frame.ts';

export type WaveformMode = 1 | 2 | 3 | 4;
export type WaveformSpeed = 1 | 2 | 4;

export interface WaveformSection {
	freq1: number;
	freq2: number;
	duration: number;
	mode: WaveformMode;
	enabled: boolean;
	points: number[];
}

export interface Waveform {
	restTime: number;
	speed: WaveformSpeed;
	sections: WaveformSection[];
}

export const FREQ_MIN = 10;
export const FREQ_MAX = 1000;
export const DURATION_MAX = 3000;
export const REST_TIME_MAX = 100;

export class WaveformError extends Error {
	override name = 'WaveformError';
}

const isInt = (x: unknown, lo: number, hi: number): x is number =>
	typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Validate untrusted data in the own format; returns a normalised copy (restTime 0, speed 1 and enabled true when
 * left out). Throws WaveformError. */
export function parseWaveform(input: unknown): Waveform {
	if (!isObj(input)) throw new WaveformError('a waveform must be an object');
	const restTime = input.restTime ?? 0;
	const speed = input.speed ?? 1;
	if (!isInt(restTime, 0, REST_TIME_MAX)) throw new WaveformError('restTime must be 0..100');
	if (speed !== 1 && speed !== 2 && speed !== 4) throw new WaveformError('speed must be 1, 2 or 4');
	if (!Array.isArray(input.sections) || input.sections.length === 0)
		throw new WaveformError('at least one section');
	const sections = input.sections.map((s: unknown): WaveformSection => {
		if (!isObj(s)) throw new WaveformError('a section must be an object');
		if (!isInt(s.freq1, FREQ_MIN, FREQ_MAX) || !isInt(s.freq2, FREQ_MIN, FREQ_MAX))
			throw new WaveformError('frequency must be 10..1000');
		if (!isInt(s.duration, 1, DURATION_MAX)) throw new WaveformError('duration must be 1..3000');
		if (!isInt(s.mode, 1, 4)) throw new WaveformError('mode must be 1..4');
		const enabled = s.enabled ?? true;
		if (typeof enabled !== 'boolean') throw new WaveformError('enabled must be true or false');
		if (!Array.isArray(s.points) || s.points.length === 0)
			throw new WaveformError('a section needs at least one point');
		for (const p of s.points)
			if (!isInt(p, 0, 100)) throw new WaveformError('point strength must be an integer 0..100');
		return {
			freq1: s.freq1,
			freq2: s.freq2,
			duration: s.duration,
			mode: s.mode as WaveformMode,
			enabled,
			points: [...(s.points as number[])]
		};
	});
	return { restTime, speed, sections };
}

/** Throws WaveformError unless `wf` is a valid waveform. */
export function validateWaveform(wf: Waveform): void {
	parseWaveform(wf);
}

function encode(f: number): number {
	return Number.isFinite(f) ? encodeFreq(Math.floor(f)) : 10;
}

/** [encoded frequency, strength] per rendered point, for one pass of the waveform. */
export function samples(wf: Waveform): [number, number][] {
	validateWaveform(wf);
	if (!wf.sections.some((s) => s.enabled)) throw new WaveformError('no enabled section');
	const out: [number, number][] = [];
	for (const sec of wf.sections) {
		if (!sec.enabled) continue;
		const n = sec.points.length;
		const repeats = Math.ceil(sec.duration / n);
		const f1 = sec.freq1;
		const f2 = sec.freq2;
		const step = 1 / n;
		for (let rep = 1; rep <= repeats; rep++) {
			sec.points.forEach((p, k) => {
				const pos = step * (k + 1);
				let f: number;
				// With one point n − 1 is 0: 0 / 0 is NaN here as in the reference implementation, and NaN encodes as 10.
				if (sec.mode === 2) f = f1 + ((f2 - f1) * (rep + (n * pos - 1) / (n - 1) - 1)) / repeats;
				else if (sec.mode === 3) f = f1 + ((f2 - f1) * (n * pos - 1)) / (n - 1);
				else if (sec.mode === 4) f = repeats > 1 ? f1 + ((f2 - f1) * (rep - 1)) / (repeats - 1) : f1;
				else f = f1;
				out.push([encode(f), Math.floor(p)]);
			});
		}
	}
	for (let i = 0; i < Math.ceil(wf.restTime); i++) out.push([10, 0]);
	return out;
}

/** All frames of one pass (the player loops them): samples packed `speed` at a time, a short last group padded
 * with silence. */
export function frames(wf: Waveform): PulseFrame[] {
	const all = samples(wf);
	const out: PulseFrame[] = [];
	for (let i = 0; i < all.length; i += wf.speed) {
		const group = all.slice(i, i + wf.speed);
		while (group.length < wf.speed) group.push([10, 0]);
		out.push(
			new PulseFrame(
				group.map((g) => g[0]),
				group.map((g) => g[1])
			)
		);
	}
	return out;
}

/** How long one pass lasts, in seconds. */
export function playDurationS(wf: Waveform): number {
	let total = 0;
	for (const s of wf.sections) {
		if (!s.enabled) continue;
		const n = s.points.length;
		total += Math.ceil(s.duration / n) * n;
	}
	total += wf.restTime;
	return Math.ceil(total / wf.speed) / 10;
}

export interface WaveformPreview {
	/** each value covers this long */
	slotMs: 25;
	/** strength 0..100 per 25 ms slot, over one pass */
	strength: number[];
	/** frequency parameter 10..1000 per 25 ms slot (as the device will play it: decoded from the wire byte) */
	freq: number[];
	durationS: number;
}

/** What one pass looks like, for drawing strength and frequency before a waveform is started. */
export function previewWaveform(wf: Waveform): WaveformPreview {
	const strength: number[] = [];
	const freq: number[] = [];
	const all = frames(wf);
	for (const frame of all) {
		const [f, s] = frame.expanded(1);
		strength.push(...s);
		freq.push(...f.map(decodeFreq));
	}
	return { slotMs: 25, strength, freq, durationS: all.length / 10 };
}
