// The Coyote output loop on the simulated device (a port of the reference implementation's test_runner.py, plus the page's
// own cases: leaving the page, link loss, the watchdog, the tick-listener guard).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoyoteDriver } from '../coyote/driver.ts';
import { COYOTE_CHAR_NOTIFY } from '../coyote/model.ts';
import { FakeCoyote, type FakeCoyoteOptions } from '../fake/fake-coyote.ts';
import { TEST_PAYLOAD, TestCoyoteEngine } from '../testing/test-coyote-engine.ts';
import {
	CoyoteController,
	type CoyoteControllerEvents,
	type CoyoteControllerOptions
} from './coyote-controller.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

type Log = { [K in keyof CoyoteControllerEvents]: CoyoteControllerEvents[K][] };

function record(c: CoyoteController): Log {
	const log = {} as Log;
	const kinds = [
		'state',
		'active',
		'tick',
		'output',
		'battery',
		'dial',
		'stopped',
		'silenced',
		'watchdog',
		'linkLost',
		'background'
	] as const;
	for (const k of kinds) {
		const list: unknown[] = [];
		(log as Record<string, unknown[]>)[k] = list;
		c.on(k, (p) => list.push(p));
	}
	return log;
}

interface Frame {
	seq: number;
	typeA: number;
	typeB: number;
	a: number;
	b: number;
	payloadA: number[];
}

function decode(d: Uint8Array): Frame {
	return {
		seq: d[1]! >> 4,
		typeA: (d[1]! >> 2) & 3,
		typeB: d[1]! & 3,
		a: d[2]!,
		b: d[3]!,
		payloadA: [...d.subarray(4, 12)]
	};
}

async function setup(
	opts: Partial<CoyoteControllerOptions> & { cap?: number } = {},
	fakeOpts: FakeCoyoteOptions = {}
) {
	const fake = new FakeCoyote({ batteryPeriodMs: 0, ...fakeOpts });
	const link = fake.connect();
	const dev = await CoyoteDriver.open(link, { caps: { a: 100, b: 100 } });
	await vi.advanceTimersByTimeAsync(50); // the connect sequence's answers
	const engine =
		opts.engine instanceof TestCoyoteEngine ? opts.engine : new TestCoyoteEngine({ cap: opts.cap ?? 100 });
	const c = new CoyoteController({ ...opts, engine });
	const log = record(c);
	c.attach(dev);
	const mark = fake.frames.length;
	const frames = () => fake.frames.slice(mark).map((f) => decode(f.data));
	return { fake, link, dev, engine, c, log, frames };
}

const SET = 3;
const KEEP = 0;
const tick = (n = 1) => vi.advanceTimersByTimeAsync(100 * n);

describe('CoyoteController output loop', () => {
	it('writes frames only when needed, sets on change, and the device acknowledges', async () => {
		const { fake, dev, engine, c, log, frames } = await setup({ probeMs: 0 });
		expect(c.state).toBe('ready');
		await tick(3);
		expect(frames()).toEqual([]); // nothing to do, nothing sent
		engine.setIntensity('a', 20);
		await tick();
		expect(frames()).toHaveLength(1);
		expect(frames()[0]).toMatchObject({ seq: 1, typeA: SET, typeB: SET, a: 20, b: 0 });
		expect(fake.intensity).toEqual([20, 0]);
		await vi.advanceTimersByTimeAsync(30);
		expect([dev.intensityA, dev.lastSeqAck]).toEqual([20, 1]); // B1 came back
		expect(log.output.at(-1)).toMatchObject({ seq: 1, a: 20, b: 0 });
		expect(c.active).toBe(true); // an intensity is up
		await tick(3);
		expect(frames()).toHaveLength(1); // no change, no output: nothing sent
		engine.play('a');
		await tick(5);
		const out = frames().slice(1);
		expect(out).toHaveLength(5); // one frame every 100 ms
		// The first frame of a start states the intensity explicitly; the rest keep it.
		expect(out[0]).toMatchObject({ typeA: SET, a: 20 });
		expect(out.slice(1).every((f) => f.seq === 0 && f.typeA === KEEP && f.a === 0)).toBe(true);
		expect(out[0]!.payloadA).toEqual([...TEST_PAYLOAD]);
		expect(c.live).toBe(true);
		expect(fake.output.a).toMatchObject({ intensity: 20, active: true });
		expect(log.tick.at(-1)!.frame).toMatchObject({ kind: 'frame', numbered: false });
	});

	it('rotates the sequence number 1..15 and never uses 0 for a change', async () => {
		const { engine, frames } = await setup({ probeMs: 0 });
		for (let i = 1; i <= 17; i++) {
			engine.setIntensity('b', i);
			await tick();
		}
		expect(frames().map((f) => f.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 1, 2]);
		expect(frames().at(-1)).toMatchObject({ typeB: SET, b: 17 });
	});

	it('numbers a frame every second while output is live, so the device keeps reporting', async () => {
		const { engine, log, frames } = await setup();
		engine.setIntensity('a', 10);
		engine.play('a');
		await tick(25);
		expect(frames()).toHaveLength(25);
		expect(frames().filter((f) => f.seq !== 0)).toHaveLength(3); // the change, then two probes
		expect(frames().every((f, i) => i === 0 || f.typeA === KEEP)).toBe(true);
		expect(log.output).toHaveLength(3);
		expect(log.dial).toEqual([]);
	});

	it('stops with ten zero frames, the first at once, and waits for the device to report 0', async () => {
		const { fake, dev, engine, c, log, frames } = await setup();
		engine.setIntensity('a', 30);
		engine.play('a');
		await tick(3);
		expect(c.live).toBe(true);
		const mark = frames().length;
		let confirmed: boolean | null = null;
		void c.stop('test').then((ok) => (confirmed = ok));
		await vi.advanceTimersByTimeAsync(0);
		expect(frames().slice(mark)).toHaveLength(1); // before any tick
		expect(frames().at(-1)).toMatchObject({ typeA: SET, typeB: SET, a: 0, b: 0 });
		expect(fake.intensity).toEqual([0, 0]);
		expect(engine.stopped).toBe('test');
		expect(log.stopped).toEqual([{ reason: 'test' }]);
		await tick(8);
		expect(confirmed).toBeNull();
		expect(c.active).toBe(true); // the stop is still going out
		await tick(7);
		const zeros = frames().slice(mark);
		expect(zeros).toHaveLength(10);
		expect(zeros.every((f) => f.seq !== 0 && f.typeA === SET && f.a === 0 && f.b === 0)).toBe(true);
		expect(zeros.every((f) => f.payloadA.slice(4).every((s) => s === 0))).toBe(true);
		expect(confirmed).toBe(true);
		expect([dev.intensityA, dev.intensityB]).toEqual([0, 0]);
		expect(log.silenced).toEqual([{ confirmed: true, a: 0, b: 0 }]);
		expect(c.active).toBe(false);
		expect(c.live).toBe(false);
		expect(fake.output.a.active).toBe(false);
		await tick(20);
		expect(frames().slice(mark)).toHaveLength(10); // then nothing
	});

	it('keeps sending zero frames while the device reports something else', async () => {
		const { fake, engine, c, log, frames } = await setup({ extraZeroFrames: 3 });
		engine.setIntensity('a', 30);
		await tick(2);
		const mark = frames().length;
		void c.stop();
		const off = fake.on('write', () => queueMicrotask(() => fake.turnDial('a', 12))); // a hand on the dial
		await tick(20);
		expect(frames().slice(mark)).toHaveLength(13);
		expect(log.silenced).toEqual([{ confirmed: false, a: 12, b: 0 }]);
		off();
	});

	it('sends the zero frames when the engine ends by itself', async () => {
		const engine = new TestCoyoteEngine({ cap: 100, sessionMaxMs: 500 });
		const { fake, c, log, frames } = await setup({ engine });
		engine.setIntensity('a', 40);
		engine.play('a');
		await tick(5);
		expect(log.stopped).toEqual([{ reason: 'session_max' }]);
		await tick(12);
		expect(frames().filter((f) => f.typeA === SET && f.a === 0)).toHaveLength(10);
		expect(fake.intensity).toEqual([0, 0]);
		expect(log.silenced).toEqual([{ confirmed: true, a: 0, b: 0 }]);
		expect(c.active).toBe(false);
	});

	it('never writes above the cap', async () => {
		const { fake, engine } = await setup({ cap: 50 });
		engine.setIntensity('a', 200);
		engine.play('a');
		await tick(3);
		expect(fake.intensity[0]).toBe(50);
		engine.a.cap = 30; // an engine that misreports: the controller still holds the cap
		engine.a.tick = () => ({
			intensity: 90,
			changed: true,
			payload: TEST_PAYLOAD,
			silent: false,
			scale: 1,
			cap: 30
		});
		await tick();
		expect(fake.intensity[0]).toBe(30);
	});

	it('hands the engine the measured dt, capped for throttled timers', async () => {
		let run: () => void = () => {};
		const scheduler = {
			every: (_ms: number, fn: () => void) => {
				run = fn;
				return () => {};
			}
		};
		const { engine, c } = await setup({ scheduler });
		vi.advanceTimersByTime(100);
		run();
		await vi.advanceTimersByTimeAsync(0);
		vi.advanceTimersByTime(5000);
		await c.step();
		expect(engine.dts).toEqual([100, 1000]);
	});

	it('passes the battery on', async () => {
		const { fake, log } = await setup({}, { batteryPeriodMs: 1000, battery: 88 });
		expect(log.battery).toEqual([{ percent: 88 }]);
		fake.battery = 87;
		await tick(10);
		expect(log.battery.at(-1)).toEqual({ percent: 87 });
	});
});

describe('CoyoteController follows the device', () => {
	it('adopts a dial turn as the base, never above the cap', async () => {
		const { fake, engine, log } = await setup({ cap: 50 });
		engine.setIntensity('a', 20);
		await tick(5);
		expect(engine.a.base).toBe(20); // our own acknowledgement changes nothing
		expect(log.dial).toEqual([]);
		fake.turnDial('a', 27); // the user turns the dial up
		await tick(5);
		expect(engine.a.base).toBe(27);
		expect(fake.intensity[0]).toBe(27);
		expect(log.dial).toEqual([{ channel: 'a', device: 27, commanded: 20, base: 27 }]);
		fake.turnDial('a', 12); // ... and down
		await tick(5);
		expect([engine.a.base, fake.intensity[0]]).toEqual([12, 12]);
		fake.turnDial('a', 90); // above the cap (50): pulled back
		await tick(5);
		expect([engine.a.base, fake.intensity[0]]).toEqual([50, 50]);
		expect(log.dial.at(-1)).toEqual({ channel: 'a', device: 90, commanded: 12, base: 50 });
	});

	it('follows the dial while a pattern plays', async () => {
		const { fake, engine, frames } = await setup();
		engine.setIntensity('b', 15);
		engine.play('b');
		await tick(5);
		fake.turnDial('b', 22);
		await tick(3);
		expect(engine.b.base).toBe(22);
		expect(frames().at(-1)).toMatchObject({ seq: 0, typeB: KEEP });
		expect(fake.output.b).toMatchObject({ intensity: 22, active: true });
	});

	it('a channel that starts from idle is set explicitly, whatever its wheel was turned to meanwhile', async () => {
		const { fake, engine, c } = await setup();
		engine.setIntensity('a', 20);
		engine.play('a');
		await tick(5);
		void c.stop();
		await tick(15);
		fake.turnDial('a', 40); // turned while nothing plays
		fake.turnDial('b', 35);
		await tick(5);
		engine.play('a'); // starts at the engine's intensity: 0
		await tick(3);
		expect(fake.intensity[0]).toBe(0);
		expect(fake.output.a.active).toBe(false);
		engine.play('b'); // B starts later, while A is already playing
		await tick(3);
		expect(fake.intensity[1]).toBe(0);
		expect(fake.output.b.active).toBe(false);
	});

	it('does not let the dial override a stop', async () => {
		const { fake, engine, c } = await setup();
		engine.setIntensity('a', 10);
		await tick(5);
		void c.stop('test');
		fake.turnDial('a', 30);
		await tick(12);
		expect(engine.a.base).toBe(0);
		expect(fake.intensity[0]).toBe(0);
	});

	it('does not take a late acknowledgement of an older change for a dial turn', async () => {
		const { fake, link, dev, engine, log } = await setup();
		engine.setIntensity('a', 1);
		await tick();
		engine.setIntensity('a', 2);
		await tick();
		await vi.advanceTimersByTimeAsync(30);
		// the answer to the FIRST change arrives late, after the second
		link.notify(COYOTE_CHAR_NOTIFY, Uint8Array.of(0xb1, 1, 1, 0));
		expect([dev.intensityA, dev.lastSeqAck]).toEqual([1, 1]);
		await tick(6);
		expect(engine.a.base).toBe(2);
		expect(log.dial).toEqual([]);
		expect(fake.intensity[0]).toBe(2);
	});

	it('picks up a lost frame through the device report', async () => {
		const { fake, engine, log } = await setup();
		engine.setIntensity('a', 20);
		engine.play('a');
		await tick(5);
		fake.intensity[0] = 14; // the device is not where we think it is
		await tick(12); // the next probe's answer says so
		expect(log.dial).toEqual([{ channel: 'a', device: 14, commanded: 20, base: 14 }]);
		expect(engine.a.base).toBe(14);
	});
});

describe('CoyoteController page and link safety', () => {
	it('leaving the page is always a full stop', async () => {
		for (const stopEverything of [false, true]) {
			const { fake, engine, c, log, frames } = await setup();
			engine.setIntensity('a', 25);
			engine.play('a');
			await tick(3);
			expect(c.leavePage('hidden', { stopEverything })).toBe('stop');
			await vi.advanceTimersByTimeAsync(0);
			expect(frames().at(-1)).toMatchObject({ typeA: SET, a: 0, typeB: SET, b: 0 }); // at once
			expect(fake.intensity).toEqual([0, 0]);
			expect(engine.stopped).toBe('page_hidden');
			expect(log.background).toEqual([{ trigger: 'hidden', outcome: 'stop' }]);
			await tick(30);
			expect(fake.intensity).toEqual([0, 0]); // and it stays off
			expect(c.active).toBe(false);
		}
	});

	it('pagehide stops too, and does nothing when nothing is on', async () => {
		const { engine, c, frames } = await setup();
		expect(c.leavePage('pagehide')).toBe('none');
		await tick(2);
		expect(frames()).toEqual([]);
		engine.setIntensity('b', 5);
		await tick();
		expect(c.leavePage('pagehide')).toBe('stop');
		expect(engine.stopped).toBe('page_closed');
	});

	it('reports a lost link: the device stops by itself, nothing restarts', async () => {
		const { fake, engine, c, log } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(3);
		fake.loseLink();
		expect(log.linkLost).toEqual([{ reason: 'disconnected', mayBeRunning: false }]);
		expect(c.state).toBe('lost');
		expect(c.active).toBe(false);
		expect(engine.stopped).toBe('link_lost');
		expect(engine.busy).toBe(false);
		const n = fake.writes.length;
		await tick(20);
		expect(fake.writes.length).toBe(n); // no reconnection unless the user asks
		expect(fake.output.a.active).toBe(false); // drained
	});

	it('attaching never restarts output', async () => {
		const { fake, engine, c, log } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(3);
		fake.loseLink();
		engine.setIntensity('a', 25); // the user fiddles while disconnected
		engine.play('a');
		const dev2 = await CoyoteDriver.open(fake.connect(), { caps: { a: 100, b: 100 } });
		expect(fake.intensity).toEqual([0, 0]); // the connect sequence zeroes
		c.attach(dev2);
		expect(engine.busy).toBe(false);
		expect(log.stopped.at(-1)).toEqual({ reason: 'connected' });
		const n = fake.frames.length;
		await tick(20);
		// at most the engine's "now 0" goes out: nothing that carries output
		const after = fake.frames.slice(n).map((f) => decode(f.data));
		expect(after.length).toBeLessThanOrEqual(1);
		expect(after.every((f) => f.a === 0 && f.b === 0 && f.payloadA.slice(4).every((x) => x === 0))).toBe(
			true
		);
		expect(fake.intensity).toEqual([0, 0]);
		expect(log.state.map((s) => s.state)).toEqual(['ready', 'lost', 'ready']);
		engine.setIntensity('a', 5); // the user's next intent works
		await tick();
		expect(fake.intensity[0]).toBe(5);
	});

	it('treats unanswered numbered frames as link loss', async () => {
		const { fake, engine, c, log } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(5);
		fake.answerFrames = false; // the link has silently died
		await tick(35);
		expect(log.watchdog).toEqual([]);
		await tick(10);
		expect(log.watchdog).toHaveLength(1);
		expect(log.watchdog[0]!.silentMs).toBeGreaterThan(3000);
		expect(log.linkLost).toEqual([{ reason: 'watchdog', mayBeRunning: false }]);
		expect(engine.stopped).toBe('device_not_answering');
		expect(c.state).toBe('lost');
		await tick(15);
		expect(fake.connected).toBe(false);
	});

	it('does not trip the watchdog while idle or while frames are answered', async () => {
		const { engine, log } = await setup();
		await tick(100);
		engine.setIntensity('a', 10);
		engine.play('a');
		await tick(100);
		expect(log.watchdog).toEqual([]);
		expect(log.linkLost).toEqual([]);
	});

	it('reports a failed write as link loss', async () => {
		const { fake, engine, c, log } = await setup();
		engine.setIntensity('a', 10);
		await tick();
		fake.failWrites = true;
		engine.setIntensity('a', 11);
		await tick();
		expect(log.linkLost).toHaveLength(1);
		expect(log.linkLost[0]).toMatchObject({ reason: 'write-failed', mayBeRunning: false });
		expect(c.state).toBe('lost');
	});

	it('disconnects cleanly: zero acknowledged, then the link is dropped', async () => {
		const { fake, engine, c, log } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(3);
		const closing = c.disconnect();
		await vi.advanceTimersByTimeAsync(100);
		await closing;
		expect(fake.intensity).toEqual([0, 0]);
		expect(fake.connected).toBe(false);
		expect(c.state).toBe('detached');
		expect(engine.stopped).toBe('disconnect');
		expect(log.linkLost).toEqual([]);
	});

	it('a tick listener that stops output is not followed by a frame carrying output', async () => {
		const { fake, engine, c, frames } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(3);
		const mark = frames().length;
		const off = c.on('tick', () => {
			off();
			void c.stop('session_max'); // what the app's session limit does
		});
		await tick();
		const after = frames().slice(mark);
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({ typeA: SET, a: 0, typeB: SET, b: 0 });
		expect(after[0]!.payloadA.slice(4)).toEqual([0, 0, 0, 0]);
		await tick(12);
		expect(frames().slice(mark)).toHaveLength(10);
		expect(
			frames()
				.slice(mark)
				.every((f) => f.a === 0 && f.payloadA.slice(4).every((s) => s === 0))
		).toBe(true);
		expect(fake.intensity).toEqual([0, 0]);
	});

	it('a tick listener that stops the engine directly is not followed by output either', async () => {
		const { engine, c, frames } = await setup();
		engine.setIntensity('a', 25);
		engine.play('a');
		await tick(3);
		const mark = frames().length;
		const off = c.on('tick', () => {
			off();
			engine.stop('elsewhere');
		});
		await tick(12);
		const after = frames().slice(mark);
		expect(after).toHaveLength(10);
		expect(after.every((f) => f.typeA === SET && f.a === 0)).toBe(true);
	});

	it('stop without a device silences the engine', async () => {
		const engine = new TestCoyoteEngine();
		const c = new CoyoteController({ engine });
		engine.setIntensity('a', 10);
		expect(await c.stop()).toBe(false);
		expect(engine.busy).toBe(false);
		expect(c.active).toBe(false);
	});
});
