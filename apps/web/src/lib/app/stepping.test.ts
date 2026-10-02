import { describe, expect, it } from 'vitest';
import { stepValue } from './stepping';

describe('stepping a value with − and +', () => {
	it('the Coyote: 0–200 in steps of 1, never past either end', () => {
		expect(stepValue(0, 1, 1, 0, 200)).toBe(1);
		expect(stepValue(22, -1, 1, 0, 200)).toBe(21);
		expect(stepValue(0, -1, 1, 0, 200)).toBe(0);
		expect(stepValue(30, 1, 1, 0, 30)).toBe(30);
		expect(stepValue(29, 5, 1, 0, 30)).toBe(30);
	});

	it('the ring: percentages in steps of 5, without drifting off the grid', () => {
		let v = 0;
		const seen: number[] = [];
		for (let i = 0; i < 20; i++) seen.push((v = stepValue(v, 1, 0.05, 0, 1)));
		expect(seen.slice(0, 4)).toEqual([0.05, 0.1, 0.15, 0.2]);
		expect(seen.at(-1)).toBe(1);
		expect(stepValue(1, 1, 0.05, 0, 1)).toBe(1);
		for (let i = 0; i < 20; i++) v = stepValue(v, -1, 0.05, 0, 1);
		expect(v).toBe(0);
		expect(stepValue(0.8, -1, 0.05, 0, 1)).toBe(0.75);
	});

	it('from between two steps it goes to the next one in that direction, not a whole step past it', () => {
		expect(stepValue(0.82, 1, 0.05, 0, 1)).toBe(0.85);
		expect(stepValue(0.82, -1, 0.05, 0, 1)).toBe(0.8);
		expect(stepValue(0.82, 2, 0.05, 0, 1)).toBe(0.9);
	});

	it('a maximum off the grid can still be reached, and left again', () => {
		expect(stepValue(0.75, 1, 0.05, 0, 0.78)).toBe(0.78);
		expect(stepValue(0.78, 1, 0.05, 0, 0.78)).toBe(0.78);
		expect(stepValue(0.78, -1, 0.05, 0, 0.78)).toBe(0.75);
	});

	it('junk changes nothing', () => {
		expect(stepValue(5, 0, 1, 0, 10)).toBe(5);
		expect(stepValue(5, Number.NaN, 1, 0, 10)).toBe(5);
		expect(stepValue(Number.NaN, 1, 1, 0, 10)).toBe(0);
		expect(stepValue(50, 1, 0, 0, 10)).toBe(10);
	});
});
