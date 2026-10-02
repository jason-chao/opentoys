import { describe, expect, it } from 'vitest';
import {
	EXPORT_FORMAT,
	FORMAT,
	ModeError,
	NAME_MAX,
	exportModes,
	fromVendor,
	importAny,
	normalize,
	type Mode
} from '../src/modes.ts';
import { attempt, camelize, diff, fixture } from './helpers.ts';

const F = fixture('modes');

const FNS: Record<string, (arg: unknown) => unknown> = {
	normalize,
	from_vendor: fromVendor,
	import_any: importAny,
	export: (arg) => exportModes(camelize(arg) as Mode[])
};

describe('conformance: modes', () => {
	it('keeps the the reference implementation format names', () => {
		expect([FORMAT, EXPORT_FORMAT, NAME_MAX]).toEqual([F.format, F.export_format, F.name_max]);
	});

	for (const c of F.cases) {
		it(`${c.fn} ${JSON.stringify(c.arg).slice(0, 80)}`, () => {
			const got = attempt(() => FNS[c.fn]?.(c.arg));
			if ('error' in c) {
				expect('error' in got).toBe(true);
				if (!c.type) expect((got as { error: string }).error).toBe(c.error);
			} else {
				const want = c.fn === 'export' ? c.ok : camelize(c.ok);
				expect(diff(got, { ok: want })).toBeNull();
			}
		});
	}
});

// ----- ported from the reference implementation's tests/test_modes.py --------------------------------------------------------------
describe('modes', () => {
	it('pads and clamps', () => {
		expect(normalize({ name: '  x  ', period_ms: 100, vib: [0.5, 2, -1], estim: [0.1] })).toEqual({
			name: 'x',
			periodMs: 100,
			vib: [0.5, 1, 0],
			estim: [0.1, 0, 0],
			durationS: 0.3
		});
	});

	it('follows the vendor period rule', () => {
		// 100 samples over 10 s → n div duration = 10 → 100 ms per sample
		const m = fromVendor({
			name: 'rec',
			duration: 10,
			wave: [Array(100).fill(0.2), Array(100).fill(0.4), Array(100).fill(0)],
			device: 'dragon_s1'
		});
		expect([m.periodMs, m.vib[0], m.estim[0], m.durationS]).toEqual([100, 0.2, 0.4, 10]);
		// 24 samples over 61 s (the bundled demo) is rejected rather than crashing
		expect(() => fromVendor({ duration: 61, wave: [Array(24).fill(0.1)] })).toThrow(ModeError);
		expect(() => fromVendor({ duration: 0, wave: [[0.1]] })).toThrow(ModeError);
	});

	it('round-trips through export and import', () => {
		const ours = normalize({ name: 'a', vib: [0.1, 0.2], estim: [0, 0.3] });
		expect(importAny(exportModes([ours]))).toEqual([ours]);
		expect(importAny([{ name: 'v', duration: 1, wave: [Array(10).fill(0.5)] }])[0]?.periodMs).toBe(100);
		expect(() => importAny({ format: EXPORT_FORMAT, modes: [] })).toThrow(ModeError);
		expect(() => normalize({ vib: 'abc' })).toThrow(ModeError);
	});

	it('limits a mode to 72000 samples', () => {
		expect(normalize({ vib: Array(72000).fill(0.1) }).vib).toHaveLength(72000);
		expect(() => normalize({ vib: Array(72001).fill(0.1) })).toThrow(/1\.\.72000/);
		expect(() => normalize({ vib: [0.1], estim: Array(72001).fill(0.2) })).toThrow(ModeError);
	});
});
