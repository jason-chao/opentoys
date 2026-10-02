import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRing } from '@opentoys/devices';
import { sanitizeSettings, type Settings } from '$lib/app/settings';
import type { DeviceSession, SessionEnd, SessionHost } from '$lib/app/devices/types';
import { RING } from './kind';
import { RingSession } from './session.svelte';
import type { RingSettings } from './settings';

// The ring's session on the simulated ring: what the safety agreement gates, and the rows on Control.

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function setup(ring: Partial<RingSettings> = {}) {
	let settings: Settings = sanitizeSettings({ devices: ['dragon-s1'], ring: { warmupS: 0, ...ring } });
	const ended: (SessionEnd | null)[] = [];
	const host: SessionHost = {
		settings: () => settings,
		saveDeviceSettings: () => {},
		began: () => {},
		ticked: () => {},
		activeChanged: () => {},
		ended: (_s: DeviceSession, end) => ended.push(end),
		connected: () => {}
	};
	const session = new RingSession(RING, host);
	const fake = new FakeRing();
	return {
		session,
		fake,
		ended,
		connect: async () => {
			const p = session.connectVia(async () => fake.connect());
			await tick(2000);
			expect(await p).toBe(true);
		},
		set: (patch: Partial<RingSettings>) => {
			settings = sanitizeSettings({ ...settings, ring: { ...settings.ring, ...patch } });
			session.applySettings(settings);
		}
	};
}

/** The highest level the (simulated) ring was ever told, per channel. */
const peak = (fake: FakeRing) => ({
	vib: Math.max(0, ...fake.levels.map((l) => l.vib)),
	estim: Math.max(0, ...fake.levels.map((l) => l.estim))
});

describe("the ring's safety agreement", () => {
	it('without it nothing starts on a real ring: no pattern, no free control, no saved pattern, no levels', async () => {
		const { session, fake, connect } = setup();
		await connect();
		expect(session.real).toBe(true);
		expect(session.needsSetup).toBe(true);
		expect(session.usable).toBe(false);
		expect(RING.setupOnConnect(session)).toBe(true);
		expect(session.play('steady')).toBe(false);
		expect(session.start('wave', { estimOn: true })).toBe(false);
		session.setManual(0.5, 0.5);
		session.playMode(1, { name: 'x', periodMs: 100, vib: [1, 1], estim: [1, 1] });
		session.calibrate('vibration', 0.5);
		await tick(3000);
		expect(session.playing).toBe(false);
		expect(session.active).toBe(false);
		expect(peak(fake)).toEqual({ vib: 0, estim: 0 });
	});

	it('with it the ring plays, and the set-up may find levels', async () => {
		const { session, fake, connect, set } = setup();
		await connect();
		set({ agreed: true });
		expect(session.needsSetup).toBe(false);
		expect(session.play('steady')).toBe(true);
		await tick(2000);
		expect(session.playing).toBe(true);
		expect(peak(fake).vib).toBeGreaterThan(0);
		expect(peak(fake).estim).toBe(0); // e-stim has its own set-up
		session.stop();
		await tick(500);
		session.calibrate('vibration', 0.3);
		await tick(1500);
		expect(session.calibrating).toBe('vibration');
		expect((fake.levels.at(-1)?.vib ?? 0) / 255).toBeCloseTo(0.3, 1); // the byte on the wire
	});

	it('the vibration levels are offered once, the agreement every time it is missing', async () => {
		const { session, connect, set } = setup();
		await connect();
		set({ agreed: true, setupOffered: true });
		expect(RING.setupOnConnect(session)).toBe(false); // skipped: the default levels do
		set({ agreed: false });
		expect(RING.setupOnConnect(session)).toBe(true);
	});

	it('a preview plays on screen without it, e-stim included, and nothing is logged', async () => {
		const { session, ended } = setup();
		const p = session.connectPreview();
		await tick(2000);
		expect(await p).toBe(true);
		expect(session.needsSetup).toBe(false);
		expect(session.estimAvailable).toBe(true);
		expect(session.play('tingle-bed', { estimOn: true })).toBe(true);
		await tick(3000);
		expect(session.output.vibration + session.output.estim).toBeGreaterThan(0);
		session.stop();
		await tick(500);
		expect(ended).toEqual([null]);
	});
});

describe("the ring's rows on Control", () => {
	it("− and + move a pattern's intensity in steps of 5 %, within 0 and 100 %", async () => {
		const { session, connect } = setup({ agreed: true });
		await connect();
		expect(session.vibSetting).toBeNull(); // nothing plays: nothing to step
		session.stepVibration(1);
		expect(session.playing).toBe(false);
		session.play('steady', { vibIntensity: 0.8 });
		await tick(500);
		expect(session.vibSetting).toBe(0.8);
		session.stepVibration(1);
		expect(session.vibSetting).toBe(0.85);
		for (let i = 0; i < 10; i++) session.stepVibration(1);
		expect(session.vibSetting).toBe(1);
		for (let i = 0; i < 30; i++) session.stepVibration(-1);
		expect(session.vibSetting).toBe(0);
		// E-stim is not set up: its row has nothing to step.
		expect(session.estimSetting).toBeNull();
	});

	it('in free control they move the levels themselves', async () => {
		const { session, fake, connect } = setup({ agreed: true });
		await connect();
		session.setManual(0.2, 0);
		await tick(500);
		expect(session.vibSetting).toBe(0.2);
		session.stepVibration(2);
		await tick(1500);
		expect(session.vibSetting).toBe(0.3);
		expect((fake.levels.at(-1)?.vib ?? 0) / 255).toBeCloseTo(0.3, 1); // the byte on the wire
		expect(session.current).toMatchObject({ kind: 'manual', vib: 0.3 });
	});

	it('e-stim steps only once it is set up and part of what plays', async () => {
		const { session, connect } = setup({
			agreed: true,
			estimUnlocked: true,
			calibration: {
				vibFloor: 0.1,
				vibMax: 1,
				estimFloor: 0.02,
				estimMax: 0.5,
				vibDone: true,
				estimDone: true
			}
		});
		await connect();
		session.play('tingle-bed', { estimOn: true, estimIntensity: 0.5 });
		await tick(500);
		expect(session.estimSetting).toBe(0.5);
		session.stepEstim(-1);
		expect(session.estimSetting).toBe(0.45);
		session.adjust({ estimOn: false });
		expect(session.estimSetting).toBeNull();
		session.stop();
		await tick(500);
		session.play('steady');
		await tick(500);
		session.stepEstim(1);
		expect(session.current).toMatchObject({ kind: 'preset', id: 'steady' });
	});
});
