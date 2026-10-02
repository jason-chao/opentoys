import { describe, expect, it } from 'vitest';
import { areaPath, downsample, hasSignal, linePath, timeTicks } from './waveform';

describe('waveform paths', () => {
	it('draws values left to right with 1 at the top', () => {
		expect(linePath([0, 1], 100, 10, 0)).toBe('M0 10L100 0');
		expect(linePath([0.5, 0.5, 0.5], 10, 10, 1)).toBe('M0 5L5 5L10 5');
	});

	it('clamps values to 0..1 and spans a single value across the width', () => {
		expect(linePath([2, -1], 10, 10, 0)).toBe('M0 0L10 10');
		expect(linePath([1], 10, 10, 0)).toBe('M0 0L10 0');
		expect(linePath([], 10, 10)).toBe('');
	});

	it('closes an area down to the baseline', () => {
		expect(areaPath([1, 1], 10, 10, 0)).toBe('M0 0L10 0L10 10L0 10Z');
		expect(areaPath([], 10, 10)).toBe('');
	});

	it('picks a few round time marks, 0 included', () => {
		expect(timeTicks(4)).toEqual([0, 1, 2, 3, 4]);
		expect(timeTicks(60)).toEqual([0, 15, 30, 45, 60]);
		expect(timeTicks(6.4)).toEqual([0, 2, 4, 6]);
		expect(timeTicks(0)).toEqual([0]);
		for (const s of [0.4, 3, 11, 50, 110, 180, 720]) expect(timeTicks(s).length).toBeLessThanOrEqual(6);
	});

	it('downsamples long lanes and knows an empty channel', () => {
		expect(
			downsample(
				Array.from({ length: 1000 }, (_, i) => i),
				100
			)
		).toHaveLength(100);
		expect(downsample([1, 2, 3], 100)).toEqual([1, 2, 3]);
		expect(hasSignal([0, 0])).toBe(false);
		expect(hasSignal([0, 0.01])).toBe(true);
	});
});
