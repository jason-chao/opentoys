import { describe, expect, it } from 'vitest';
import { Trace } from './trace';

describe('Trace (what was sent over the last seconds)', () => {
	it('returns nothing before anything was sent', () => {
		expect(new Trace().window(5000)).toEqual([]);
	});

	it('holds the current level up to now', () => {
		const t = new Trace(10_000);
		t.push(1000, 0.4, 0);
		expect(t.window(3000)).toEqual([
			{ t: 1000, vib: 0.4, estim: 0 },
			{ t: 3000, vib: 0.4, estim: 0 }
		]);
	});

	it('drops what is older than the window, but keeps the level at its left edge', () => {
		const t = new Trace(10_000);
		for (let ms = 0; ms <= 30_000; ms += 50) t.push(ms, ms / 30_000, 0.5);
		const w = t.window(30_000);
		expect(w[0].t).toBe(20_000);
		expect(w[0].vib).toBeCloseTo(20_000 / 30_000, 5);
		expect(w[w.length - 1]).toEqual({ t: 30_000, vib: 1, estim: 0.5 });
		expect(w.every((s, i) => i === 0 || s.t >= w[i - 1].t)).toBe(true);
		// One sample per 50 ms tick over 10 s, and the buffer itself stays that small.
		expect(w.length).toBe(201);
		expect(t.length).toBeLessThanOrEqual(202);
	});

	it('draws the level from before the window at the left edge', () => {
		const t = new Trace(10_000);
		t.push(0, 0.8, 0.1);
		t.push(15_000, 0.2, 0);
		expect(t.window(20_000)).toEqual([
			{ t: 10_000, vib: 0.8, estim: 0.1 },
			{ t: 15_000, vib: 0.2, estim: 0 },
			{ t: 20_000, vib: 0.2, estim: 0 }
		]);
	});

	it('merges samples that come too close together and ignores a clock going backwards', () => {
		const t = new Trace(10_000, 20);
		t.push(100, 0.1, 0);
		t.push(105, 0.9, 0.3);
		t.push(50, 0.5, 0.5);
		expect(t.length).toBe(1);
		expect(t.window(100)).toEqual([{ t: 100, vib: 0.9, estim: 0.3 }]);
	});

	it('can be cleared', () => {
		const t = new Trace();
		t.push(1, 1, 1);
		t.clear();
		expect(t.window(2)).toEqual([]);
	});
});
