import { describe, expect, it } from 'vitest';
import { COYOTE } from '$lib/devices/coyote/kind';
import { RING } from '$lib/devices/ring/kind';
import { toggleDevice, withDevice } from './mine';
import { REGISTRY, Registry } from './registry';
import { fakeKind } from './testing';

const RING_ID = 'dragon-s1';

describe('the registry', () => {
	it('lists the Coyote 3.0 first, then the Dragon S1', () => {
		expect(REGISTRY.ids).toEqual(['coyote-3', RING_ID]);
		expect(REGISTRY.several).toBe(true);
		expect(REGISTRY.get(RING_ID)).toBe(RING);
		expect(REGISTRY.get('coyote-3')).toBe(COYOTE);
		expect(RING.settings?.key).toBe('ring');
		expect(COYOTE.settings?.key).toBe('coyote');
		// What was stored before devices were recorded is the ring's, wherever the ring is in the list.
		expect(REGISTRY.legacy).toBe(RING);
		expect(REGISTRY.of(undefined)).toBe(RING);
		expect(REGISTRY.of('gone')).toBe(RING);
	});

	it('each kind knows its own patterns', () => {
		expect(COYOTE.hasPattern('slow-breath')).toBe(true);
		expect(COYOTE.hasPattern('wave')).toBe(false);
		expect(RING.hasPattern('slow-breath')).toBe(false);
	});

	it('My devices with the two real kinds: either, or both, in the same order everywhere', () => {
		expect(toggleDevice([], 'coyote-3', REGISTRY)).toEqual(['coyote-3']);
		expect(toggleDevice(['coyote-3'], RING_ID, REGISTRY)).toEqual(['coyote-3', RING_ID]);
		expect(withDevice([RING_ID], 'coyote-3', REGISTRY)).toEqual(['coyote-3', RING_ID]);
		expect(toggleDevice([RING_ID, 'coyote-3'], RING_ID, REGISTRY)).toEqual(['coyote-3']);
	});

	it("knows the ring's patterns", () => {
		expect(RING.hasPattern('wave')).toBe(true);
		expect(RING.hasPattern('nope')).toBe(false);
	});

	it('finds kinds by id, and gives what has no device to the first kind', () => {
		const other = fakeKind('other').kind;
		const two = new Registry([RING, other]);
		expect(two.ids).toEqual([RING_ID, 'other']);
		expect(two.several).toBe(true);
		expect(two.has('other')).toBe(true);
		expect(two.has('nope')).toBe(false);
		expect(two.get('nope')).toBeUndefined();
		expect(two.of('other')).toBe(other);
		expect(two.of(undefined)).toBe(RING);
		expect(two.of(null)).toBe(RING);
		expect(two.of('gone')).toBe(RING);
	});

	it('refuses an empty list, a repeated id and a repeated settings key', () => {
		expect(() => new Registry([])).toThrow();
		expect(() => new Registry([RING, RING])).toThrow();
		expect(() => new Registry([RING, fakeKind('other', { settingsKey: 'ring' }).kind])).toThrow();
	});
});

describe('My devices', () => {
	const two = new Registry([RING, fakeKind('other').kind]);

	it("adds and removes a device, in the registry's order", () => {
		expect(toggleDevice([], 'other', two)).toEqual(['other']);
		expect(toggleDevice(['other'], RING_ID, two)).toEqual([RING_ID, 'other']);
		expect(toggleDevice([RING_ID, 'other'], RING_ID, two)).toEqual(['other']);
		expect(toggleDevice(['other'], 'other', two)).toEqual([]);
		expect(toggleDevice([RING_ID], 'nope', two)).toEqual([RING_ID]);
	});

	it('a connected device joins the list, once', () => {
		expect(withDevice([], 'other', two)).toEqual(['other']);
		expect(withDevice(['other'], RING_ID, two)).toEqual([RING_ID, 'other']);
		expect(withDevice([RING_ID, 'other'], 'other', two)).toEqual([RING_ID, 'other']);
		expect(withDevice([RING_ID], 'nope', two)).toEqual([RING_ID]);
	});
});
