import { describe, expect, it } from 'vitest';
import { COYOTE } from '$lib/devices/coyote/kind';
import { DEFAULT_COYOTE } from '$lib/devices/coyote/settings';
import { DEFAULT_RING, limitsFor, lockedRing, sanitizeRing } from '$lib/devices/ring/settings';
import { RING } from '$lib/devices/ring/kind';
import { Registry } from './devices/registry';
import { fakeKind } from './devices/testing';
import { DEFAULT_SETTINGS, importedSettings, sanitizeSettings } from './settings';

const RING_ID = 'dragon-s1';
const limits = (s: ReturnType<typeof sanitizeSettings>, preview = false) =>
	limitsFor(s.ring, s.sessionMaxMin, preview);

describe('sanitizeSettings', () => {
	it('fills in defaults from nothing', () => {
		expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(DEFAULT_SETTINGS).toEqual({
			adult: false,
			devices: [], // nothing is chosen until the visitor says which devices they have
			sessionMaxMin: 60,
			leadIn: false,
			favourites: [],
			ring: DEFAULT_RING,
			coyote: DEFAULT_COYOTE
		});
		expect(sanitizeSettings('junk').adult).toBe(false);
	});

	it('rejects NaN, strings and out-of-range limits', () => {
		const s = sanitizeSettings({
			sessionMaxMin: 1e9,
			leadIn: 'yes',
			ring: { estimRampPctS: Number.NaN, warmupS: '0' }
		});
		expect(s.ring.estimRampPctS).toBe(25);
		expect(s.ring.warmupS).toBe(3);
		expect(s.sessionMaxMin).toBe(1440);
		expect(s.leadIn).toBe(false);
	});

	it('no longer has a check-in setting', () => {
		expect('checkIns' in sanitizeSettings({ checkIns: true })).toBe(false);
	});
});

describe("the ring's settings", () => {
	it('never raises a cap above the built-in ones', () => {
		const r = sanitizeRing({ capVib: 5, capEstim: 1, calibration: { vibMax: 3, estimMax: 1 } });
		expect(r.capVib).toBe(1);
		expect(r.capEstim).toBe(0.8);
		expect(r.calibration.estimMax).toBe(0.8);
	});

	it('keeps comfort maxima under lowered caps, floors under maxima', () => {
		const r = sanitizeRing({
			capEstim: 0.3,
			calibration: { estimMax: 0.7, estimFloor: 0.6, vibMax: 0.4, vibFloor: 0.45 }
		});
		expect(r.calibration.estimMax).toBe(0.3);
		expect(r.calibration.estimFloor).toBe(0.3);
		expect(r.calibration.vibFloor).toBe(0.4);
	});

	it('unlocks e-stim only after the safety agreement and its calibration', () => {
		expect(sanitizeRing({ agreed: true, estimUnlocked: true }).estimUnlocked).toBe(false);
		expect(sanitizeRing({ estimUnlocked: true, calibration: { estimDone: true } }).estimUnlocked).toBe(false);
		expect(
			sanitizeRing({ agreed: true, estimUnlocked: true, calibration: { estimDone: true } }).estimUnlocked
		).toBe(true);
		expect(
			sanitizeRing({ agreed: true, estimUnlocked: true, capEstim: 0, calibration: { estimDone: true } })
				.estimUnlocked
		).toBe(false);
	});

	it('lets e-stim go above 80 % only with the confirmation', () => {
		expect(sanitizeRing({}).capEstim).toBe(0.8);
		expect(sanitizeRing({ capEstim: 1 }).capEstim).toBe(0.8);
		expect(sanitizeRing({ capEstim: 0.95, estimAbove80: 'yes' }).capEstim).toBe(0.8);
		const r = sanitizeRing({ capEstim: 0.95, estimAbove80: true, calibration: { estimMax: 0.9 } });
		expect(r.capEstim).toBe(0.95);
		expect(r.calibration.estimMax).toBe(0.9);
		// Switching it back brings the cap and the comfort maximum down again.
		const back = sanitizeRing({ ...r, estimAbove80: false });
		expect(back.capEstim).toBe(0.8);
		expect(back.calibration.estimMax).toBe(0.8);
		expect(sanitizeRing({ capEstim: 5, estimAbove80: true }).capEstim).toBe(1);
	});

	it('keeps only a byte-sized known header', () => {
		expect(sanitizeRing({ knownHeader: 0x56 }).knownHeader).toBe(0x56);
		expect(sanitizeRing({ knownHeader: 300 }).knownHeader).toBeNull();
		expect(sanitizeRing({ knownHeader: 'a' }).knownHeader).toBeNull();
	});

	it('a file never carries the e-stim permission or the 80 % confirmation', () => {
		const mine = sanitizeRing({
			agreed: true,
			estimUnlocked: true,
			estimAbove80: true,
			capEstim: 1,
			calibration: { estimDone: true, estimMax: 0.95, vibMax: 0.7, vibDone: true }
		});
		expect(mine.estimUnlocked).toBe(true);
		const locked = lockedRing(mine);
		expect(locked.agreed).toBe(false); // the safety agreement is the person's, not the file's
		expect(locked.estimUnlocked).toBe(false);
		expect(locked.estimAbove80).toBe(false);
		expect(locked.capEstim).toBe(0.8);
		expect(locked.calibration.estimMax).toBe(0.8);
		// What needs no confirmation comes through.
		expect(locked.calibration.vibMax).toBe(0.7);
		expect(locked.calibration.vibDone).toBe(true);
	});
});

describe('settings from before they were per device (flat)', () => {
	// Exactly what an earlier version stored, and exported.
	const flat = {
		onboarded: true,
		calibration: {
			vibFloor: 0.08,
			vibMax: 0.38,
			estimFloor: 0.04,
			estimMax: 0.24,
			vibDone: true,
			estimDone: true
		},
		estimUnlocked: true,
		estimRampPctS: 15,
		warmupS: 5,
		sessionMaxMin: 30,
		capVib: 0.9,
		capEstim: 0.5,
		estimAbove80: false,
		stopEverythingOnLeave: true,
		leadIn: true,
		favourites: ['wave', 'gen-drift', 'nope'],
		knownHeaders: { 'dragon-s1': 0x56, other: 1 }
	};

	it("moves the ring's settings under the ring, losing nothing", () => {
		const s = sanitizeSettings(flat);
		expect(s).toEqual({
			adult: true, // "onboarded" was the 18+ confirmation and the ring's safety notes at once
			devices: [RING_ID],
			sessionMaxMin: 30,
			leadIn: true,
			favourites: [
				{ device: RING_ID, id: 'wave' },
				{ device: RING_ID, id: 'gen-drift' }
			],
			ring: {
				agreed: true,
				setupOffered: true,
				calibration: flat.calibration,
				estimUnlocked: true,
				estimRampPctS: 15,
				warmupS: 5,
				capVib: 0.9,
				capEstim: 0.5,
				estimAbove80: false,
				stopEverythingOnLeave: true,
				knownHeader: 0x56
			},
			// The Coyote did not exist then: it starts as for anyone, not enabled.
			coyote: DEFAULT_COYOTE
		});
		// Stored again in the new shape, it reads back the same.
		expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
	});

	it('never enables e-stim or raises a cap on the way', () => {
		// A flat flag without its calibration unlocks nothing; a cap above 80 % without the confirmation is cut.
		const s = sanitizeSettings({ estimUnlocked: true, capEstim: 1, calibration: { estimMax: 1 } });
		expect(s.ring.estimUnlocked).toBe(false);
		expect(s.ring.capEstim).toBe(0.8);
		expect(s.ring.calibration.estimMax).toBe(0.8);
		expect(limits(s).maxEstim).toBe(0);
	});

	it('prefers the new shape when both are there (flat leftovers are ignored)', () => {
		const s = sanitizeSettings({ ...flat, ring: { capVib: 0.5 } });
		expect(s.ring.capVib).toBe(0.5);
		expect(s.ring.estimUnlocked).toBe(false);
		expect(s.ring.stopEverythingOnLeave).toBe(false);
	});

	it('an old export file comes in without the confirmations, in the new shape', () => {
		const file = { ...flat, estimAbove80: true, capEstim: 1 };
		const s = importedSettings(file);
		expect(s.ring.estimUnlocked).toBe(false);
		expect(s.ring.estimAbove80).toBe(false);
		expect(s.ring.capEstim).toBe(0.8);
		expect(s.ring.calibration.estimMax).toBe(0.24);
		expect(s.ring.calibration.vibMax).toBe(0.38);
		expect(s.ring.stopEverythingOnLeave).toBe(true);
		expect(s.favourites).toHaveLength(2);
		expect(limits(s).maxEstim).toBe(0);
		// The same for a file in the new shape.
		const again = importedSettings({
			...s,
			ring: { ...s.ring, estimUnlocked: true, estimAbove80: true, capEstim: 1 }
		});
		expect(again.ring.estimUnlocked).toBe(false);
		expect(again.ring.capEstim).toBe(0.8);
	});
});

describe("18 or over, and each device's safety agreement", () => {
	it('start unconfirmed', () => {
		const s = sanitizeSettings({});
		expect(s.adult).toBe(false);
		expect(s.ring.agreed).toBe(false);
		expect(s.coyote.agreed).toBe(false);
		expect(s.ring.setupOffered).toBe(false);
	});

	it("someone who was onboarded before the split is 18+ and has agreed to the ring's notes", () => {
		// As stored by the version before: one flag, with the ring's block already under `ring`.
		const s = sanitizeSettings({
			onboarded: true,
			devices: ['dragon-s1'],
			ring: { capVib: 0.9 },
			coyote: {}
		});
		expect(s.adult).toBe(true);
		expect(s.ring.agreed).toBe(true);
		expect(s.ring.setupOffered).toBe(true); // the set-up doesn't open by itself for them
		// The Coyote's notes were never shown to someone who had not enabled it.
		expect(s.coyote.agreed).toBe(false);
		// Not onboarded then: nothing now.
		const t = sanitizeSettings({ onboarded: false, ring: {} });
		expect(t.adult).toBe(false);
		expect(t.ring.agreed).toBe(false);
	});

	it('an enabled Coyote, and enabled ring e-stim, keep their agreement', () => {
		const s = sanitizeSettings({
			onboarded: true,
			ring: { estimUnlocked: true, calibration: { estimDone: true, estimMax: 0.4 } },
			coyote: { enabled: true, maxA: 30, maxB: 0 }
		});
		expect(s.ring.agreed).toBe(true);
		expect(s.ring.estimUnlocked).toBe(true);
		expect(s.coyote.agreed).toBe(true);
		expect(s.coyote.enabled).toBe(true);
		// A Coyote that was not enabled has no agreement to keep.
		expect(sanitizeSettings({ onboarded: true, coyote: { maxA: 30 } }).coyote.agreed).toBe(false);
	});

	it('once stored, the new fields are what counts', () => {
		const s = sanitizeSettings({
			adult: false,
			onboarded: true,
			ring: { agreed: false },
			coyote: { agreed: false, enabled: true, maxA: 30 }
		});
		expect(s.adult).toBe(false);
		expect(s.ring.agreed).toBe(false);
		// Without the agreement nothing is enabled.
		expect(s.coyote.enabled).toBe(false);
		expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
	});

	it('nothing is unlocked without the agreement, and a file never carries one', () => {
		const ring = sanitizeRing({ agreed: false, estimUnlocked: true, calibration: { estimDone: true } });
		expect(ring.estimUnlocked).toBe(false);
		const mine = sanitizeSettings({
			adult: true,
			ring: { agreed: true, estimUnlocked: true, calibration: { estimDone: true } },
			coyote: { agreed: true, enabled: true, maxA: 30 }
		});
		const imported = importedSettings(JSON.parse(JSON.stringify(mine)));
		expect(imported.adult).toBe(false);
		expect(imported.ring.agreed).toBe(false);
		expect(imported.ring.estimUnlocked).toBe(false);
		expect(imported.coyote.agreed).toBe(false);
		expect(imported.coyote.enabled).toBe(false);
		// The person importing had confirmed 18+ here: that stays theirs.
		expect(importedSettings(mine, undefined, true).adult).toBe(true);
	});
});

describe('My devices and favourites, with a second kind of device', () => {
	// Only in tests: a registry with the ring and a second, made-up kind.
	const other = fakeKind('other', { patterns: ['hum', 'wave'], settingsKey: 'other' });
	const two = new Registry([RING, other.kind]);

	it('with one kind registered the list is that device', () => {
		const one = new Registry([RING]);
		expect(sanitizeSettings({}, one).devices).toEqual([RING_ID]);
		expect(sanitizeSettings({ devices: [] }, one).devices).toEqual([RING_ID]);
		expect(sanitizeSettings({ devices: ['other', 7] }, one).devices).toEqual([RING_ID]);
	});

	it('the app itself knows the Dragon S1 and the Coyote 3.0', () => {
		expect(sanitizeSettings({}).devices).toEqual([]);
		expect(sanitizeSettings({ devices: ['coyote-3', 'nope', 'dragon-s1', 'coyote-3'] }).devices).toEqual([
			'coyote-3',
			RING_ID
		]);
		// Someone who used the app before the Coyote was added has the ring, and only it.
		expect(sanitizeSettings({ onboarded: true, capVib: 0.9 }).devices).toEqual([RING_ID]);
		expect(sanitizeSettings({ onboarded: true, devices: [RING_ID], ring: {} }).devices).toEqual([RING_ID]);
	});

	it("favourites belong to their device: the ring's patterns and the Coyote's are told apart", () => {
		const s = sanitizeSettings({
			favourites: [
				'wave', // from before favourites carried a device: the ring's
				{ device: 'coyote-3', id: 'tide' },
				{ device: RING_ID, id: 'tide' }, // the ring has a pattern with the same id
				{ device: 'coyote-3', id: 'wave' }, // not one of the Coyote's
				{ device: 'coyote-3', id: 'slow-breath' },
				{ device: RING_ID, id: 'slow-breath' } // not one of the ring's
			]
		});
		expect(s.favourites).toEqual([
			{ device: RING_ID, id: 'wave' },
			{ device: 'coyote-3', id: 'tide' },
			{ device: RING_ID, id: 'tide' },
			{ device: 'coyote-3', id: 'slow-breath' }
		]);
	});

	it('a history entry is described by the device it was on', () => {
		expect(RING.describe('wave', () => undefined)).toBe('Wave');
		expect(RING.describe('manual', () => undefined)).toBe('Free control');
		expect(COYOTE.describe('tide,knock', () => undefined)).toBe('Tide, Knock');
		expect(COYOTE.stopText('page_hidden')).toBe('Leaving the page ended playback in opentoys.');
		expect(RING.stopText('page_hidden')).toBe('Leaving the page ended playback in opentoys.');
	});

	describe('an import never raises a limit this browser has', () => {
		const here = (over: Record<string, unknown> = {}) =>
			sanitizeSettings({
				adult: true,
				sessionMaxMin: 30,
				ring: {
					agreed: true,
					capVib: 0.7,
					capEstim: 0.5,
					estimRampPctS: 10,
					calibration: {
						vibFloor: 0.1,
						vibMax: 0.6,
						estimFloor: 0.02,
						estimMax: 0.4,
						vibDone: true,
						estimDone: true
					}
				},
				coyote: { agreed: true, enabled: true, maxA: 60, maxB: 30 },
				...over
			});
		const generous = {
			sessionMaxMin: 120,
			ring: {
				capVib: 1,
				capEstim: 0.8,
				estimRampPctS: 50,
				calibration: {
					vibFloor: 0.1,
					vibMax: 0.9,
					estimFloor: 0.02,
					estimMax: 0.7,
					vibDone: true,
					estimDone: true
				}
			},
			coyote: { maxA: 100, maxB: 90 }
		};
		const strict = {
			sessionMaxMin: 10,
			ring: {
				capVib: 0.5,
				capEstim: 0.3,
				estimRampPctS: 5,
				calibration: {
					vibFloor: 0.1,
					vibMax: 0.4,
					estimFloor: 0.02,
					estimMax: 0.2,
					vibDone: true,
					estimDone: true
				}
			},
			coyote: { maxA: 20, maxB: 0 }
		};
		const into = (file: unknown, current = here()) => importedSettings(file, undefined, true, current);

		it('the session limit is the shorter of the two', () => {
			expect(into(generous).sessionMaxMin).toBe(30);
			expect(into(strict).sessionMaxMin).toBe(10);
		});

		it("the ring's vibration cap is the lower of the two", () => {
			expect(into(generous).ring.capVib).toBe(0.7);
			expect(into(strict).ring.capVib).toBe(0.5);
		});

		it("the ring's e-stim cap is the lower of the two", () => {
			expect(into(generous).ring.capEstim).toBe(0.5);
			expect(into(strict).ring.capEstim).toBe(0.3);
		});

		it("the ring's calibrated vibration maximum is the lower of the two", () => {
			expect(into(generous).ring.calibration.vibMax).toBe(0.6);
			expect(into(strict).ring.calibration.vibMax).toBe(0.4);
		});

		it("the ring's calibrated e-stim maximum is the lower of the two", () => {
			expect(into(generous).ring.calibration.estimMax).toBe(0.4);
			expect(into(strict).ring.calibration.estimMax).toBe(0.2);
		});

		it('the e-stim rise speed is the slower of the two', () => {
			expect(into(generous).ring.estimRampPctS).toBe(10);
			expect(into(strict).ring.estimRampPctS).toBe(5);
		});

		it("the Coyote's maximum on A and on B is the lower of the two", () => {
			expect(into(generous).coyote).toMatchObject({ maxA: 60, maxB: 30 });
			expect(into(strict).coyote).toMatchObject({ maxA: 20, maxB: 0 });
		});

		it("the Coyote's general limit stays at 100, whatever the file and this browser say", () => {
			const raised = here({ coyote: { agreed: true, enabled: true, above100: true, maxA: 150, maxB: 120 } });
			expect(raised.coyote).toMatchObject({ above100: true, maxA: 150, maxB: 120 });
			const got = into({ coyote: { above100: true, maxA: 200, maxB: 110 } }, raised).coyote;
			expect(got).toMatchObject({ above100: false, maxA: 100, maxB: 100 });
		});

		it('the limits the engine gets are never above what they were', () => {
			// As if e-stim were confirmed again afterwards, in this browser: the values that then count.
			const before = limitsFor({ ...here().ring, estimUnlocked: true }, here().sessionMaxMin);
			const got = into(generous);
			const after = limitsFor({ ...got.ring, estimUnlocked: true }, got.sessionMaxMin);
			expect(before.maxEstim).toBe(0.4);
			expect(after.maxVib).toBeLessThanOrEqual(before.maxVib);
			expect(after.maxEstim).toBeLessThanOrEqual(before.maxEstim);
			expect(after.estimRampPctS).toBeLessThanOrEqual(before.estimRampPctS);
			expect(after.sessionMaxS).toBeLessThanOrEqual(before.sessionMaxS);
		});

		it('still enables nothing: the agreements, e-stim and the Coyote stay off', () => {
			const got = into({
				ring: { agreed: true, estimUnlocked: true, estimAbove80: true, calibration: { estimDone: true } },
				coyote: { agreed: true, enabled: true, above100: true, maxA: 50 }
			});
			expect(got.ring).toMatchObject({ agreed: false, estimUnlocked: false, estimAbove80: false });
			expect(got.coyote).toMatchObject({ agreed: false, enabled: false, above100: false });
		});

		it('a browser that was never set up has no limits of its own: a restored backup keeps its values', () => {
			const got = into(generous, sanitizeSettings(undefined));
			expect(got.sessionMaxMin).toBe(sanitizeSettings(generous).sessionMaxMin);
			expect(got.ring.estimRampPctS).toBe(sanitizeSettings(generous).ring.estimRampPctS);
			// Still nothing is enabled, and nothing goes above what a file may carry.
			expect(got.ring.estimUnlocked).toBe(false);
			expect(got.coyote).toMatchObject({ enabled: false, above100: false });
		});

		it('once this browser is set up, its untouched defaults count as its limits', () => {
			const got = into(generous, sanitizeSettings({ adult: true }));
			expect(got.sessionMaxMin).toBe(60);
			expect(got.ring.estimRampPctS).toBe(DEFAULT_RING.estimRampPctS);
		});
	});

	it('with several kinds it is what was chosen: registered ids, once each', () => {
		expect(sanitizeSettings({}, two).devices).toEqual([]);
		// In the registry's order, whatever order they were stored in: devices are listed the same everywhere.
		expect(sanitizeSettings({ devices: ['other', 'nope', 'other', 3, RING_ID] }, two).devices).toEqual([
			RING_ID,
			'other'
		]);
		expect(sanitizeSettings({ devices: 'other' }, two).devices).toEqual([]);
	});

	it('settings from before the list existed belong to someone using the ring', () => {
		expect(sanitizeSettings({ onboarded: true, capVib: 0.9 }, two).devices).toEqual([RING_ID]);
		expect(sanitizeSettings({ onboarded: false }, two).devices).toEqual([]);
	});

	it("favourites carry their device, and are checked against that device's patterns", () => {
		const s = sanitizeSettings(
			{
				favourites: [
					'wave', // from before favourites carried a device: the ring's
					{ device: 'other', id: 'hum' },
					{ device: 'other', id: 'wave' }, // the same id on another device is another favourite
					{ device: 'other', id: 'steady' }, // not one of its patterns
					{ device: 'nope', id: 'wave' },
					{ device: RING_ID, id: 'wave' }, // already there
					{ id: 'wave' },
					7
				]
			},
			two
		);
		expect(s.favourites).toEqual([
			{ device: RING_ID, id: 'wave' },
			{ device: 'other', id: 'hum' },
			{ device: 'other', id: 'wave' }
		]);
	});

	it('every kind reads and locks its own settings block', () => {
		const s = sanitizeSettings(
			{ other: { level: 5, enabled: true }, ring: { capVib: 0.4 } },
			two
		) as unknown as {
			other: { level: number; enabled: boolean };
			ring: { capVib: number };
		};
		expect(s.other).toEqual({ level: 5, enabled: true });
		expect(s.ring.capVib).toBe(0.4);
		const file = importedSettings({ other: { level: 5, enabled: true } }, two) as unknown as typeof s;
		expect(file.other).toEqual({ level: 5, enabled: false });
	});
});

describe('limitsFor (the ring)', () => {
	it('holds e-stim at 0 until unlocked', () => {
		expect(limits(sanitizeSettings({})).maxEstim).toBe(0);
		const s = sanitizeSettings({
			ring: { agreed: true, estimUnlocked: true, calibration: { estimDone: true, estimMax: 0.5 } }
		});
		expect(limits(s).maxEstim).toBe(0.5);
	});

	it('shows e-stim in a preview without enabling it, with the default range', () => {
		const locked = sanitizeSettings({});
		expect(limits(locked, true).maxEstim).toBe(0.6);
		expect(limits(locked, true).estimFloor).toBe(0.02);
		// Outside the preview the same settings hold e-stim at 0 again.
		expect(limits(locked).maxEstim).toBe(0);
		// An enabled e-stim keeps its own calibrated range in a preview.
		const s = sanitizeSettings({
			ring: {
				agreed: true,
				estimUnlocked: true,
				calibration: { estimDone: true, estimMax: 0.3, estimFloor: 0.1 }
			}
		});
		expect(limits(s, true).maxEstim).toBe(0.3);
		expect(limits(s, true).estimFloor).toBe(0.1);
	});

	it('converts the session maximum to seconds', () => {
		expect(limits(sanitizeSettings({ sessionMaxMin: 20 })).sessionMaxS).toBe(1200);
	});
});
