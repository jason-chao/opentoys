import { describe, expect, it } from 'vitest';
import { importedSettings, sanitizeSettings } from '$lib/app/settings';
import { coyote } from '@opentoys/core';
import { m } from '$lib/paraglide/messages';
import {
	hasText,
	lanesOf,
	patternDescription,
	patternName,
	PATTERNS,
	pulsesPerSecond,
	RATE_DIRECTION,
	ratesOf
} from './catalogue';
import { DEFAULT_COYOTE, deviceCapsFor, lockedCoyote, maximaFor, sanitizeCoyote } from './settings';
import { lengthText } from './text';

describe("the Coyote's settings", () => {
	it('start not enabled, with no maximum on either channel', () => {
		expect(sanitizeCoyote(undefined)).toEqual(DEFAULT_COYOTE);
		expect(sanitizeCoyote('junk')).toEqual(DEFAULT_COYOTE);
		expect(DEFAULT_COYOTE).toMatchObject({ enabled: false, maxA: 0, maxB: 0, above100: false });
		expect(sanitizeSettings({}).coyote).toEqual(DEFAULT_COYOTE);
	});

	it('a maximum never goes above 100 without the confirmation, and never above 200', () => {
		expect(sanitizeCoyote({ maxA: 150, maxB: 100 })).toMatchObject({ maxA: 100, maxB: 100 });
		expect(sanitizeCoyote({ maxA: 150, above100: 'yes' }).maxA).toBe(100);
		expect(sanitizeCoyote({ maxA: 150, maxB: 500, above100: true })).toMatchObject({ maxA: 150, maxB: 200 });
		// Taking the confirmation back brings the maxima down again.
		expect(sanitizeCoyote({ maxA: 150, maxB: 60, above100: false })).toMatchObject({ maxA: 100, maxB: 60 });
	});

	it('keeps whole numbers in range, and nothing else', () => {
		expect(sanitizeCoyote({ maxA: 33.9, maxB: -5 })).toMatchObject({ maxA: 33, maxB: 0 });
		expect(sanitizeCoyote({ maxA: Number.NaN, maxB: '40' })).toMatchObject({ maxA: 0, maxB: 0 });
		expect(
			sanitizeCoyote({ burst: 500, pauseWorkS: 1, pausePauseS: 9999, increaseEveryS: 0, increaseUpTo: 99 })
		).toMatchObject({
			burst: 50,
			pauseWorkS: 10,
			pausePauseS: 120,
			increaseEveryS: 10,
			increaseUpTo: 50
		});
	});

	it('is enabled only with a maximum on at least one channel', () => {
		expect(sanitizeCoyote({ enabled: true }).enabled).toBe(false);
		expect(sanitizeCoyote({ enabled: true, maxB: 20 }).enabled).toBe(true);
		expect(sanitizeCoyote({ enabled: 'true', maxB: 20 }).enabled).toBe(false);
		// Both maxima taken down to 0: nothing is left to use.
		expect(sanitizeCoyote({ enabled: true, maxA: 0, maxB: 0 }).enabled).toBe(false);
	});

	it('a file never carries the permission or the above-100 confirmation', () => {
		const mine = sanitizeCoyote({ enabled: true, above100: true, maxA: 180, maxB: 40, burst: 20 });
		expect(mine).toMatchObject({ enabled: true, above100: true, maxA: 180 });
		const locked = lockedCoyote(mine);
		expect(locked).toMatchObject({ enabled: false, above100: false, maxA: 100, maxB: 40, burst: 20 });
		const imported = importedSettings({ coyote: mine }).coyote;
		expect(imported).toEqual(locked);
		// Not enabled: nothing can be started on a real device, whatever the file's maxima say.
		expect(maximaFor(imported)).toEqual({ a: 0, b: 0 });
	});
});

describe('the maxima in force', () => {
	const enabled = sanitizeCoyote({ enabled: true, maxA: 30, maxB: 0 });

	it("on a real device: 0 until it is enabled, then the user's own", () => {
		expect(maximaFor(DEFAULT_COYOTE)).toEqual({ a: 0, b: 0 });
		expect(maximaFor(sanitizeCoyote({ maxA: 50, maxB: 50 }))).toEqual({ a: 0, b: 0 });
		expect(maximaFor(enabled)).toEqual({ a: 30, b: 0 });
	});

	it('in the set-up: one channel up to the cap, the other at 0', () => {
		expect(maximaFor(DEFAULT_COYOTE, { setup: 'a' })).toEqual({ a: 100, b: 0 });
		expect(maximaFor(enabled, { setup: 'b' })).toEqual({ a: 0, b: 100 });
		expect(maximaFor(sanitizeCoyote({ above100: true }), { setup: 'b' })).toEqual({ a: 0, b: 200 });
	});

	it("in a preview: everything can be tried, with the user's maxima where there are any", () => {
		expect(maximaFor(DEFAULT_COYOTE, { preview: true })).toEqual({ a: 100, b: 100 });
		expect(maximaFor(enabled, { preview: true })).toEqual({ a: 30, b: 100 });
	});
});

describe('the caps written to the device', () => {
	it('are never 0: a channel that was set up gets its maximum, anything else the general limit', () => {
		expect(deviceCapsFor(DEFAULT_COYOTE)).toEqual({ a: 100, b: 100 });
		expect(deviceCapsFor(sanitizeCoyote({ maxA: 50, maxB: 50 }))).toEqual({ a: 100, b: 100 }); // not enabled
		expect(deviceCapsFor(sanitizeCoyote({ enabled: true, maxA: 30, maxB: 0 }))).toEqual({ a: 30, b: 100 });
		expect(deviceCapsFor(sanitizeCoyote({ enabled: true, maxA: 30, maxB: 45 }))).toEqual({ a: 30, b: 45 });
		expect(deviceCapsFor(sanitizeCoyote({ enabled: true, maxA: 30, above100: true }))).toEqual({
			a: 30,
			b: 200
		});
		// The channel a set-up is finding the maximum of may go up to the limit, even when it had one before.
		expect(deviceCapsFor(sanitizeCoyote({ enabled: true, maxA: 30, maxB: 45 }), 'a')).toEqual({
			a: 100,
			b: 45
		});
		for (const s of [{}, { enabled: true, maxB: 1 }, { above100: true }])
			for (const setup of [null, 'a', 'b'] as const)
				expect(Math.min(...Object.values(deviceCapsFor(sanitizeCoyote(s), setup)))).toBeGreaterThan(0);
	});
});

describe('pulse rate', () => {
	it('the protocol value is the time between pulses in milliseconds', () => {
		expect(pulsesPerSecond(10)).toBe(100);
		expect(pulsesPerSecond(100)).toBe(10);
		expect(pulsesPerSecond(1000)).toBe(1);
		expect(pulsesPerSecond(5)).toBe(100);
	});

	/** What the waveform itself does over one pass: its pulse rate only falls, only rises, or neither. */
	function direction(id: string): 'slows' | 'speeds' | null {
		const rates = ratesOf(id);
		let up = false;
		let down = false;
		for (let i = 1; i < rates.length; i++) {
			if (rates[i]! > rates[i - 1]!) up = true;
			if (rates[i]! < rates[i - 1]!) down = true;
		}
		return up === down ? null : up ? 'speeds' : 'slows';
	}

	it('a pattern is said to slow down or speed up exactly when its waveform does', () => {
		for (const p of PATTERNS) expect(RATE_DIRECTION[p.id] ?? null, p.id).toBe(direction(p.id));
		// Straight from the library's values, so a changed waveform can't leave the text behind.
		const first = (id: string) => coyote.previewWaveform(coyote.waveformById(id)!.waveform).freq[0];
		expect(first('rising-tone')).toBe(10); // 100 pulses a second at the start: it can only slow down
		expect(first('falling-tone')).toBe(100);
	});

	it('the texts say the same, with the numbers of the waveform', () => {
		const said: Record<string, RegExp> = { slows: /slow/i, speeds: /speed up/i };
		const other: Record<string, RegExp> = { slows: /speed up|faster/i, speeds: /slow/i };
		for (const [id, dir] of Object.entries(RATE_DIRECTION)) {
			const text = `${patternName(id)}. ${patternDescription(id)}`;
			expect(text, id).toMatch(said[dir]!);
			expect(text, id).not.toMatch(other[dir]!);
			const rates = ratesOf(id);
			const from = Math.round(rates[0]!);
			const to = Math.round(rates.at(-1)!);
			expect(patternDescription(id), id).toContain(`from ${from} to ${to} per second`);
		}
		// Nothing else claims a direction, and nothing speaks of "frequency" any more.
		for (const p of PATTERNS) {
			const text = `${patternName(p.id)}. ${patternDescription(p.id)}`;
			expect(text, p.id).not.toMatch(/frequency/i);
			if (!(p.id in RATE_DIRECTION)) expect(text, p.id).not.toMatch(/slow down|speed up|slowing/i);
		}
		expect(m.cw_surge_desc()).toContain('50 pulses per second');
		expect(Math.round(Math.min(...ratesOf('surge')))).toBe(14);
		expect(Math.round(Math.max(...ratesOf('surge')))).toBe(50);
	});
});

describe("the Coyote's patterns", () => {
	it('all twelve have a name, a description and a waveform to draw', () => {
		expect(PATTERNS).toHaveLength(12);
		for (const p of PATTERNS) {
			expect(hasText(p.id), p.id).toBe(true);
			expect(patternName(p.id).length, p.id).toBeGreaterThan(0);
			expect(patternDescription(p.id).length, p.id).toBeGreaterThan(0);
			const lanes = lanesOf(p.id)!;
			expect(lanes.strength.length, p.id).toBeGreaterThan(0);
			expect(lanes.rate).toHaveLength(lanes.strength.length);
			expect(Math.max(...lanes.strength), p.id).toBeLessThanOrEqual(1);
			expect(Math.min(...lanes.rate, ...lanes.strength), p.id).toBeGreaterThanOrEqual(0);
			expect(Math.max(...lanes.rate), p.id).toBeLessThanOrEqual(1);
			expect(lanes.seconds, p.id).toBeGreaterThan(0);
		}
	});

	it('say how long a pass is, or that they are constant', () => {
		expect(lengthText('steady')).toBe('Constant strength');
		expect(lengthText('tremble')).toContain('0.1');
		expect(lengthText('tide')).toContain('5.3');
		// The frequency range is that of the slots with any strength (a rest has none to speak of).
		expect(lanesOf('tide')!.rateRange).toEqual([25, 25]);
		expect(lanesOf('rising-tone')!.rateRange).toEqual([10, 100]);
		// Slower is lower in the lane: the pattern that slows down starts at the top and ends half-way.
		const lane = lanesOf('rising-tone')!.rate;
		expect(lane[0]).toBe(1);
		expect(lane.at(-1)).toBe(0.5);
	});
});
