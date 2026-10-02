import { describe, expect, it } from 'vitest';
import {
	BY_ID,
	CATEGORIES,
	IDS,
	PRESETS,
	VERSION,
	catalogue,
	euclid,
	makeProgram,
	maxRisePctS,
	preview,
	renderChannel,
	renderSegments,
	RenderError,
	type FollowSpec,
	type PresetDef
} from '../src/presets/index.ts';
import { attempt, camelize, diff, fixture } from './helpers.ts';

const F = fixture('presets');
const DT = 50;

// Lanes are rendered once and rounded to 4 decimals; sine and exp ramps go through cos/exp from different libm
// implementations, but a last-ulp difference could only change a rounded value on an exact 5-tie, so lanes,
// thumbnails and previews are compared exactly.
describe('conformance: catalogue and lanes', () => {
	it('has the same presets, in the same order, and no vendor originals', () => {
		expect(IDS).toEqual(F.ids);
		expect([...CATEGORIES]).toEqual(F.categories);
		for (const id of ['comfort', 'normal', 'powerful']) expect(BY_ID.has(id)).toBe(false);
		expect(PRESETS.filter((d) => d.generator === null)).toHaveLength(28);
		expect(PRESETS.filter((d) => d.generator !== null)).toHaveLength(8);
	});

	it('renders every lane exactly as the reference implementation does', () => {
		for (const d of PRESETS.filter((x) => x.generator === null)) {
			expect(diff({ vib: d.vib, estim: d.estim }, F.lanes[d.id]), d.id).toBeNull();
		}
	});

	it('has the same catalogue, thumbnails included', () => {
		expect(diff(catalogue(true), camelize(F.catalogue))).toBeNull();
	});

	it('has the same catalogue version', () => {
		expect(VERSION).toBe(F.version);
	});

	it('renders the envelope cases alike, errors included', () => {
		for (const c of F.render) {
			const got = attempt(() => renderSegments(c.segments));
			if ('ok' in c) expect(diff(got, { ok: c.ok }), JSON.stringify(c.segments)).toBeNull();
			else expect('error' in got, JSON.stringify(c.segments)).toBe(true);
		}
		for (const c of F.follow) {
			const got = attempt(() => renderChannel(c.spec as FollowSpec, c.vib));
			if ('ok' in c) expect(diff(got, { ok: c.ok }), JSON.stringify(c.spec)).toBeNull();
			else expect('error' in got).toBe(true);
		}
		for (const [lane, want] of F.max_rise_pct_s) expect(maxRisePctS(lane)).toBe(want);
		for (const [k, n, want] of F.euclid) {
			const got = attempt(() => euclid(k, n));
			if ('ok' in want) expect(got).toEqual(want);
			else expect('error' in got).toBe(true);
		}
	});

	it('previews alike', () => {
		for (const { args, out } of F.preview) {
			const [id, seconds, seed, params, points] = args;
			expect(diff(preview(id, seconds, seed, params, points), camelize(out)), id).toBeNull();
		}
	});
});

// ----- ported from the reference implementation's tests/test_presets.py ------------------------------------------------------------
describe('renderer', () => {
	it('renders segments to 50 ms lanes', () => {
		expect(
			renderSegments([
				['hold', 0.5, 200],
				['rest', 100]
			])
		).toEqual([0.5, 0.5, 0.5, 0.5, 0, 0]);
		expect(renderSegments([['ramp', 0, 1, 200]])).toEqual([0.25, 0.5, 0.75, 1.0]);
		expect(renderSegments([['pulse', 1, 100, 100, 2, 0.3]])).toEqual([1, 1, 0.3, 0.3, 1, 1, 0.3, 0.3]);
		expect(
			renderSegments([
				[
					'repeat',
					2,
					[
						['hold', 1, 50],
						['rest', 50]
					]
				]
			])
		).toEqual([1, 0, 1, 0]);
		expect(renderSegments([['steps', 0.4, 1.25, 50, 4]])).toEqual([0.4, 0.5, 0.625, 0.7812]);
		const s = renderSegments([['sine', 0.0, 1.0, 1000, 1, 0.4]]);
		expect(s).toHaveLength(20);
		expect(s[0]).toBe(0);
		expect(Math.max(...s)).toBeCloseTo(1.0, 2);
		expect(s.indexOf(Math.max(...s))).toBe(8); // rise 40 %
		expect(euclid(5, 8).filter((x) => x === 1)).toHaveLength(5);
		expect(euclid(5, 8)[0]).toBe(1);
		expect(() => renderSegments([['hold', 1, 10]])).toThrow(RenderError); // shorter than a tick
		expect(() => renderSegments([['zigzag', 1]])).toThrow(RenderError);
	});

	it('smooths and lags a follow channel', () => {
		const vib = [...Array(10).fill(0), ...Array(10).fill(1)];
		const e = renderChannel({ follow: 'vib', scale: 0.5, smooth_ms: 500, lag_ms: 100 }, vib);
		expect(Math.max(...e)).toBeLessThanOrEqual(0.5);
		expect(Math.max(...e.slice(1).map((b, i) => b - (e[i] as number)))).toBeLessThan(0.1); // no jump
		expect(renderChannel({ follow: 'vib', invert: true }, vib)).toEqual([
			...Array(10).fill(1),
			...Array(10).fill(0)
		]);
	});
});

// ----- the design lint over every built-in preset (vibration on/off >= 100 ms; slow, ramped e-stim) --
/** Circular runs of zero / non-zero: [isOn, length][]. */
export function runs(lane: readonly number[]): [boolean, number][] {
	if (lane.every((v) => v > 0) || lane.every((v) => v === 0)) return [];
	const n = lane.length;
	let start = 0;
	while ((lane[start] as number) > 0 === (lane[(start - 1 + n) % n] as number) > 0) start += 1;
	const rot = [...lane.slice(start), ...lane.slice(0, start)];
	const out: [boolean, number][] = [];
	let cur = (rot[0] as number) > 0;
	let len = 0;
	for (const v of rot) {
		if (v > 0 === cur) len += 1;
		else {
			out.push([cur, len]);
			cur = v > 0;
			len = 1;
		}
	}
	out.push([cur, len]);
	return out;
}

/** E-stim rises at most 0.1 of the range per tick, and at most 0.05 above half; falls may be instant. */
export function estimRisesOk(lane: readonly number[], skipFirst = false): boolean {
	for (let i = skipFirst ? 1 : 0; i < lane.length; i++) {
		const a = lane[(i - 1 + lane.length) % lane.length] as number;
		const b = lane[i] as number;
		const rise = b - a;
		if (!(rise <= 0.1 + 1e-9 && (b <= 0.5 || rise <= 0.05 + 1e-9))) return false;
	}
	return true;
}

describe('design lint', () => {
	const shaped = PRESETS.filter((d) => d.generator === null);
	it.each(shaped.map((d) => [d.id, d] as [string, PresetDef]))('%s follows the design rules', (id, d) => {
		expect(d.vib.length).toBeGreaterThan(0);
		expect([...d.vib, ...d.estim].every((v) => v >= 0 && v <= 1)).toBe(true);
		for (const [on, n] of runs(d.vib))
			expect(
				n,
				`${id}: a full-depth vibration ${on ? 'on' : 'off'} period shorter than 100 ms`
			).toBeGreaterThanOrEqual(2);
		if (d.category === 'vibration') expect(d.estim).toHaveLength(0);
		else {
			expect(
				d.estim.some((e) => e > 0),
				`${id} has no e-stim`
			).toBe(true);
			// the reference implementation appends the first value and checks from index 0 (lane[-1] → lane[0]): the loop's wrap
			expect(estimRisesOk([...d.estim, d.estim[0] as number]), `${id}: e-stim rises too fast`).toBe(true);
		}
		expect(d.description && d.label).toBeTruthy();
	});

	const gens = PRESETS.filter((d) => d.generator !== null);
	it.each(gens.flatMap((d) => [1, 2, 3].map((seed) => [d.id, seed, d] as [string, number, PresetDef])))(
		'%s (seed %i) stays in bounds, with smooth e-stim',
		(id, seed, d) => {
			const { program, seed: used } = makeProgram(d, null, seed);
			const vib: number[] = [];
			const estim: number[] = [];
			for (let i = 0; i < 300_000 / DT; i++) {
				const [v, e] = program.sample(DT);
				vib.push(v);
				estim.push(e);
				if (program.done) break;
			}
			expect(used).toBe(seed);
			expect([...vib, ...estim].every((x) => x >= 0 && x <= 1)).toBe(true);
			expect(vib.some((v) => v > 0)).toBe(true);
			expect(estimRisesOk(estim, true), `${id}: e-stim jumps`).toBe(true);
			if (!['drift', 'pink', 'wander'].includes(d.generator as string)) {
				const groups: number[] = [];
				vib.forEach((v, i) => {
					if (i === 0 || v > 0 !== (vib[i - 1] as number) > 0) groups.push(1);
					else groups[groups.length - 1] = (groups[groups.length - 1] as number) + 1;
				});
				const inner = groups.slice(1, -1); // not the cut ends
				expect(
					inner.every((n) => n >= 2),
					`${id}: full-depth on/off shorter than 100 ms`
				).toBe(true);
			}
		}
	);
});

describe('generators', () => {
	it('reproduce with a seed and differ with another', () => {
		const a = preview('gen-edge', 120, 11).vib;
		expect(preview('gen-edge', 120, 11).vib).toEqual(a);
		expect(preview('gen-edge', 120, 12).vib).not.toEqual(a);
		expect(preview('gen-shape', 30, 1).vib).toEqual(preview('gen-shape', 30, 99).vib); // a repeating shape
	});

	it('validate their parameters', () => {
		const d = BY_ID.get('gen-drift') as PresetDef;
		const { params } = makeProgram(d, { mean: 5, tau_s: '3' }, 1);
		expect(params.mean).toBe(1);
		expect(params.tau_s).toBe(3);
		expect(params.estim_mode).toBe('follow');
		for (const bad of [{ nope: 1 }, { estim_mode: 'zap' }, { mean: 'x' }])
			expect(() => makeProgram(d, bad, 1)).toThrow();
		expect(() => makeProgram(BY_ID.get('wave') as PresetDef, { mean: 1 }, 1)).toThrow();
	});

	it('have a catalogue and a version', () => {
		const c = catalogue();
		expect(c).toHaveLength(PRESETS.length);
		expect(c.length).toBeGreaterThanOrEqual(36);
		expect(VERSION).toMatch(/^[0-9a-f]{10}$/);
		expect(new Set(c.map((x) => x.category))).toEqual(new Set(CATEGORIES));
		const heart = c.find((x) => x.id === 'heart-accent');
		expect(heart?.estimRisePctS).toBe(maxRisePctS((BY_ID.get('heart-accent') as PresetDef).estim));
	});
});
