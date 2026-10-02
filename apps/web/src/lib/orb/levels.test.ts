import { describe, expect, it } from 'vitest';
import {
	FLICKER_MAX,
	FLICKER_MIN,
	FLICKER_RING,
	flickerFor,
	orbLevels,
	REST_DEPTH,
	REST_PERIOD_S,
	restingLevels,
	THREAD_FLOOR,
	type ChannelInput
} from './levels';

const off: ChannelInput = { strength: 0, intensity: 0, max: 100, rate: 0 };
const ch = (over: Partial<ChannelInput>): ChannelInput => ({
	strength: 1,
	intensity: 50,
	max: 100,
	rate: 30,
	...over
});

describe('what the orb draws', () => {
	it("the body follows the ring's vibration, and only that", () => {
		expect(orbLevels({ t: 0, ring: { vibration: 0.6, estim: 0 }, coyote: null }).body).toBe(0.6);
		expect(orbLevels({ t: 0, ring: null, coyote: { a: ch({}), b: ch({}) } }).body).toBe(0);
		expect(orbLevels({ t: 0, ring: { vibration: 7, estim: 0 }, coyote: null }).body).toBe(1);
		expect(orbLevels({ t: 0, ring: { vibration: Number.NaN, estim: -1 }, coyote: null })).toMatchObject({
			body: 0,
			threads: [0, 0, 0]
		});
	});

	it("three thread sets, one each: the ring's e-stim, Coyote A, Coyote B", () => {
		const l = orbLevels({
			t: 0,
			ring: { vibration: 0.2, estim: 0.4 },
			coyote: { a: ch({ intensity: 100 }), b: off }
		});
		expect(l.threads[0]).toBe(0.4);
		expect(l.threads[1]).toBe(1);
		expect(l.threads[2]).toBe(0);
		// One device alone lights only its own.
		expect(orbLevels({ t: 0, ring: { vibration: 0.2, estim: 0.4 }, coyote: null }).threads).toEqual([
			0.4, 0, 0
		]);
		expect(orbLevels({ t: 0, ring: null, coyote: { a: off, b: ch({}) } }).threads[0]).toBe(0);
	});

	it('a Coyote channel is as bright as its strength times how far up its maximum it is', () => {
		const level = (c: Partial<ChannelInput>) =>
			orbLevels({ t: 0, ring: null, coyote: { a: ch(c), b: off } }).threads[1];
		const half = level({ intensity: 50, max: 100, strength: 1 });
		expect(half).toBeCloseTo(THREAD_FLOOR + (1 - THREAD_FLOOR) * 0.5);
		// The same intensity is brighter against a lower maximum, and full at the maximum.
		expect(level({ intensity: 50, max: 50 })).toBe(1);
		expect(level({ intensity: 30, max: 60 })).toBeCloseTo(half);
		expect(level({ intensity: 50, strength: 0.5 })).toBeLessThan(half);
		// Anything at all is seen. Nothing is nothing: no intensity, no strength, no maximum.
		expect(level({ intensity: 1, max: 200, strength: 0.1 })).toBeGreaterThanOrEqual(THREAD_FLOOR);
		expect(level({ intensity: 0 })).toBe(0);
		expect(level({ strength: 0 })).toBe(0);
		expect(level({ max: 0 })).toBe(0);
		expect(level({ intensity: 500, max: 100 })).toBe(1);
	});

	it('the shimmer follows the pulse rate, within bounds that are safe to look at', () => {
		expect(flickerFor(1)).toBe(FLICKER_MIN);
		expect(flickerFor(100)).toBe(FLICKER_MAX);
		expect(flickerFor(10)).toBeCloseTo((FLICKER_MIN + FLICKER_MAX) / 2);
		expect(flickerFor(0)).toBe(FLICKER_MIN);
		expect(flickerFor(100000)).toBe(FLICKER_MAX);
		expect(flickerFor(Number.NaN)).toBe(FLICKER_MIN);
		expect(FLICKER_MAX).toBeLessThanOrEqual(3); // never more than three cycles a second
		for (let r = 1; r < 100; r += 7) expect(flickerFor(r + 7)).toBeGreaterThan(flickerFor(r));
		const l = orbLevels({
			t: 0,
			ring: { vibration: 0, estim: 1 },
			coyote: { a: ch({ rate: 100 }), b: ch({ rate: 1 }) }
		});
		expect(l.flicker).toEqual([FLICKER_RING, FLICKER_MAX, FLICKER_MIN]);
	});

	it('with nothing playing it rests, breathing calmly', () => {
		const at = (t: number) => restingLevels(t);
		expect(at(0)).toEqual({
			body: 0,
			breath: 0,
			threads: [0, 0, 0],
			flicker: [FLICKER_RING, FLICKER_MIN, FLICKER_MIN]
		});
		expect(at(REST_PERIOD_S / 2).breath).toBeCloseTo(REST_DEPTH);
		expect(at(REST_PERIOD_S).breath).toBeCloseTo(0);
		for (let t = 0; t < 20; t += 0.37) {
			expect(at(t).breath).toBeGreaterThanOrEqual(0);
			expect(at(t).breath).toBeLessThanOrEqual(REST_DEPTH + 1e-9);
		}
	});

	it('without vibration the body keeps breathing while the threads lead, and vibration takes over', () => {
		const half = REST_PERIOD_S / 2;
		const coyoteOnly = orbLevels({ t: half, ring: null, coyote: { a: ch({}), b: off } });
		expect(coyoteOnly.breath).toBeCloseTo(REST_DEPTH);
		expect(coyoteOnly.threads[1]).toBeGreaterThan(0);
		expect(orbLevels({ t: half, ring: { vibration: 0.5, estim: 0 }, coyote: null }).breath).toBe(0);
	});

	it('a breath led from outside (the lead-in) wins over the resting one', () => {
		expect(orbLevels({ t: REST_PERIOD_S / 2, ring: null, coyote: null, breath: 0.9 }).breath).toBe(0.9);
		expect(orbLevels({ t: 0, ring: { vibration: 0.5, estim: 0 }, coyote: null, breath: 0.4 }).breath).toBe(
			0.4
		);
		expect(orbLevels({ t: REST_PERIOD_S / 2, ring: null, coyote: null, breath: 0 }).breath).toBeCloseTo(
			REST_DEPTH
		);
	});
});
