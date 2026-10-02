import { describe, expect, it } from 'vitest';
import { PRESETS } from '@opentoys/core';
import {
	bucketMax,
	hasText,
	ITEMS,
	itemsIn,
	kindOf,
	lanesFor,
	isRandom,
	lengthText,
	paramLabel,
	presetName,
	THUMBS
} from './catalogue';

describe('the pattern catalogue as shown', () => {
	it('has a name and description for every built-in pattern', () => {
		for (const p of PRESETS) expect(hasText(p.id), p.id).toBe(true);
		expect(presetName('slow-pulse')).toBe('Slow pulse');
	});

	it('translates every generator parameter', () => {
		for (const p of PRESETS.flatMap((d) => d.schema)) expect(paramLabel(p), p.key).not.toBe('');
	});

	it('puts every vibration pattern under one of the filter kinds', () => {
		for (const item of itemsIn('vibration')) expect(kindOf(item.tags), item.id).not.toBeNull();
		expect(kindOf(['pulse', 'accent'])).toBe('pulses');
		expect(kindOf(['edging', '45 s'])).toBe('buildups');
		expect(kindOf(['constant'])).toBe('steady');
		expect(kindOf(['nothing'])).toBeNull();
	});

	it('splits into the three sections', () => {
		expect(itemsIn('vibration').length + itemsIn('combined').length + itemsIn('generated').length).toBe(
			ITEMS.length
		);
		expect(itemsIn('generated')).toHaveLength(8);
	});

	it('repeats short loops to at least 6 s and keeps each channel on its own loop', () => {
		const quick = lanesFor('quick-pulse', 1000);
		expect(quick.seconds).toBeGreaterThanOrEqual(6);
		expect(Math.max(...quick.vib)).toBe(1);
		expect(Math.min(...quick.vib)).toBe(0);
		const tingle = lanesFor('tingle-bed', 1000);
		expect(tingle.estim.some((v) => v > 0)).toBe(true);
		expect(lanesFor('build', 120).vib).toHaveLength(120);
		expect(lanesFor('nope').vib).toEqual([]);
	});

	it('shows an adjustable pattern as a 60 s example that follows its settings', () => {
		const a = lanesFor('gen-shape', 240, { shape: 'pulse', period_s: 1 }, 3);
		const b = lanesFor('gen-shape', 240, { shape: 'wave', period_s: 10 }, 3);
		expect(a.seconds).toBeCloseTo(60, 0);
		expect(a.vib).not.toEqual(b.vib);
	});

	it('keeps peaks when reducing points', () => {
		expect(bucketMax([0, 0, 1, 0, 0, 0], 2)).toEqual([1, 0]);
		expect(bucketMax([0.2, 0.4], 10)).toEqual([0.2, 0.4]);
	});

	it('has a thumbnail for every pattern', () => {
		for (const item of ITEMS) expect(THUMBS.get(item.id)?.vib.length, item.id).toBeGreaterThan(0);
	});

	it('says how long a pattern runs', () => {
		const byId = (id: string) => ITEMS.find((i) => i.id === id)!;
		expect(lengthText(byId('steady'))).toBe('Constant level');
		expect(lengthText(byId('slow-pulse'))).toMatch(/^Repeats every 2/);
		expect(lengthText(byId('gen-drift'))).toBe('No fixed cycle');
		expect(lengthText(byId('gen-arc'), { length_min: 20 })).toMatch(/^Ends after 20/);
		// Fixed cycles repeat exactly: shape by its period (a heartbeat at least 0.85 s), rhythm by its bar.
		expect(lengthText(byId('gen-shape'))).toMatch(/^Repeats every 4 sec/);
		expect(lengthText(byId('gen-shape'), { shape: 'heartbeat', period_s: 0.5 })).toMatch(
			/^Repeats every 0\.9 sec/
		); // 0.85 s, shown to one decimal;
		expect(lengthText(byId('gen-rhythm'), { n: 8, bpm: 120 })).toMatch(/^Repeats every 2 sec/);
		expect(lengthText(byId('gen-rhythm'), { n: 5, bpm: 120 })).toMatch(/^Repeats every 2\.5 sec/);
		expect(isRandom(byId('gen-shape'))).toBe(false);
		expect(isRandom(byId('gen-surprise'))).toBe(true);
	});
});
