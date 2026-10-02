import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../controller/controller.ts';
import { CoyoteController } from '../controller/coyote-controller.ts';
import { CoyoteDriver } from '../coyote/driver.ts';
import { FakeCoyote } from '../fake/fake-coyote.ts';
import { FakeRing } from '../fake/fake-ring.ts';
import { S1Driver } from '../s1/driver.ts';
import { TestCoyoteEngine } from '../testing/test-coyote-engine.ts';
import { TestEngine } from '../testing/test-engine.ts';
import { attachLifecycle } from './lifecycle.ts';
import type { WakeLockSentinelLike } from './wake-lock.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

class FakeDocument extends EventTarget {
	visibilityState: 'visible' | 'hidden' = 'visible';
	setVisibility(v: 'visible' | 'hidden'): void {
		this.visibilityState = v;
		this.dispatchEvent(new Event('visibilitychange'));
	}
}

class FakeSentinel extends EventTarget implements WakeLockSentinelLike {
	released = false;
	async release(): Promise<void> {
		if (this.released) return;
		this.released = true;
		this.dispatchEvent(new Event('release'));
	}
}

class FakeWakeLock {
	readonly sentinels: FakeSentinel[] = [];
	deny = false;
	async request(type: 'screen'): Promise<FakeSentinel> {
		expect(type).toBe('screen');
		if (this.deny) throw new DOMException('not allowed', 'NotAllowedError');
		const s = new FakeSentinel();
		this.sentinels.push(s);
		return s;
	}
	get held(): number {
		return this.sentinels.filter((s) => !s.released).length;
	}
}

async function setup(stopEverything = false) {
	const ring = new FakeRing({ replyDelayMs: 80 });
	const connecting = S1Driver.open(ring.connect(), { waitMs: 300, pollIntervalMs: 100, infoGapMs: 10 });
	await vi.advanceTimersByTimeAsync(2000);
	const dev = await connecting;
	const engine = new TestEngine();
	const controller = new Controller({ engine });
	controller.attach(dev);
	const document = new FakeDocument();
	const window = new EventTarget();
	const wakeLock = new FakeWakeLock();
	const settings = { stopEverything };
	const errors: unknown[] = [];
	const life = attachLifecycle({
		controller,
		document,
		window,
		navigator: { wakeLock },
		stopEverythingOnLeave: () => settings.stopEverything,
		onWakeLockError: (e) => errors.push(e)
	});
	return { ring, engine, controller, document, window, wakeLock, settings, life, errors };
}

describe('page lifecycle', () => {
	it('hidden: e-stim off at once, vibration keeps running (Dragon S1 default)', async () => {
		const { ring, engine, document } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		await vi.advanceTimersByTimeAsync(5000);
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		document.setVisibility('visible');
		await vi.advanceTimersByTimeAsync(2000);
		expect(ring.estim).toBe(0); // stays off until the user turns it on again
	});

	it('hidden with "stop everything when I leave the page": full stop', async () => {
		const { ring, engine, document } = await setup(true);
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(engine.stoppedReason).toBe('page_hidden');
	});

	it('pagehide applies the same policy, both ways; closing the tab then drops the link', async () => {
		const a = await setup();
		a.engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		a.window.dispatchEvent(new Event('pagehide'));
		await flush();
		expect([a.ring.vib, a.ring.estim]).toEqual([153, 0]);
		await a.controller.device!.disconnect(); // what the browser does when the tab goes away
		expect([a.ring.vib, a.ring.estim]).toEqual([0, 0]); // a clean disconnect stops the ring (hardware)

		const b = await setup(true);
		b.engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		b.window.dispatchEvent(new Event('pagehide'));
		await flush();
		expect([b.ring.vib, b.ring.estim]).toEqual([0, 0]);
		expect(b.engine.stoppedReason).toBe('page_closed');
	});

	it('reads the setting at the moment of leaving', async () => {
		const { ring, engine, document, settings } = await setup(false);
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		settings.stopEverything = true;
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});

	it('holds a screen wake lock while output is live, and re-acquires it when visible again', async () => {
		const { engine, controller, document, wakeLock, life } = await setup();
		expect(wakeLock.held).toBe(0);
		engine.setManual(0.4, 0);
		await vi.advanceTimersByTimeAsync(100);
		expect(wakeLock.held).toBe(1);
		expect(life.wakeLock.held).toBe(true);
		// the browser releases the lock when the page is hidden
		document.visibilityState = 'hidden';
		await wakeLock.sentinels[0]!.release();
		document.dispatchEvent(new Event('visibilitychange'));
		await flush();
		expect(life.wakeLock.held).toBe(false);
		document.setVisibility('visible');
		await flush();
		expect(wakeLock.held).toBe(1);
		expect(wakeLock.sentinels).toHaveLength(2);
		controller.stop();
		await vi.advanceTimersByTimeAsync(100);
		expect(wakeLock.held).toBe(0);
		document.setVisibility('hidden');
		document.setVisibility('visible');
		await flush();
		expect(wakeLock.held).toBe(0); // not wanted any more
	});

	it('does not request the lock while hidden, and survives a refusal', async () => {
		const { engine, document, wakeLock, errors } = await setup();
		document.visibilityState = 'hidden';
		engine.setManual(0.4, 0);
		await vi.advanceTimersByTimeAsync(100);
		expect(wakeLock.sentinels).toHaveLength(0);
		wakeLock.deny = true;
		document.setVisibility('visible');
		await flush();
		expect(errors).toHaveLength(1);
		expect(wakeLock.held).toBe(0);
	});

	it('detaches its listeners and releases the lock', async () => {
		const { ring, engine, document, wakeLock, life } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		expect(wakeLock.held).toBe(1);
		life.detach();
		await flush();
		expect(wakeLock.held).toBe(0);
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([153, 127]);
	});
});

async function setupBoth(stopEverything = false) {
	const ring = new FakeRing({ replyDelayMs: 80 });
	const connecting = S1Driver.open(ring.connect(), { waitMs: 300, pollIntervalMs: 100, infoGapMs: 10 });
	await vi.advanceTimersByTimeAsync(2000);
	const ringEngine = new TestEngine();
	const ringController = new Controller({ engine: ringEngine });
	ringController.attach(await connecting);

	const coyote = new FakeCoyote({ batteryPeriodMs: 0 });
	const coyoteEngine = new TestCoyoteEngine({ cap: 100 });
	const coyoteController = new CoyoteController({ engine: coyoteEngine });
	coyoteController.attach(await CoyoteDriver.open(coyote.connect(), { caps: { a: 100, b: 100 } }));

	const document = new FakeDocument();
	const window = new EventTarget();
	const wakeLock = new FakeWakeLock();
	const life = attachLifecycle({
		controllers: [ringController, coyoteController],
		document,
		window,
		navigator: { wakeLock },
		stopEverythingOnLeave: () => stopEverything
	});
	return {
		ring,
		ringEngine,
		ringController,
		coyote,
		coyoteEngine,
		coyoteController,
		document,
		window,
		wakeLock,
		life
	};
}

describe('page lifecycle with two devices', () => {
	it('hidden: the ring keeps vibration and drops e-stim, the Coyote stops', async () => {
		const { ring, ringEngine, coyote, coyoteEngine, document } = await setupBoth();
		ringEngine.setManual(0.6, 0.5);
		coyoteEngine.setIntensity('a', 30);
		coyoteEngine.play('a');
		await vi.advanceTimersByTimeAsync(300);
		expect([ring.vib, ring.estim]).toEqual([153, 127]);
		expect(coyote.output.a).toMatchObject({ intensity: 30, active: true });
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		expect(coyote.intensity).toEqual([0, 0]);
		expect(coyoteEngine.stopped).toBe('page_hidden');
		expect(ringEngine.source).not.toBeNull();
		await vi.advanceTimersByTimeAsync(3000);
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		expect(coyote.output.a.active).toBe(false);
		document.setVisibility('visible');
		await vi.advanceTimersByTimeAsync(2000);
		expect(ring.estim).toBe(0); // both stay off until the user turns them on again
		expect(coyote.intensity).toEqual([0, 0]);
	});

	it('hidden with "stop everything": both stop; pagehide likewise', async () => {
		const a = await setupBoth(true);
		a.ringEngine.setManual(0.6, 0.5);
		a.coyoteEngine.setIntensity('b', 30);
		await vi.advanceTimersByTimeAsync(300);
		a.document.setVisibility('hidden');
		await flush();
		expect([a.ring.vib, a.ring.estim]).toEqual([0, 0]);
		expect(a.coyote.intensity).toEqual([0, 0]);

		const b = await setupBoth();
		b.ringEngine.setManual(0.6, 0.5);
		b.coyoteEngine.setIntensity('b', 30);
		await vi.advanceTimersByTimeAsync(300);
		b.window.dispatchEvent(new Event('pagehide'));
		await flush();
		expect([b.ring.vib, b.ring.estim]).toEqual([153, 0]);
		expect(b.coyote.intensity).toEqual([0, 0]);
		expect(b.coyoteEngine.stopped).toBe('page_closed');
	});

	it('holds one wake lock while either device is active', async () => {
		const { ringEngine, ringController, coyoteEngine, coyoteController, wakeLock } = await setupBoth();
		expect(wakeLock.held).toBe(0);
		coyoteEngine.setIntensity('a', 30);
		coyoteEngine.play('a');
		await vi.advanceTimersByTimeAsync(200);
		expect(wakeLock.held).toBe(1);
		ringEngine.setManual(0.4, 0);
		await vi.advanceTimersByTimeAsync(200);
		expect(wakeLock.held).toBe(1);
		expect(wakeLock.sentinels).toHaveLength(1); // one lock, not one each
		void coyoteController.stop();
		await vi.advanceTimersByTimeAsync(1500);
		expect(coyoteController.active).toBe(false);
		expect(wakeLock.held).toBe(1); // the ring is still going
		ringController.stop();
		await vi.advanceTimersByTimeAsync(200);
		expect(wakeLock.held).toBe(0);
	});

	it('takes controllers later, and lets them go', async () => {
		const {
			ring,
			ringEngine,
			ringController,
			coyote,
			coyoteEngine,
			coyoteController,
			document,
			wakeLock,
			life
		} = await setupBoth();
		life.detach();
		const later = attachLifecycle({ document, window: new EventTarget(), navigator: { wakeLock } });
		const removeRing = later.add(ringController);
		later.add(coyoteController);
		ringEngine.setManual(0.6, 0.5);
		coyoteEngine.setIntensity('a', 30);
		await vi.advanceTimersByTimeAsync(300);
		expect(wakeLock.held).toBe(1);
		removeRing();
		document.setVisibility('hidden');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([153, 127]); // no longer under these handlers
		expect(coyote.intensity).toEqual([0, 0]);
	});
});
