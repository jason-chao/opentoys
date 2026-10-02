import { describe, expect, it } from 'vitest';
import { Rng, randomSeed } from '../src/rng.ts';
import { sha256Hex } from '../src/sha256.ts';
import { diff, fixture } from './helpers.ts';

const F = fixture('rng');

describe('portable RNG', () => {
	it('matches the reference mulberry32 (the values the reference implementation tests too)', () => {
		const r = new Rng(1);
		expect([r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([
			2693262067, 11749833, 2265367787, 4213581821
		]);
		const r42 = new Rng(42);
		expect([r42.nextU32(), r42.nextU32(), r42.nextU32(), r42.nextU32()]).toEqual([
			2581720956, 1925393290, 3661312704, 2876485805
		]);
		expect(new Rng(-1).state).toBe(0xffffffff);
		expect(new Rng(2 ** 32 + 5).state).toBe(5);
	});

	it('defines random, gauss, uniform and choice exactly', () => {
		const r = new Rng(1);
		expect(r.random()).toBe(0.6270739405881613);
		expect(r.gauss(0, 1)).toBeCloseTo(-0.07292188865544223, 12); // log and cos: libm may differ in the last ulp
		expect(r.uniform(2, 5)).toBe(2 + 3 * (4213581821 / 2 ** 32));
		expect(new Rng(1).choice([...'abcdefg'])).toBe('e');
		expect(() => new Rng(1).choice([])).toThrow();
		expect(() => new Rng(1.5)).toThrow();
	});

	// Integer draws are exact. gauss() goes through log and cos, which come from different libm implementations
	// (V8's fdlibm port vs glibc): they may differ in the last ulp, so raw gauss values are compared to 1e-12.
	for (const c of F.cases) {
		it(`reproduces the reference implementation's sequences for seed ${c.seed}`, () => {
			let r = new Rng(c.seed);
			expect(Array.from({ length: 8 }, () => r.nextU32())).toEqual(c.u32);
			r = new Rng(c.seed);
			expect(Array.from({ length: 16 }, () => r.random())).toEqual(c.random);
			r = new Rng(c.seed);
			expect(
				diff(
					Array.from({ length: 16 }, () => r.gauss(0, 1)),
					c.gauss,
					1e-12
				)
			).toBeNull();
			r = new Rng(c.seed);
			expect(
				diff(
					Array.from({ length: 8 }, () => r.gauss(0.5, 0.2)),
					c.gauss_05_02,
					1e-12
				)
			).toBeNull();
			r = new Rng(c.seed);
			expect(Array.from({ length: 8 }, () => r.uniform(2000, 5000))).toEqual(c.uniform_2000_5000);
			r = new Rng(c.seed);
			for (const [n, picks] of c.choice) {
				const seq = Array.from({ length: n }, (_, i) => i);
				expect(Array.from({ length: 12 }, () => r.choice(seq))).toEqual(picks);
			}
			r = new Rng(c.seed);
			const mixed = Array.from({ length: 40 }, (_, i) =>
				i % 4 === 0
					? r.random()
					: i % 4 === 1
						? r.gauss(0, 1)
						: i % 4 === 2
							? r.uniform(5, 10)
							: r.choice([10, 20, 30, 40, 50])
			);
			expect(diff(mixed, c.mixed, 1e-12)).toBeNull();
		});
	}

	it('draws fresh seeds in 1..999999', () => {
		for (let i = 0; i < 200; i++) {
			const s = randomSeed();
			expect(Number.isInteger(s) && s >= 1 && s <= 999999).toBe(true);
		}
	});
});

describe('sha256', () => {
	it('matches known digests', () => {
		expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(sha256Hex('x'.repeat(1000) + '蕉')).toBe(
			'53fd6b1f7cc7e678d665986b107a7dfea2c86aac5de1b9fd26b1daf3c4742936'
		);
	});
});
