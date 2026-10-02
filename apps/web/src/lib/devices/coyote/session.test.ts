import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCoyote } from '@opentoys/devices';
import { sanitizeSettings, type Settings } from '$lib/app/settings';
import type { DeviceSession, SessionEnd, SessionHost } from '$lib/app/devices/types';
import { COYOTE } from './kind';
import { CoyoteDeviceSession } from './session.svelte';
import type { CoyoteSettings } from './settings';

// The Coyote's session on the simulated device: as a real device (connectVia) and as a preview.

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function setup(coyote: Partial<CoyoteSettings> = {}) {
	let settings: Settings = sanitizeSettings({ devices: ['coyote-3'], coyote });
	const ended: (SessionEnd | null)[] = [];
	const saved: unknown[] = [];
	let connected = 0;
	let began = 0;
	const host: SessionHost = {
		settings: () => settings,
		saveDeviceSettings: (...args) => saved.push(args),
		began: () => began++,
		ticked: () => {},
		activeChanged: () => {},
		ended: (_s: DeviceSession, end) => ended.push(end),
		connected: () => connected++
	};
	const session = new CoyoteDeviceSession(COYOTE, host);
	const fake = new FakeCoyote({ batteryPeriodMs: 0 });
	return {
		session,
		fake,
		ended,
		saved,
		counts: () => ({ connected, began }),
		/** Connect as a real device. */
		connect: async () => {
			const p = session.connectVia(async () => fake.connect());
			await tick(100);
			expect(await p).toBe(true);
		},
		/** Change the Coyote's settings, as Settings does. */
		set: (patch: Partial<CoyoteSettings>) => {
			settings = sanitizeSettings({ ...settings, coyote: { ...settings.coyote, ...patch } });
			session.applySettings(settings);
		}
	};
}

const ENABLED = { agreed: true, enabled: true, maxA: 30, maxB: 40 };

describe('the Coyote session on a real device', () => {
	it("is locked until it is enabled: nothing starts, though the device's own caps are never 0", async () => {
		const { session, fake, connect, counts } = setup({ maxA: 50, maxB: 50 });
		await connect();
		expect(session.real).toBe(true);
		expect(session.usable).toBe(false);
		expect(counts().connected).toBe(1);
		expect(fake.caps).toEqual([100, 100]); // the general limit: a cap of 0 would leave the wheels dead
		expect(session.maxima).toEqual({ a: 0, b: 0 }); // the app's own lock
		expect(session.play(['a', 'b'], 'steady')).toBe(false);
		session.setIntensity('a', 20);
		await tick(1000);
		expect(session.playing).toBe(false);
		expect(fake.intensity).toEqual([0, 0]);
		expect(fake.output.a.active).toBe(false);
	});

	it("sets both caps from the user's maximum, and the device's own", async () => {
		const { session, fake, connect, set } = setup(ENABLED);
		await connect();
		expect(fake.caps).toEqual([30, 40]);
		expect(session.engine.limits.absoluteMax).toBe(40);
		expect(session.engine.a.comfort.mode).toBe('simple');
		expect(session.engine.a.comfort.maxStrength).toBe(30);
		expect(session.engine.b.comfort.maxStrength).toBe(40);
		// Lowered in Settings: all three follow at once.
		set({ maxB: 25 });
		await tick(100);
		expect(fake.caps).toEqual([30, 25]);
		expect(session.engine.limits.absoluteMax).toBe(30);
		expect(session.engine.b.comfort.maxStrength).toBe(25);
	});

	it('starts at 0, and only goes up when the user raises it', async () => {
		const { session, fake, connect, counts } = setup(ENABLED);
		await connect();
		expect(session.play(['a'], 'steady')).toBe(true);
		await tick(2000);
		expect(session.playing).toBe(true);
		expect(session.active).toBe(true);
		expect(counts().began).toBe(1);
		expect(session.a.pattern).toBe('steady');
		expect(session.b.pattern).toBeNull();
		expect(fake.intensity).toEqual([0, 0]);
		expect(fake.output.a.active).toBe(false);
		for (let i = 0; i < 5; i++) session.step('a', 1);
		await tick(500);
		expect(fake.intensity).toEqual([5, 0]);
		expect(session.a.intensity).toBe(5);
		expect(fake.output.a.active).toBe(true);
	});

	it('never goes above the maximum, whatever is asked', async () => {
		const { session, fake, connect } = setup(ENABLED);
		await connect();
		session.play(['a', 'b'], 'steady');
		for (let i = 0; i < 60; i++) session.step('a', 1);
		session.setIntensity('b', 200);
		await tick(1000);
		expect(session.a.base).toBe(30);
		expect(session.b.base).toBe(40);
		expect(fake.intensity).toEqual([30, 40]);
		// Not below 0 either, and junk is 0.
		session.setIntensity('a', -5);
		session.setIntensity('b', Number.NaN);
		await tick(500);
		expect(fake.intensity).toEqual([0, 0]);
	});

	it('the intensity can only be set while a pattern plays on that channel', async () => {
		const { session, fake, connect } = setup(ENABLED);
		await connect();
		session.setIntensity('a', 20);
		session.burst('a', true);
		await tick(500);
		expect(session.a.base).toBe(0);
		expect(session.playing).toBe(false);
		expect(fake.intensity).toEqual([0, 0]);
	});

	it('a burst adds to what is playing, including what slow increase has added, so it never lowers it', async () => {
		const { session, fake, connect } = setup({ ...ENABLED, maxA: 60, burst: 10 });
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 20);
		await tick(500);
		const auto = session.engine.channel('a').auto;
		auto.enabled = true;
		auto.totalIncr = 15; // slow increase has added 15: the device is at 35
		await tick(500);
		expect(fake.intensity[0]).toBe(35);
		session.burst('a', true);
		await tick(500);
		expect(fake.intensity[0]).toBe(45); // 35 + 10, not 20 + 10
		session.burst('a', false);
	});

	it('the burst adds to the set intensity while held, never above the maximum, and not from 0', async () => {
		const { session, fake, connect } = setup({ ...ENABLED, burst: 10 });
		await connect();
		session.play(['a'], 'steady');
		session.burst('a', true); // at 0: nothing to add to
		await tick(500);
		expect(session.a.burst).toBe(false);
		expect(fake.intensity[0]).toBe(0);

		session.setIntensity('a', 12);
		await tick(500);
		session.burst('a', true);
		await tick(500);
		expect(session.a.burst).toBe(true);
		expect(fake.intensity[0]).toBe(22);
		expect(session.a.base).toBe(12); // the set intensity is not changed by it
		session.burst('a', false);
		await tick(500);
		expect(fake.intensity[0]).toBe(12);

		session.setIntensity('a', 26);
		await tick(500);
		session.burst('a', true);
		await tick(500);
		expect(fake.intensity[0]).toBe(30); // 26 + 10 would be 36: the maximum is 30
		// A held burst lets go by itself after 15 seconds.
		await tick(16_000);
		expect(session.a.burst).toBe(false);
		expect(fake.intensity[0]).toBe(26);
	});

	it('stop: the device reports 0, nothing restarts by itself, and the next start is at 0 again', async () => {
		const { session, fake, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 20);
		await tick(3000);
		expect(fake.intensity[0]).toBe(20);
		session.stop();
		expect(session.playing).toBe(false);
		expect(session.silencing).toBe(true);
		expect(session.a).toMatchObject({ pattern: null, base: 0, intensity: 0 });
		// While the zero frames go out nothing can be started.
		expect(session.play(['a'], 'steady')).toBe(false);
		await tick(2000);
		expect(session.silencing).toBe(false);
		expect(fake.intensity).toEqual([0, 0]);
		expect(session.engine.stoppedReason).toBe('user');
		expect(ended).toHaveLength(1);
		expect(ended[0]).toMatchObject({ device: 'coyote-3', what: 'steady', ended: 'user', durationS: 3 });
		await tick(5000);
		expect(fake.intensity).toEqual([0, 0]);

		// Starting again resumes the engine (its own session limit is back in force), at 0.
		expect(session.play(['a'], 'knock')).toBe(true);
		expect(session.engine.stoppedReason).toBeNull();
		await tick(2000);
		expect(session.a.base).toBe(0);
		expect(fake.intensity).toEqual([0, 0]);
		expect(session.stopped).toBeNull();
	});

	it('one channel off leaves the other playing, and the last one off is a stop', async () => {
		const { session, fake, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a', 'b'], 'steady');
		session.setIntensity('a', 10);
		session.setIntensity('b', 15);
		await tick(1000);
		session.off('a');
		await tick(1000);
		expect(fake.intensity).toEqual([0, 15]);
		expect(session.playing).toBe(true);
		expect(session.a.pattern).toBeNull();
		session.off('b');
		await tick(2000);
		expect(session.playing).toBe(false);
		expect(fake.intensity).toEqual([0, 0]);
		expect(ended).toHaveLength(1);
	});

	it('leaving the page stops it, and it stays off', async () => {
		const { session, fake, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a', 'b'], 'tide');
		session.setIntensity('a', 20);
		session.setIntensity('b', 30);
		await tick(1000);
		expect(session.leavePage('hidden')).toBe('stop');
		await tick(2000);
		expect(fake.intensity).toEqual([0, 0]);
		expect(session.playing).toBe(false);
		expect(session.leftPage).toBe(true);
		expect(session.stopped).toBe('page_hidden');
		expect(ended[0]).toMatchObject({ ended: 'page_hidden' });
		await tick(10_000); // back on the page: still off
		expect(fake.intensity).toEqual([0, 0]);
		expect(session.active).toBe(false);
		// Leaving while nothing plays is nothing.
		expect(session.leavePage('hidden')).toBe('none');
		session.play(['a'], 'tide');
		expect(session.leftPage).toBe(false);
	});

	it('a stop of every device while nothing plays here keeps the earlier reason', async () => {
		const { session, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		await tick(500);
		session.leavePage('hidden');
		await tick(2000);
		session.stop('user'); // Stop all, for another device
		await tick(2000);
		expect(session.stopped).toBe('page_hidden');
		expect(ended).toHaveLength(1);
	});

	it("follows the device's dial, within the maximum", async () => {
		const { session, fake, connect } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 10);
		await tick(1500);
		fake.turnDial('a', 17);
		await tick(1500);
		expect(session.a.base).toBe(17);
		expect(session.a.dial).toBe(17);
		expect(fake.intensity[0]).toBe(17);
		// Changing it here again clears the note.
		session.step('a', 1);
		expect(session.a.dial).toBeNull();
		// The device's own cap keeps the dial under the maximum too.
		fake.turnDial('a', 150);
		await tick(1500);
		expect(fake.intensity[0]).toBe(30);
		expect(session.a.base).toBe(30);
	});

	it('a wheel turned while nothing plays never carries over: every start is at 0', async () => {
		const { session, fake, connect } = setup(ENABLED);
		await connect();
		let felt = 0; // the highest intensity at which anything was output
		fake.on('output', (o) => {
			if (o.a.active) felt = Math.max(felt, o.a.intensity);
		});
		// Idle from the start, the wheel goes to 25.
		fake.turnDial('a', 25);
		await tick(1000);
		expect(session.play(['a'], 'steady')).toBe(true);
		await tick(3000);
		expect(fake.intensity[0]).toBe(0);
		expect(session.a.base).toBe(0);
		// The same after a stop.
		session.setIntensity('a', 5);
		await tick(1000);
		session.stop();
		await tick(2000);
		fake.turnDial('a', 28);
		await tick(1000);
		expect(session.play(['a'], 'steady')).toBe(true);
		await tick(3000);
		expect(fake.intensity[0]).toBe(0);
		expect(felt).toBe(5);
		// And for the set-up, whose channel may go up to the limit.
		session.stop();
		await tick(2000);
		fake.turnDial('a', 30);
		await tick(1000);
		expect(session.beginSetup('a')).toBe(true);
		await tick(3000);
		expect(fake.intensity[0]).toBe(0);
		expect(felt).toBe(5);
	});

	it('a wheel turned on a channel that is not used is put back, and nothing is output there', async () => {
		const { session, fake, connect } = setup({ enabled: true, maxA: 30, maxB: 0 });
		await connect();
		expect(fake.caps).toEqual([30, 100]);
		let feltB = false;
		fake.on('output', (o) => (feltB ||= o.b.active));
		session.play(['a', 'b'], 'steady');
		session.setIntensity('a', 10);
		session.setIntensity('b', 10);
		await tick(1000);
		fake.turnDial('b', 60);
		await tick(2000);
		expect(fake.intensity).toEqual([10, 0]);
		expect(session.b.pattern).toBeNull();
		expect(feltB).toBe(false);
	});

	it('the history says which patterns played, and the set-up stays out of it', async () => {
		const { session, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a'], 'tide');
		session.play(['b'], 'knock');
		session.play(['a'], 'tide');
		await tick(1000);
		session.stop();
		await tick(2000);
		expect(ended[0]).toMatchObject({ device: 'coyote-3', what: 'tide,knock' });

		expect(session.beginSetup('a')).toBe(true);
		await tick(1000);
		session.endSetup();
		await tick(2000);
		expect(ended).toEqual([ended[0], null]);
		expect(session.hasPlayed).toBe(true);
	});

	it('the set-up: one channel may go up to the cap so a maximum can be found, then the maxima are back', async () => {
		const { session, fake, connect, set } = setup();
		await connect();
		expect(fake.caps).toEqual([100, 100]);
		// Not before the safety notes are agreed to.
		expect(session.beginSetup('b')).toBe(false);
		set({ agreed: true });
		expect(session.beginSetup('b')).toBe(true);
		await tick(200);
		expect(session.setup).toBe('b');
		expect(fake.caps).toEqual([100, 100]);
		expect(session.maxima).toEqual({ a: 0, b: 100 });
		expect(fake.intensity).toEqual([0, 0]); // it starts at 0 here too
		for (let i = 0; i < 35; i++) session.step('b', 1);
		session.step('a', 5); // the other channel stays out of it
		await tick(1000);
		expect(fake.intensity).toEqual([0, 35]);
		// A pattern can't be started in the middle of it.
		expect(session.play(['a'], 'tide')).toBe(false);
		session.endSetup();
		await tick(2000);
		expect(session.setup).toBeNull();
		expect(fake.intensity).toEqual([0, 0]);
		expect(fake.caps).toEqual([100, 100]);
		// Confirmed: enabled with what was found.
		set({ enabled: true, maxB: 35 });
		await tick(200);
		expect(fake.caps).toEqual([100, 35]); // the channel that is not used keeps the general limit
		expect(session.maxima).toEqual({ a: 0, b: 35 }); // and the app never commands it
		expect(session.canUse('a')).toBe(false);
		expect(session.play(['a', 'b'], 'tide')).toBe(true);
		expect(session.a.pattern).toBeNull();
		expect(session.b.pattern).toBe('tide');
	});

	it('a start asked for while a stop is still going out waits for it, at 0, and a stop takes it back', async () => {
		const { session, fake, connect } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 20);
		await tick(1000);
		session.stop();
		expect(session.silencing).toBe(true);
		// What a pattern's Start (or the end of the set-up) asks for.
		expect(session.start('tide', { channels: ['b'] })).toBe(true);
		expect(session.playing).toBe(false);
		await tick(2500);
		expect(session.playing).toBe(true);
		expect(session.b.pattern).toBe('tide');
		expect(session.a.pattern).toBeNull();
		expect(fake.intensity).toEqual([0, 0]);
		// Stopped again before it could start: nothing starts.
		session.stop();
		expect(session.start('tide', { channels: ['a'] })).toBe(true);
		session.stop();
		await tick(4000);
		expect(session.playing).toBe(false);
		// And leaving the page takes it back too.
		session.play(['a'], 'steady');
		await tick(500);
		session.stop();
		session.start('tide', { channels: ['a'] });
		session.leavePage('hidden');
		await tick(4000);
		expect(session.playing).toBe(false);
		expect(fake.intensity).toEqual([0, 0]);
	});

	it('a maximum lowered while playing brings the intensity down with it', async () => {
		const { session, fake, connect, set } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 28);
		await tick(1000);
		set({ maxA: 15 });
		await tick(1000);
		expect(session.a.base).toBe(15);
		expect(fake.intensity[0]).toBe(15);
		// Disabled in Settings while playing: it stops.
		set({ enabled: false });
		await tick(2000);
		expect(fake.intensity[0]).toBe(0);
		expect(fake.output.a.active).toBe(false);
	});

	it('random pauses and slow increase', async () => {
		const { session, fake, connect } = setup({ ...ENABLED, increaseEveryS: 10, increaseUpTo: 3 });
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 10);
		session.setIncrease('a', true);
		await tick(45_000);
		expect(session.a.added).toBe(3); // +1 every 10 s, at most 3
		expect(session.a.intensity).toBe(13);
		expect(session.a.base).toBe(10);
		expect(fake.intensity[0]).toBe(13);
		session.setIncrease('a', false);
		await tick(500);
		expect(fake.intensity[0]).toBe(10);

		session.setPauses('a', true);
		let paused = false;
		for (let i = 0; i < 80 && !paused; i++) {
			await tick(1000);
			paused = session.a.pausing;
		}
		expect(paused).toBe(true);
		expect(fake.output.a.active).toBe(false);
	});

	it('a lost link stops the engine, and says the Coyote is not still running', async () => {
		const { session, fake, connect, ended } = setup(ENABLED);
		await connect();
		session.play(['a'], 'steady');
		session.setIntensity('a', 10);
		await tick(1000);
		fake.loseLink();
		await tick(500);
		expect(session.connection).toBe('lost');
		expect(session.mayBeRunning).toBe(false);
		expect(session.playing).toBe(false);
		expect(ended[0]).toMatchObject({ ended: 'link_lost' });
		expect(COYOTE.lostAdvice(session)).toBe(
			'If output continues after connection loss, switch off the device itself.'
		);
		expect(fake.output.a.active).toBe(false); // it drained without frames
	});
});

describe('the Coyote session in a preview', () => {
	it('plays without the set-up, stores nothing, and writes nothing to the history', async () => {
		const { session, ended, saved, counts } = setup();
		const p = session.connectPreview();
		await tick(100);
		expect(await p).toBe(true);
		expect(session.preview).toBe(true);
		expect(session.real).toBe(false);
		expect(session.usable).toBe(true);
		expect(session.battery).toBeNull();
		expect(counts().connected).toBe(0); // a preview is not a device of mine
		expect(session.play(['a', 'b'], 'tide')).toBe(true);
		session.setIntensity('a', 150);
		await tick(1000);
		expect(session.a.intensity).toBe(100); // the default maximum, on screen only
		session.stop();
		await tick(2000);
		expect(ended).toEqual([null]);
		expect(saved).toEqual([]);
		// The set-up needs a real device.
		expect(session.beginSetup('a')).toBe(false);
	});

	it('connecting a real device from a preview locks it again', async () => {
		const { session, fake, connect } = setup();
		const p = session.connectPreview();
		await tick(100);
		await p;
		session.play(['a'], 'tide');
		session.setIntensity('a', 40);
		await tick(500);
		await connect();
		expect(session.preview).toBe(false);
		expect(session.usable).toBe(false);
		expect(session.playing).toBe(false);
		expect(fake.caps).toEqual([100, 100]);
		expect(session.maxima).toEqual({ a: 0, b: 0 });
		await tick(1000);
		expect(fake.intensity).toEqual([0, 0]);
	});
});
