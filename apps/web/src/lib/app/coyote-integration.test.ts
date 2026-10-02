// The real Coyote engine (packages/core) driving the real output loop (packages/devices) on the simulated
// device: the two were built against a shared interface, and this checks they agree.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coyote, CoyoteSession } from '@opentoys/core';
import { CoyoteController, CoyoteDriver, FakeCoyote } from '@opentoys/devices';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const STEADY = coyote.waveformById('steady')!.waveform;

async function setup(cap = 100) {
	const fake = new FakeCoyote({ batteryPeriodMs: 0 });
	const dev = await CoyoteDriver.open(fake.connect(), { caps: { a: cap, b: cap } });
	await vi.advanceTimersByTimeAsync(50);
	const session = new CoyoteSession({ absoluteMax: cap });
	const controller = new CoyoteController({ engine: session });
	controller.attach(dev);
	return { fake, session, controller };
}

describe('Coyote engine + output loop + simulated device', () => {
	it('plays a waveform: intensity set and acknowledged, strength warms up from zero', async () => {
		const { fake, session, controller } = await setup();
		session.a.player.play(STEADY);
		session.a.setIntensity(30);
		await vi.advanceTimersByTimeAsync(300);
		expect(controller.active).toBe(true);
		expect(fake.intensity[0]).toBe(30);
		expect(fake.intensity[1]).toBe(0);
		const early = Math.max(...(fake.output.a.payload?.slice(4) ?? [0]));
		await vi.advanceTimersByTimeAsync(20_000);
		const later = Math.max(...(fake.output.a.payload?.slice(4) ?? [0]));
		expect(early).toBeLessThan(later); // warm-up
		expect(later).toBeLessThanOrEqual(100);
		expect(fake.output.a.active).toBe(true);
	});

	it('never exceeds the cap, whatever is asked', async () => {
		const { fake, session } = await setup(60);
		session.a.player.play(STEADY);
		session.a.setIntensity(200);
		session.a.fire.setTarget(200);
		session.a.fire.start();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fake.intensity[0]).toBeLessThanOrEqual(60);
	});

	it('follows a dial turn, but not the burst level while Fire is held', async () => {
		const { fake, session } = await setup();
		session.a.player.play(STEADY);
		session.a.setIntensity(20);
		await vi.advanceTimersByTimeAsync(1000);
		fake.turnDial('a', 35);
		await vi.advanceTimersByTimeAsync(1000);
		expect(session.a.baseIntensity).toBe(35);

		session.a.fire.setTarget(70);
		session.a.fire.start();
		await vi.advanceTimersByTimeAsync(2000);
		expect(fake.intensity[0]).toBe(70);
		expect(session.a.baseIntensity).toBe(35); // the burst was not adopted
		session.a.fire.end();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fake.intensity[0]).toBe(35);
	});

	it('stop: zero frames, the device reports 0, and nothing restarts by itself', async () => {
		const { fake, session, controller } = await setup();
		session.a.player.play(STEADY);
		session.a.setIntensity(30);
		await vi.advanceTimersByTimeAsync(2000);
		const stopped = controller.stop('user');
		await vi.advanceTimersByTimeAsync(1500);
		expect(await stopped).toBe(true);
		expect(fake.intensity[0]).toBe(0);
		expect(fake.output.a.active).toBe(false);
		expect(session.busy).toBe(false);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fake.intensity[0]).toBe(0);
		expect(controller.active).toBe(false);
	});

	it('plays again after a stop once the session is resumed, with the session limit back in force', async () => {
		const { fake, session, controller } = await setup();
		session.a.player.play(STEADY);
		session.a.setIntensity(30);
		await vi.advanceTimersByTimeAsync(1000);
		void controller.stop('user');
		await vi.advanceTimersByTimeAsync(1500);

		session.resume(); // the app does this on every start
		session.a.player.play(STEADY);
		session.a.setIntensity(25);
		await vi.advanceTimersByTimeAsync(1000);
		expect(session.stoppedReason).toBeNull();
		expect(fake.intensity[0]).toBe(25);
	});

	it('leaving the page stops both channels', async () => {
		const { fake, session, controller } = await setup();
		session.a.player.play(STEADY);
		session.a.setIntensity(30);
		session.b.player.play(STEADY);
		session.b.setIntensity(40);
		await vi.advanceTimersByTimeAsync(1000);
		expect([fake.intensity[0], fake.intensity[1]]).toEqual([30, 40]);
		controller.leavePage('hidden');
		await vi.advanceTimersByTimeAsync(1500);
		expect([fake.intensity[0], fake.intensity[1]]).toEqual([0, 0]);
		expect(session.busy).toBe(false);
	});
});
