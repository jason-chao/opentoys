import { describe, expect, it } from 'vitest';
import {
	pmax,
	pmin,
	pyFixed,
	pyFloat,
	pyFloorDiv,
	pyFormatG,
	pyInt,
	pyMod,
	pyRound,
	trailingZeros
} from '../src/py.ts';

// Expected values are what CPython 3.10 prints for the same expressions.
describe('Python semantics', () => {
	it('round() is correctly rounded with exact ties to even', () => {
		expect([0.5, 1.5, 2.5, -0.5, -1.5, 0.49999999999999994, 3.7].map((x) => pyRound(x))).toEqual([
			0, 2, 2, -0, -2, 0, 4
		]);
		expect(pyRound(0.78125, 4)).toBe(0.7812); // an exact binary tie
		expect(pyRound(0.03125, 4)).toBe(0.0312);
		expect(pyRound(0.00015, 4)).toBe(0.0001); // 0.00015 is just below the tie in binary
		expect(pyRound(2.675, 2)).toBe(2.67);
		expect(pyRound(0.125, 2)).toBe(0.12);
		expect(pyRound(0.375, 2)).toBe(0.38);
		expect(pyRound(-0.25, 1)).toBe(-0.2);
		expect(pyRound(1.23456789, 4)).toBe(1.2346);
		expect(pyRound(0.1 + 0.2, 1)).toBe(0.3);
	});

	it('formats like format(x, ".nf") and format(x, "g")', () => {
		expect([pyFixed(2.5, 0), pyFixed(3.5, 0), pyFixed(0.25, 1), pyFixed(12.3456, 1)]).toEqual([
			'2',
			'4',
			'0.2',
			'12.3'
		]);
		expect([4, 0.35, 0.3, 1.1000000000000003, 110, 0.85, 20, 1234567, 0.00001234].map(pyFormatG)).toEqual([
			'4',
			'0.35',
			'0.3',
			'1.1',
			'110',
			'0.85',
			'20',
			'1.23457e+06',
			'1.234e-05'
		]);
	});

	it('floor division and modulo follow the divisor', () => {
		expect([pyMod(-5, 1_000_000), pyMod(7, 3), pyMod(-1, 5), pyMod(5.5, 2)]).toEqual([999995, 1, 4, 1.5]);
		expect([pyFloorDiv(150, 50), pyFloorDiv(149.99, 50), pyFloorDiv(-1, 50), pyFloorDiv(0.3, 0.1)]).toEqual([
			3, 2, -1, 2
		]);
	});

	it('min/max keep Python behaviour with NaN', () => {
		expect(pmax(0, NaN)).toBe(0);
		expect(pmin(1, NaN)).toBe(1);
		expect(pmax(NaN, 0)).toBeNaN();
	});

	it('float() and int() accept what Python accepts', () => {
		expect([pyFloat(' 0.25 '), pyFloat('1e-1'), pyFloat('1_0'), pyFloat(true), pyFloat('-inf')]).toEqual([
			0.25,
			0.1,
			10,
			1,
			-Infinity
		]);
		expect(pyFloat('NaN')).toBeNaN();
		for (const bad of ['x', '', '0x10', '1__0', null, [], {}]) expect(() => pyFloat(bad)).toThrow();
		expect([pyInt('250'), pyInt(99.9), pyInt(-3.7), pyInt(' +7 '), pyInt(false)]).toEqual([
			250, 99, -3, 7, 0
		]);
		for (const bad of ['1.5e2', 'fast', null, NaN]) expect(() => pyInt(bad)).toThrow();
	});

	it('counts trailing zero bits', () => {
		expect([1, 2, 3, 4, 8, 12, 1024, 2 ** 40].map(trailingZeros)).toEqual([0, 1, 0, 2, 3, 2, 10, 40]);
	});
});
