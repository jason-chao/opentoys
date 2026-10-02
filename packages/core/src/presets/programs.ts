// Preset programs: what a preset produces each 50 ms tick, as fractions of the calibrated range (0 = off).
//
// LaneProgram plays rendered lanes (each channel loops on its own length). The generators compute output live
// from the seeded portable Rng (rng.ts, shared with the reference implementation): the same seed and parameters reproduce the same
// session, a new seed never repeats. Every generator shares the e-stim options estim_mode
// (off | follow | counter | steady) and estim_level; follow/counter pass through a one-pole filter (≥ 0.5 s / 1 s),
// so e-stim never jumps.
//
// Nothing here knows about limits: mapping, caps, warm-up and the e-stim rise limit are applied afterwards by the
// engine session, exactly as for every other source.
//
// Parameter keys stay snake_case (estim_mode, period_s, ...): they are data shared with the reference implementation.
// Phase labels are English diagnostics as in the reference implementation; the app shows its own translated text.

import type { Rng } from '../rng.ts';
import {
	PyValueError,
	pmax,
	pmin,
	pyFixed,
	pyFloat,
	pyFloorDiv,
	pyFormatG,
	pyReprStr,
	pyRound,
	trailingZeros
} from '../py.ts';
import { TICK_MS, euclid } from './render.ts';

export type Pair = [number, number];

/** Quantise to 1 % steps: fewer distinct bytes, so change-only sending stays sparse. */
export function q(x: number): number {
	return pmin(1, pmax(0, pyRound(x * 100) / 100));
}

// ----- parameter schemas --------------------------------------------------------------------------------------
export interface NumberParam {
	key: string;
	label: string;
	type: 'number';
	min: number;
	max: number;
	default: number;
	step: number;
	unit: string;
	/** validated values are rounded to integers (the reference implementation: the default is a Python int) */
	integer: boolean;
}
export interface ChoiceParam {
	key: string;
	label: string;
	type: 'choice';
	options: string[];
	default: string;
}
export type Param = NumberParam | ChoiceParam;
export type Params = Record<string, number | string>;

function num(
	key: string,
	label: string,
	lo: number,
	hi: number,
	def: number,
	opts: { step?: number; unit?: string; integer?: boolean } = {}
): NumberParam {
	const integer = opts.integer ?? false;
	return {
		key,
		label,
		type: 'number',
		min: lo,
		max: hi,
		default: def,
		step: opts.step || (integer ? 1 : 0.05),
		unit: opts.unit ?? '',
		integer
	};
}

function choice(key: string, label: string, options: string[], def: string): ChoiceParam {
	return { key, label, type: 'choice', options: [...options], default: def };
}

const ESTIM_PARAMS = (): Param[] => [
	choice('estim_mode', 'E-stim', ['follow', 'counter', 'steady', 'off'], 'follow'),
	num('estim_level', 'E-stim level', 0.1, 1.0, 0.6, { step: 0.05 })
];

function pyListRepr(xs: readonly string[]): string {
	return `[${xs.map(pyReprStr).join(', ')}]`;
}

/** Defaults filled in, numbers clamped to their range, unknown keys and bad choices refused. */
export function validate(schema: readonly Param[], params?: Record<string, unknown> | null): Params {
	const given: Record<string, unknown> = { ...(params ?? {}) };
	const known = new Set(schema.map((p) => p.key));
	const bad = Object.keys(given)
		.filter((k) => !known.has(k))
		.sort();
	if (bad.length) throw new PyValueError(`unknown parameter(s): ${bad.join(', ')}`);
	const out: Params = {};
	for (const p of schema) {
		let v = Object.hasOwn(given, p.key) ? given[p.key] : p.default;
		if (p.type === 'choice') {
			if (typeof v !== 'string' || !p.options.includes(v))
				throw new PyValueError(`${p.key} must be one of ${pyListRepr(p.options)}`);
		} else {
			let x: number;
			try {
				x = pyFloat(v);
			} catch {
				throw new PyValueError(`${p.key} must be a number`);
			}
			if (x !== x) throw new PyValueError(`${p.key} must be a number`);
			x = pmin(p.max, pmax(p.min, x));
			if (p.integer) x = pyRound(x);
			v = x;
		}
		out[p.key] = v as number | string;
	}
	return out;
}

// ----- base ---------------------------------------------------------------------------------------------------
export interface Program {
	phase: string;
	readonly done: boolean;
	sample(dtMs: number): Pair;
}

export class LaneProgram implements Program {
	phase = '';
	readonly done = false;
	readonly vib: number[];
	readonly estim: number[];
	elapsedMs = 0;

	constructor(vib: readonly number[], estim: readonly number[]) {
		this.vib = vib.length ? [...vib] : [0];
		this.estim = estim.length ? [...estim] : [0];
	}

	sample(dtMs: number): Pair {
		const i = Math.trunc(pyFloorDiv(this.elapsedMs, TICK_MS));
		this.elapsedMs += dtMs;
		return [this.vib[i % this.vib.length] as number, this.estim[i % this.estim.length] as number];
	}
}

class Smooth {
	readonly alpha: number;
	y = 0;

	constructor(tauMs: number) {
		this.alpha = TICK_MS / (tauMs + TICK_MS);
	}

	next(x: number): number {
		this.y += this.alpha * (x - this.y);
		return this.y;
	}
}

/** Vibration from vib(dt); e-stim derived from it by estim_mode. */
abstract class Generator implements Program {
	phase = '';
	done = false;
	tMs = 0;
	protected readonly p: Params;
	protected readonly rng: Rng;
	private readonly follow = new Smooth(500);
	private readonly counter = new Smooth(1000);

	constructor(params: Params, rng: Rng) {
		this.p = params;
		this.rng = rng;
	}

	protected abstract vib(dtMs: number): number;

	protected n(key: string): number {
		return this.p[key] as number;
	}

	sample(dtMs: number): Pair {
		const v = q(this.vib(dtMs));
		this.tMs += dtMs;
		const mode = this.p.estim_mode ?? 'off';
		const lvl = pyFloat(this.p.estim_level ?? 0.5);
		const f = this.follow.next(v);
		const c = this.counter.next(1 - v);
		const e = mode === 'follow' ? f * lvl : mode === 'counter' ? c * lvl : mode === 'steady' ? lvl : 0;
		return [v, q(e)];
	}
}

// ----- generators ---------------------------------------------------------------------------------------------
function shapeValue(kind: string, ph: number, depth: number, duty: number): number {
	const lo = 1 - depth;
	if (kind === 'wave') return lo + depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
	if (kind === 'breath') {
		const s =
			ph < 0.4
				? 0.5 - 0.5 * Math.cos((Math.PI * ph) / 0.4)
				: 0.5 + 0.5 * Math.cos((Math.PI * (ph - 0.4)) / 0.6);
		return lo + depth * s;
	}
	if (kind === 'pulse') return ph < duty ? 1 : lo > 0.05 ? lo : 0;
	if (kind === 'stroke') return lo + depth * Math.sin(Math.PI * ph) ** 2;
	// lub (18 %) · gap (12 %) · dub (12 %) · rest
	if (kind === 'heartbeat') return ph < 0.18 ? 1 : ph < 0.3 ? 0 : ph < 0.42 ? 0.7 : 0;
	throw new PyValueError(kind);
}

export class ShapeGen extends Generator {
	static readonly SCHEMA: Param[] = [
		choice('shape', 'Shape', ['wave', 'breath', 'pulse', 'stroke', 'heartbeat'], 'wave'),
		num('period_s', 'Period', 0.3, 20.0, 4.0, { step: 0.1, unit: 's' }),
		num('depth', 'Depth', 0.1, 1.0, 0.7),
		num('duty', 'On share (pulse)', 0.1, 0.9, 0.5),
		...ESTIM_PARAMS()
	];

	protected vib(): number {
		const shape = this.p.shape as string;
		let period = pmax(0.3, this.n('period_s')) * 1000;
		let duty = this.n('duty');
		if (shape === 'pulse') {
			// full-depth pulses stay >= 100 ms on and >= 100 ms off
			period = pmax(period, 200);
			duty = pmin(pmax(duty, 100 / period), 1 - 100 / period);
		}
		if (shape === 'heartbeat') period = pmax(period, 850); // every beat and gap >= 100 ms
		const ph = (this.tMs % period) / period;
		this.phase = `${shape} · ${pyFormatG(period / 1000)} s`;
		return shapeValue(shape, ph, this.n('depth'), duty);
	}
}

export class EuclidGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('k', 'Beats', 1, 12, 5, { integer: true }),
		num('n', 'Steps', 2, 16, 8, { integer: true }),
		num('bpm', 'Tempo', 60, 160, 110, { step: 1, unit: 'bpm', integer: true }),
		num('swing', 'Swing', 0.0, 0.4, 0.15),
		num('accent', 'Accent', 0.3, 1.0, 1.0),
		num('level', 'Beat level', 0.2, 1.0, 0.7),
		...ESTIM_PARAMS()
	];
	private readonly pat: number[];
	private step = 0;
	private inStep = 0;

	constructor(params: Params, rng: Rng) {
		super(params, rng);
		const k = Math.trunc(params.k as number);
		const n = Math.trunc(params.n as number);
		this.pat = euclid(Math.min(k, n), n);
	}

	protected vib(dtMs: number): number {
		const base = 60000 / this.n('bpm') / 2; // eighth notes
		const sw = this.n('swing');
		const dur = this.step % 2 === 0 ? base * (1 + sw) : base * (1 - sw);
		if (this.inStep >= dur) {
			this.inStep -= dur;
			this.step = (this.step + 1) % this.pat.length;
		}
		const on = pmin(150.0, dur - 100); // >= 100 ms of silence between beats
		const hit = this.pat[this.step] === 1 && this.inStep < on;
		const first = this.step === this.pat.indexOf(1);
		this.inStep += dtMs;
		const beats = this.pat.reduce((a, b) => a + b, 0);
		this.phase = `E(${beats},${this.pat.length}) · ${pyFormatG(this.n('bpm'))} bpm`;
		return hit ? (first ? this.n('accent') : this.n('level')) : 0;
	}
}

/** Ornstein–Uhlenbeck: a random walk pulled back towards the mean with time constant tau. */
export class DriftGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('mean', 'Level', 0.1, 1.0, 0.6),
		num('spread', 'Spread', 0.05, 0.5, 0.2),
		num('tau_s', 'Slowness', 1.0, 30.0, 6.0, { step: 0.5, unit: 's' }),
		...ESTIM_PARAMS()
	];
	private x: number;

	constructor(params: Params, rng: Rng) {
		super(params, rng);
		this.x = params.mean as number;
	}

	protected vib(dtMs: number): number {
		const dt = dtMs / 1000;
		const tau = this.n('tau_s');
		this.x +=
			((this.n('mean') - this.x) * dt) / tau +
			this.n('spread') * Math.sqrt((2 * dt) / tau) * this.rng.gauss(0, 1);
		this.x = pmin(1, pmax(0.05, this.x));
		this.phase = 'drifting';
		return this.x;
	}
}

/** 1/f fluctuation (Voss–McCartney): 8 random sources, source k re-drawn every 2^k steps. */
export class PinkGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('mean', 'Level', 0.1, 1.0, 0.6),
		num('depth', 'Depth', 0.05, 0.5, 0.3),
		num('speed', 'Speed', 0.2, 5.0, 1.0, { step: 0.1, unit: '×' }),
		...ESTIM_PARAMS()
	];
	private readonly rows: number[];
	private count = 0;
	private acc = 0;

	constructor(params: Params, rng: Rng) {
		super(params, rng);
		this.rows = Array.from({ length: 8 }, () => rng.random());
	}

	protected vib(dtMs: number): number {
		this.acc += dtMs;
		const step = 100 / this.n('speed');
		while (this.acc >= step) {
			this.acc -= step;
			this.count += 1;
			// trailing zeros: 0 every step, 1 every 2nd, …
			this.rows[Math.min(trailingZeros(this.count), 7)] = this.rng.random();
		}
		let sum = 0; // left to right, like Python's sum() before 3.12
		for (const r of this.rows) sum += r;
		const s = sum / this.rows.length; // 0..1, centred on 0.5
		this.phase = '1/f texture';
		return pmin(1, pmax(0.05, this.n('mean') + this.n('depth') * 2 * (s - 0.5) * 1.8));
	}
}

/** A regular pulse; each cycle may instead be an accent, a skipped beat or a short pause. */
export class SurpriseGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('period_s', 'Period', 0.3, 4.0, 1.0, { step: 0.1, unit: 's' }),
		num('duty', 'On share', 0.2, 0.8, 0.5),
		num('level', 'Level', 0.2, 1.0, 0.7),
		num('p', 'Surprise', 0.0, 0.5, 0.2),
		...ESTIM_PARAMS()
	];
	private left = 0;
	private len = 0;
	private kind = 'beat';

	private next(): void {
		const r = this.rng.random();
		const p = this.n('p');
		if (r < p * 0.2) {
			this.kind = 'pause';
			this.left = this.rng.uniform(2000, 5000);
		} else if (r < p * 0.6) {
			this.kind = 'skip';
			this.left = this.n('period_s') * 1000;
		} else if (r < p) {
			this.kind = 'accent';
			this.left = this.n('period_s') * 1000;
		} else {
			this.kind = 'beat';
			this.left = this.n('period_s') * 1000;
		}
		this.len = this.left;
	}

	protected vib(dtMs: number): number {
		if (this.left <= 0) this.next();
		const ph = 1 - this.left / this.len;
		this.left -= dtMs;
		this.phase = this.kind;
		if (this.kind === 'pause' || this.kind === 'skip') return 0;
		const on = ph < this.n('duty');
		return on ? (this.kind === 'accent' ? 1 : this.n('level')) : 0;
	}
}

/** One shaped preset in wander's pool: [id, label, vib, estim]. */
export type PoolItem = [string, string, number[], number[]];
export type PoolFn = (family: string) => PoolItem[];

/** A Markov walk across the shaped presets: dwell 15–90 s each, 1.5 s crossfades, never the same twice. */
export class WanderGen implements Program {
	static readonly SCHEMA: Param[] = [
		choice('family', 'Draw from', ['all', 'vibration', 'combined'], 'all'),
		num('dwell_min_s', 'Shortest stay', 10.0, 120.0, 20.0, { step: 5, unit: 's' }),
		num('dwell_max_s', 'Longest stay', 15.0, 300.0, 60.0, { step: 5, unit: 's' })
	];
	static readonly FADE_MS = 1500;
	phase = '';
	readonly done = false;
	private readonly p: Params;
	private readonly rng: Rng;
	private readonly pool: PoolItem[];
	private cur: [PoolItem, LaneProgram] | null = null;
	private prev: [PoolItem, LaneProgram] | null = null;
	private left = 0;
	private fade = 0;

	constructor(params: Params, rng: Rng, lanes: PoolFn) {
		this.p = params;
		this.rng = rng;
		this.pool = lanes(params.family as string);
		this.pick();
	}

	private pick(): void {
		const cur = this.cur;
		const others = this.pool.filter((x) => cur === null || x[0] !== cur[0][0]);
		const item = this.rng.choice(others.length ? others : this.pool);
		this.prev = this.cur;
		this.cur = [item, new LaneProgram(item[2], item[3])];
		const a = this.p.dwell_min_s as number;
		const b = this.p.dwell_max_s as number;
		const [lo, hi] = b < a ? [b, a] : [a, b];
		this.left = this.rng.uniform(lo, hi) * 1000;
		this.fade = this.prev ? WanderGen.FADE_MS : 0;
	}

	sample(dtMs: number): Pair {
		if (this.left <= 0) this.pick();
		this.left -= dtMs;
		const cur = this.cur as [PoolItem, LaneProgram];
		let [v, e] = cur[1].sample(dtMs);
		if (this.fade > 0 && this.prev) {
			const f = 1 - this.fade / WanderGen.FADE_MS;
			const [pv, pe] = this.prev[1].sample(dtMs);
			v = pv + (v - pv) * f;
			e = pe + (e - pe) * f;
			this.fade -= dtMs;
		}
		this.phase = `${cur[0][1]} · ${pyFixed(pmax(0, this.left) / 1000, 0)} s`;
		return [q(v), q(e)];
	}
}

type EdgeStage = 'build' | 'hover' | 'pause';

/** Build → hover near the top → full pause; random build and pause lengths; the peak creeps up each cycle. */
export class EdgeGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('build_min_s', 'Build from', 10.0, 120.0, 20.0, { step: 5, unit: 's' }),
		num('build_max_s', 'Build to', 15.0, 180.0, 45.0, { step: 5, unit: 's' }),
		num('pause_min_s', 'Pause from', 3.0, 60.0, 8.0, { step: 1, unit: 's' }),
		num('pause_max_s', 'Pause to', 5.0, 90.0, 20.0, { step: 1, unit: 's' }),
		num('peak', 'First peak', 0.5, 1.0, 0.8),
		num('creep', 'Peak rise per cycle', 0.0, 0.1, 0.05, { step: 0.01 }),
		...ESTIM_PARAMS()
	];
	cycle = 0;
	stage: EdgeStage = 'build';
	private at = 0;
	private len = 0;

	constructor(params: Params, rng: Rng) {
		super(params, rng);
		this.begin('build');
	}

	private span(loKey: string, hiKey: string): number {
		const a = this.n(loKey);
		const b = this.n(hiKey);
		const [lo, hi] = b < a ? [b, a] : [a, b];
		return this.rng.uniform(lo, hi) * 1000;
	}

	private begin(stage: EdgeStage): void {
		this.stage = stage;
		this.at = 0;
		this.len =
			stage === 'build'
				? this.span('build_min_s', 'build_max_s')
				: stage === 'hover'
					? this.rng.uniform(5000, 10000)
					: this.span('pause_min_s', 'pause_max_s');
	}

	protected vib(dtMs: number): number {
		if (this.at >= this.len) {
			const next: EdgeStage = this.stage === 'build' ? 'hover' : this.stage === 'hover' ? 'pause' : 'build';
			if (next === 'build') this.cycle += 1;
			this.begin(next);
		}
		const peak = pmin(1, this.n('peak') + this.cycle * this.n('creep'));
		const f = this.at / this.len;
		this.at += dtMs;
		this.phase = `${this.stage} ${pyFixed(pmax(0, this.len - this.at) / 1000, 0)} s · cycle ${this.cycle + 1}`;
		if (this.stage === 'build') {
			const base = 0.25 + (peak - 0.25) * f * f * (3 - 2 * f);
			return base * (0.9 + 0.1 * Math.sin((2 * Math.PI * this.tMs) / 500)); // shallow 2 Hz texture
		}
		if (this.stage === 'hover') return peak * (0.9 + 0.1 * Math.sin((2 * Math.PI * this.tMs) / 2000));
		return 0;
	}
}

/** One session: warm-up 10 % → build 35 % → plateau 25 % → peaks 20 % → cool-down 10 %, then it ends. */
export class ArcGen extends Generator {
	static readonly SCHEMA: Param[] = [
		num('length_min', 'Length', 5.0, 30.0, 12.0, { step: 1, unit: 'min' }),
		num('peak', 'Peak', 0.6, 1.0, 0.95),
		...ESTIM_PARAMS()
	];
	static readonly STAGES: readonly [string, number][] = [
		['warm-up', 0.1],
		['build', 0.35],
		['plateau', 0.25],
		['peaks', 0.2],
		['cool-down', 0.1]
	];
	private readonly total: number;
	private w = 0; // centred OU wobble, ±0.15

	constructor(params: Params, rng: Rng) {
		super(params, rng);
		this.total = (params.length_min as number) * 60000;
	}

	protected vib(dtMs: number): number {
		const t = this.tMs;
		if (t >= this.total) {
			this.done = true;
			this.phase = 'finished';
			return 0;
		}
		const pk = this.n('peak');
		let start = 0;
		let name = '';
		let f = 1;
		for (const [stage, share] of ArcGen.STAGES) {
			name = stage; // as Python's loop variable: the last stage if none matched
			const end = start + share * this.total;
			if (t < end) {
				f = (t - start) / (end - start);
				break;
			}
			start = end;
		}
		const dt = dtMs / 1000;
		const tau = 4.0;
		this.w += (-this.w * dt) / tau + 0.06 * Math.sqrt((2 * dt) / tau) * this.rng.gauss(0, 1);
		this.w = pmin(0.15, pmax(-0.15, this.w));
		const wobble = this.w;
		this.phase = `${name} · ${pyFixed((this.total - t) / 60000, 1)} min left`;
		if (name === 'warm-up') return 0.2 + 0.2 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 6000)) + 0.1 * f;
		if (name === 'build') return pmin(1, 0.4 + (0.8 * pk - 0.4) * f + wobble);
		if (name === 'plateau') return pmin(1, 0.8 * pk + wobble);
		if (name === 'peaks') {
			const cyc = (t - start) % 13000; // 10 s surge to the peak, 3 s pause
			return cyc >= 10000 ? 0 : 0.5 + (pk - 0.5) * (cyc / 10000) ** 2;
		}
		return pmax(0.15, 0.8 * pk * (1 - f));
	}
}

export type GeneratorName = 'shape' | 'euclid' | 'drift' | 'pink' | 'surprise' | 'wander' | 'edge' | 'arc';

type GenClass = { SCHEMA: Param[] } & (
	(new (params: Params, rng: Rng) => Program) | (new (params: Params, rng: Rng, lanes: PoolFn) => Program)
);

export const GENERATORS: Record<GeneratorName, GenClass> = {
	shape: ShapeGen,
	euclid: EuclidGen,
	drift: DriftGen,
	pink: PinkGen,
	surprise: SurpriseGen,
	wander: WanderGen,
	edge: EdgeGen,
	arc: ArcGen
};
