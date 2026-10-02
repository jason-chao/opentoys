import { describe, expect, it } from 'vitest';
import { BY_ID, makeProgram, q, validate, type PresetDef } from '../src/presets/index.ts';
import { attempt, diff, fixture } from './helpers.ts';

const F = fixture('generators');
const def = (id: string) => BY_ID.get(id) as PresetDef;

// Generator output is quantised to 1 % (q), and the reference implementation writes it as integers k = value · 100: the port must give
// exactly k / 100. Drift and arc feed gauss() (log, cos) into a running state, so a last-ulp libm difference could
// in principle move a value across a rounding edge; the fixtures show it does not.
describe('conformance: generator sequences', () => {
	for (const run of F.runs) {
		const label = `${run.id} ${JSON.stringify(run.params)} seed ${run.seed} dt ${run.dts.join('/')}`;
		it(label, () => {
			const { program, params, seed } = makeProgram(def(run.id), run.params, run.seed);
			expect(diff(params, run.clean)).toBeNull();
			expect(seed).toBe(run.used_seed);
			let doneAt: number | null = null;
			const n = run.vib.length;
			for (let i = 0; i < n; i++) {
				const [v, e] = program.sample(run.dts[i % run.dts.length]);
				if (v !== run.vib[i] / 100 || e !== run.estim[i] / 100)
					expect([i, v, e], label).toEqual([i, run.vib[i] / 100, run.estim[i] / 100]);
				if (i % run.phase_every === 0)
					expect(program.phase, `${label} at ${i}`).toBe(run.phases[i / run.phase_every]);
				if (program.done) {
					doneAt = i;
					break;
				}
			}
			expect(doneAt).toBe(run.done_at);
		});
	}
});

describe('conformance: parameters, seeds, quantisation', () => {
	it('validates alike', () => {
		for (const c of F.validate) {
			const got = attempt(() => validate(def(c.id).schema, c.params));
			const want = 'ok' in c ? { ok: c.ok } : { error: c.error };
			expect(diff(got, want), `${c.id} ${JSON.stringify(c.params)}`).toBeNull();
		}
	});

	it('normalises seeds alike', () => {
		for (const c of F.seeds) expect(makeProgram(def('gen-drift'), null, c.seed).seed).toBe(c.ok);
		for (const c of F.lane_params) {
			const got = attempt(() => {
				const m = makeProgram(def(c.id), c.params, 1);
				return [m.params, m.seed];
			});
			expect(diff(got, 'ok' in c ? { ok: c.ok } : { error: c.error })).toBeNull();
		}
	});

	it('quantises alike', () => {
		for (const [x, want] of F.q) expect(q(x)).toBe(want);
	});
});
