import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CAPS,
	HardCaps,
	Limits,
	Manual,
	Preset,
	Recorder,
	REFERENCE_CAPS,
	Session,
	level,
	type Out
} from '../src/index.ts';
import { BY_ID, type PresetDef } from '../src/presets/index.ts';
import { attempt, camel, camelize, diff, fixture, type Json } from './helpers.ts';

const F = fixture('engine');
const DT = 50;

function run(s: Session, ms: number): Out {
	let out = s.tick(DT);
	for (let i = 1; i < Math.floor(ms / DT); i++) out = s.tick(DT);
	return out;
}

const keys = (o: Json): Json => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [camel(k), v]));

/** the reference implementation's snapshot, as the port shapes it (camelCase; the preset's vendor "level" field is gone). */
function expectedSnapshot(snap: Json): Json {
	const out = camelize(snap);
	if (out.preset) delete out.preset.level;
	return out;
}

// The engine itself is plain IEEE arithmetic in the same order as the reference implementation, so every tick is compared exactly.
describe('conformance: engine traces', () => {
	for (const trace of F.traces) {
		it(trace.name, () => {
			const s = new Session(
				trace.limits === null ? null : keys(trace.limits),
				new HardCaps(...(trace.caps as [number, number]))
			);
			trace.steps.forEach((step: Json, n: number) => {
				const where = `${trace.name} step ${n} (${step.op})`;
				if (step.op === 'tick') {
					const outs = [...step.outs];
					for (let i = 0; i < step.n; i++) {
						const o = s.tick(step.dt);
						if (i % step.every === 0 || i === step.n - 1) {
							const want = outs.shift();
							const got = [i, o.source, o.wantVib, o.wantEstim, o.vib, o.estim, o.warm, o.stopped, o.live];
							const d = diff(got, want);
							if (d) expect(d, `${where} tick ${i}`).toBeNull();
						}
					}
					expect(outs, where).toHaveLength(0);
					return;
				}
				const got = attempt(() => {
					switch (step.op) {
						case 'manual':
							return s.setManual(step.vib, step.estim);
						case 'preset': {
							const opts = { ...step };
							delete opts.op;
							delete opts.id;
							return s.setPreset(step.id, keys(opts));
						}
						case 'play':
							return s.play(step.items, step.order, step.start_index, step.seed);
						case 'stop':
							return s.stop(step.reason);
						case 'suppress':
							return s.suppressEstim();
						case 'limits':
							return s.setLimits(keys(step.kw)).asDict();
						case 'rec_start':
							return s.recorder.start();
						case 'rec_take':
							return s.recorder.take();
						case 'snapshot':
							return s.snapshot();
					}
					throw new Error(`unknown op ${step.op}`);
				});
				if ('error' in step) {
					expect('error' in got, where).toBe(true);
					const msg = (got as { error: string }).error;
					if (step.error.startsWith('bad pattern:')) expect(msg.startsWith('bad pattern:'), where).toBe(true);
					else expect(msg, where).toBe(step.error);
				} else {
					expect('ok' in got, `${where}: ${JSON.stringify(got)}`).toBe(true);
					const value = (got as { ok: unknown }).ok;
					const want =
						step.op === 'snapshot'
							? expectedSnapshot(step.result)
							: step.result === undefined
								? undefined
								: camelize(step.result);
					expect(
						diff(value === undefined ? null : value, want === undefined ? null : want),
						where
					).toBeNull();
				}
			});
		});
	}

	it('bounds and updates limits alike', () => {
		for (const c of F.limits_bounded) {
			const got = new Limits(keys(c.kw)).bounded(new HardCaps(c.caps[0], c.caps[1])).asDict();
			expect(diff(got, camelize(c.bounded)), JSON.stringify(c.kw)).toBeNull();
		}
		const base = new Limits().bounded(DEFAULT_CAPS);
		for (const c of F.limits_update)
			expect(
				diff(base.update(DEFAULT_CAPS, keys(c.kw)).asDict(), camelize(c.out)),
				JSON.stringify(c.kw)
			).toBeNull();
		for (const [v, e, want] of F.caps_from_percent) {
			const caps = HardCaps.fromPercent(v, e);
			expect([caps.vib, caps.estim]).toEqual(want);
		}
	});

	it('records alike', () => {
		for (const c of F.recorder) {
			const r = new Recorder(c.period_ms, c.max_s);
			r.feed(1, 1, 500); // ignored before start
			r.start();
			for (const [v, e, dt] of c.feeds) r.feed(v, e, dt);
			expect(diff(r.snapshot(), camelize(c.snapshot))).toBeNull();
			expect(diff(r.take(), camelize(c.take))).toBeNull();
			expect(diff(r.snapshot(), camelize(c.after))).toBeNull();
		}
	});
});

// ----- ported from the reference implementation's tests/test_engine.py (and the engine parts of test_presets.py) ---------------------
/** A session without warm-up or ramp, to test sources in isolation. */
function free(kw: Partial<Record<string, number>> = {}): Session {
	return new Session({ maxVib: 1, maxEstim: 1, estimRampPctS: 100, warmupS: 0, ...kw }, new HardCaps(1, 1));
}

function mapped(kw: Partial<Record<string, number>> = {}): Session {
	return new Session(
		{ maxVib: 1, maxEstim: 0.6, estimRampPctS: 100, warmupS: 0, vibFloor: 0.1, estimFloor: 0.02, ...kw },
		new HardCaps(1, 0.8)
	);
}

describe('engine', () => {
	it('is silent when idle', () => {
		const out = new Session().tick(DT);
		expect([level(out.vib), level(out.estim), out.live, out.source]).toEqual([0, 0, false, 'none']);
	});

	it('has opentoys defaults: e-stim capped at 80 %, the reference implementation limits', () => {
		const s = new Session();
		expect([s.caps.vib, s.caps.estim]).toEqual([1, 0.8]);
		expect([REFERENCE_CAPS.vib, REFERENCE_CAPS.estim]).toEqual([1, 0.6]);
		expect(s.limits.values()).toEqual({
			maxVib: 1,
			maxEstim: 0.6,
			estimRampPctS: 25,
			warmupS: 3,
			sessionMaxS: 3600,
			vibFloor: 0.1,
			estimFloor: 0.02
		});
	});

	it('sends manual values as bytes; even the fastest e-stim ramp applies', () => {
		const s = free();
		s.setManual(0.5, 0.3);
		expect(s.tick(DT).estim).toBeCloseTo(0.05, 12);
		const out = run(s, 1000);
		expect([level(out.vib), level(out.estim)]).toEqual([127, 76]);
	});

	it('cannot raise the hard caps', () => {
		const s = new Session({ maxVib: 1, maxEstim: 1, warmupS: 0, estimRampPctS: 100 }, new HardCaps(1, 0.6));
		expect(s.limits.maxEstim).toBe(0.6);
		s.setLimits({ maxEstim: 0.95 });
		expect(s.limits.maxEstim).toBe(0.6);
		s.setManual(1, 1);
		const out = run(s, 3000);
		expect(out.estim).toBeCloseTo(0.6, 12);
		expect(level(out.estim)).toBe(level(0.6));
	});

	it('keeps to the comfort maximum', () => {
		const s = free({ maxVib: 0.4, maxEstim: 0.2 });
		s.setManual(0.9, 0.9);
		const out = run(s, 2000);
		expect([out.vib, out.estim]).toEqual([0.4, 0.2]);
	});

	it('limits e-stim rises; falls are immediate', () => {
		const s = free({ estimRampPctS: 25 });
		s.setManual(0, 0.5);
		const outs = Array.from({ length: 40 }, () => s.tick(DT)); // 2 s
		const rises = outs.slice(1).map((b, i) => b.estim - (outs[i] as Out).estim);
		expect(Math.max(...rises)).toBeLessThanOrEqual((0.25 * DT) / 1000 + 1e-9);
		expect(outs[39]?.estim).toBeCloseTo(0.5, 12); // 25 %/s reaches 50 % in 2 s
		s.setManual(0, 0.1);
		expect(s.tick(DT).estim).toBeCloseTo(0.1, 12);
	});

	it('warms up from every start', () => {
		const s = new Session({ maxVib: 1, maxEstim: 1, warmupS: 2, estimRampPctS: 100 }, new HardCaps(1, 1));
		s.setManual(1, 0);
		expect(s.tick(DT).vib).toBeCloseTo(DT / 2000, 12);
		expect(run(s, 2000).vib).toBeCloseTo(1, 12);
		s.stop('user');
		s.setManual(1, 0);
		expect(s.tick(DT).vib).toBeCloseTo(DT / 2000, 12); // after a stop it fades in again
	});

	it('stops at the session maximum', () => {
		const s = free({ sessionMaxS: 60 });
		s.setManual(0.2, 0);
		const out = run(s, 60_000);
		expect([out.stopped, out.live, s.source]).toEqual(['session_max', false, null]);
		expect(level(s.tick(DT).vib)).toBe(0);
		s.setManual(0.2, 0); // a new intent starts a new session
		expect(s.tick(DT).live).toBe(true);
		expect(s.stoppedReason).toBeNull();
	});

	it('plays a preset lane one sample per 50 ms, with boost and e-stim switch', () => {
		const s = free({ vibFloor: 0, estimFloor: 0 });
		s.setPreset('split-pulse', { intensity: { vib: 1, estim: 1 } });
		const lane = (BY_ID.get('split-pulse') as PresetDef).vib;
		const got = Array.from({ length: lane.length * 2 }, () => s.tick(DT).vib);
		expect(got).toEqual([...lane, ...lane]); // floor 0, intensity 1: the lane itself, looping
		expect(Math.max(...Array.from({ length: 40 }, () => s.tick(DT).estim))).toBe(0); // e-stim off
		s.setPreset('split-pulse', { intensity: { vib: 1, estim: 1 }, estimOn: true });
		expect(Math.max(...Array.from({ length: 40 }, () => s.tick(DT).estim))).toBeGreaterThan(0);
		s.setPreset('split-pulse', { boost: true, intensity: { vib: 0.5 } });
		expect(run(s, 500).vib).toBe(0.5); // boost: full top of the calibrated range
	});

	it('refuses unknown presets, the vendor originals among them', () => {
		for (const id of ['nope', 'comfort', 'normal', 'powerful'])
			expect(() => free().setPreset(id)).toThrow(/unknown preset/);
	});

	it('steps through patterns and loops', () => {
		const s = free();
		s.play([{ name: 'a', period_ms: 100, vib: [0.1, 0.2, 0.3], estim: [0, 0, 0.5] }], 'loop');
		const got = Array.from({ length: 12 }, () => Math.round(s.tick(DT).vib * 1000) / 1000);
		expect(got).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
		expect(s.snapshot().pattern?.plays).toBe(1);
	});

	it('plays in sequence and shuffles without repeating an item straight away', () => {
		const items = (...lens: number[]) =>
			lens.map((n, i) => ({
				name: `m${i}`,
				period_ms: 100,
				vib: Array(n).fill(0.1 * (i + 1)),
				estim: Array(n).fill(0)
			}));
		const s = free();
		s.play(items(2, 2, 2), 'sequence');
		const seen = Array.from({ length: 24 }, () => (s.tick(DT), s.snapshot().pattern?.index));
		expect(seen.slice(0, 4)).toEqual([0, 0, 0, 0]);
		expect(seen).toContain(1);
		expect(seen).toContain(2);
		s.play(items(1, 1, 1), 'shuffle');
		const idx = Array.from({ length: 40 }, () => (s.tick(DT), s.snapshot().pattern?.index));
		const odd = idx.filter((_, i) => i % 2 === 1);
		expect(odd.slice(1).every((b, i) => b !== odd[i])).toBe(true);
	});

	it('validates patterns', () => {
		const s = free();
		expect(() => s.play([], 'loop')).toThrow();
		expect(() => s.play([{ period_ms: 100, vib: [1] }], 'backwards')).toThrow();
		expect(() => s.play([{ period_ms: 5, vib: [1] }])).toThrow();
		expect(() => s.play([{ period_ms: 100, vib: [] }])).toThrow();
		expect(() => s.play([{ period_ms: 100, vib: Array(72001).fill(0.1) }])).toThrow(/1\.\.72000/);
	});

	it('records at 10 Hz, with a minimum length', () => {
		const s = free();
		s.setManual(0.5, 0);
		s.recorder.start();
		run(s, 5000);
		s.setManual(0, 0.25);
		run(s, 5000);
		const rec = s.recorder.take();
		expect([rec.periodMs, rec.vib.length, rec.longEnough]).toEqual([100, 100, true]);
		expect([rec.vib[0], rec.estim[99]]).toEqual([0.5, 0.25]); // wanted values, before limits
		s.recorder.start();
		run(s, 2000);
		expect(s.recorder.take().longEnough).toBe(false);
	});

	it('halts the recording on stop', () => {
		const s = free();
		s.setManual(0.5, 0);
		s.recorder.start();
		run(s, 1000);
		s.stop('estop');
		expect(s.recorder.active).toBe(false);
		expect(s.recorder.take().stoppedBy).toBe('estop');
	});

	it('bounds the limits', () => {
		const lim = new Limits({
			maxVib: 3,
			maxEstim: -1,
			estimRampPctS: 0,
			warmupS: 99,
			sessionMaxS: 5
		}).bounded(new HardCaps(0.8, 0.5));
		expect([lim.maxVib, lim.maxEstim, lim.estimRampPctS, lim.warmupS, lim.sessionMaxS]).toEqual([
			0.8, 0, 1, 30, 60
		]);
		const caps = HardCaps.fromPercent(100, 60);
		expect([caps.vib, caps.estim]).toEqual([1, 0.6]);
	});

	it('takes the safe end for NaN limits (the reference implementation would keep NaN and lose the rise limit)', () => {
		const lim = new Limits({ estimRampPctS: NaN, warmupS: NaN, sessionMaxS: NaN }).bounded(DEFAULT_CAPS);
		expect([lim.estimRampPctS, lim.warmupS, lim.sessionMaxS]).toEqual([1, 30, 60]);
	});

	it('maps presets between floor and top', () => {
		const s = mapped();
		s.setPreset('steady', { intensity: { vib: 1 } });
		expect(run(s, 200).vib).toBeCloseTo(1, 12);
		s.setPreset('steady', { intensity: { vib: 0.5 } });
		expect(run(s, 200).vib).toBeCloseTo(0.1 + 0.5 * 0.9, 12);
		s.setPreset('split-pulse', { intensity: { vib: 1, estim: 1 }, estimOn: true });
		const outs = Array.from({ length: 60 }, () => s.tick(DT));
		expect(Math.min(...outs.map((o) => o.vib))).toBe(0); // off stays off
		expect(Math.min(...outs.filter((o) => o.vib > 0).map((o) => o.vib))).toBeGreaterThanOrEqual(0.1); // on ≥ floor
		expect(Math.max(...outs.map((o) => o.estim))).toBeCloseTo(0.02 + 0.5 * 0.58, 12); // half the range
		s.setPreset('toggle', { intensity: { vib: 1, estim: 1 }, estimOn: true });
		const peak = Math.max(...Array.from({ length: 400 }, () => s.tick(DT).estim));
		expect(peak).toBeCloseTo(0.02 + 0.7 * 0.58, 3); // toggle peaks at 0.7 of the range
		s.setPreset('steady', { intensity: { vib: 1 }, estimOn: true });
		expect(run(s, 200).estim).toBe(0); // vibration-only presets never touch e-stim
	});

	it('intensifies slowly: at most 15 %, reset by another preset', () => {
		const s = mapped();
		s.setPreset('steady', { intensity: { vib: 0.5 }, intensify: true });
		const base = 0.1 + 0.5 * 0.9;
		const out = run(s, 600_000 + 1000);
		expect(Math.abs(out.vib / (base * 1.15) - 1)).toBeLessThan(1e-3);
		expect(s.creepPct).toBe(15);
		s.setPreset('steady', { intensity: { vib: 1 }, intensify: true });
		expect(run(s, 200).vib).toBeCloseTo(1, 12); // never above the comfort maximum
		s.setPreset('wave', { intensify: true }); // another preset starts from 0 too
		expect(s.creepPct).toBe(0);
	});

	it('ends the session arc by itself', () => {
		const s = mapped();
		s.setPreset('gen-arc', { params: { length_min: 5 }, seed: 3 });
		const out = run(s, 5 * 60_000 + 500);
		expect([s.source, s.stoppedReason, out.live]).toEqual([null, 'finished', false]);
	});

	it('mutes e-stim when the page is hidden; vibration carries on', () => {
		const s = mapped();
		s.setPreset('gen-drift', { estimOn: true, params: { estim_mode: 'steady', estim_level: 0.5 }, seed: 1 });
		expect(run(s, 1000).estim).toBeGreaterThan(0);
		expect(s.suppressEstim()).toBe(true);
		expect(run(s, 1200).estim).toBe(0);
		expect((s.source as Preset).estimOn).toBe(false);
		expect(s.tick(DT).vib).toBeGreaterThan(0);
		s.setManual(0.3, 0.4);
		expect(s.suppressEstim()).toBe(true);
		expect((s.source as Manual).estim).toBe(0);
	});

	it('restarts only generators on a new seed', () => {
		const s = mapped();
		s.setPreset('gen-pink', { seed: 5 });
		const first = (s.source as Preset).program;
		s.setPreset('gen-pink', { seed: 5, intensity: { vib: 0.3 } });
		expect((s.source as Preset).program).toBe(first); // same seed and params: keep going
		s.setPreset('gen-pink', { seed: 6 });
		expect((s.source as Preset).program).not.toBe(first);
		expect((s.source as Preset).seed).toBe(6);
	});
});
