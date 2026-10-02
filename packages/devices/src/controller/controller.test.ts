import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRing, type FakeRingOptions } from '../fake/fake-ring.ts';
import * as P from '../protocol/index.ts';
import { S1Driver } from '../s1/driver.ts';
import { TestEngine } from '../testing/test-engine.ts';
import { Controller, type ControllerEvents, type ControllerOptions } from './controller.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const FAST = { waitMs: 300, polls: 2, pollIntervalMs: 100, infoGapMs: 10 };

async function settle<T>(p: Promise<T>, ms = 2000): Promise<T> {
	const guarded = p.then(
		(v) => ({ ok: true as const, v }),
		(e: unknown) => ({ ok: false as const, e })
	);
	await vi.advanceTimersByTimeAsync(ms);
	const r = await guarded;
	if (!r.ok) throw r.e;
	return r.v;
}

type Log = { [K in keyof ControllerEvents]: ControllerEvents[K][] };

function record(c: Controller): Log {
	const log = {} as Log;
	const kinds = [
		'state',
		'active',
		'tick',
		'output',
		'battery',
		'stopped',
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

async function setup(opts: Partial<ControllerOptions> = {}, ringOpts: FakeRingOptions = {}) {
	const ring = new FakeRing({ replyDelayMs: 80, ...ringOpts });
	const dev = await settle(S1Driver.open(ring.connect(), FAST));
	const engine = opts.engine instanceof TestEngine ? opts.engine : new TestEngine();
	const c = new Controller({ ...opts, engine });
	const log = record(c);
	c.attach(dev);
	const mark = ring.writes.length;
	const writesSince = () => ring.writes.slice(mark).map((w) => P.toHex(w.data));
	return { ring, dev, engine, c, log, writesSince };
}

/** Let queued writes land without running any timer. */
const flush = () => vi.advanceTimersByTimeAsync(0);

const ZERO = P.toHex(P.levels(0x56, 0, 0));
const STOP = P.toHex(P.stop(0x56));
const lv = (v: number, e: number) => P.toHex(P.levels(0x56, v, e));

describe('Controller output loop', () => {
	it('writes on change only, plus a refresh every second', async () => {
		const { ring, engine, c, log, writesSince } = await setup();
		expect(c.state).toBe('ready');
		const n0 = ring.levels.length;
		engine.setManual(0.5, 0);
		await vi.advanceTimersByTimeAsync(50);
		expect(ring.levels.length).toBe(n0 + 1);
		expect([ring.vib, ring.estim]).toEqual([127, 0]);
		expect(c.active).toBe(true);
		await vi.advanceTimersByTimeAsync(900);
		expect(ring.levels.length).toBe(n0 + 1); // unchanged: nothing written
		await vi.advanceTimersByTimeAsync(100);
		expect(ring.levels.length).toBe(n0 + 2); // the 1 s refresh
		expect(log.output.map((o) => o.kind)).toEqual(['levels', 'refresh']);
		engine.setManual(0.6, 0);
		await vi.advanceTimersByTimeAsync(50);
		expect(writesSince().at(-1)).toBe(lv(0.6, 0));
		expect(log.output.at(-1)).toMatchObject({ kind: 'levels', bytes: [153, 0], live: true });
		expect(log.output.at(-1)!.roles.vibration).toBeCloseTo(0.6);
	});

	it('writes on every tick with refreshMs 0', async () => {
		const { ring, engine } = await setup({ refreshMs: 0 });
		engine.setManual(0.5, 0);
		const n0 = ring.levels.length;
		await vi.advanceTimersByTimeAsync(500);
		expect(ring.levels.length - n0).toBe(10);
	});

	it('stops with a zero frame then the stop command, at once and again on the next tick', async () => {
		const { ring, engine, c, log, writesSince } = await setup();
		engine.setManual(0.4, 0.3);
		await vi.advanceTimersByTimeAsync(100);
		expect([ring.vib, ring.estim]).toEqual([102, 76]);
		const mark = writesSince().length;
		c.stop();
		await flush();
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP]); // before any tick
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(engine.source).toBeNull();
		expect(engine.stoppedReason).toBe('user');
		await vi.advanceTimersByTimeAsync(50);
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP, ZERO, STOP]);
		expect(c.active).toBe(false);
		expect(log.active.map((a) => a.active)).toEqual([true, false]);
		await vi.advanceTimersByTimeAsync(5000);
		expect(writesSince().slice(mark)).toHaveLength(4); // then nothing
		expect(log.stopped).toEqual([{ reason: 'user' }]);
	});

	it('sends nothing after the stop sequence when a tick listener stops output', async () => {
		const { ring, engine, c, writesSince } = await setup({ refreshMs: 0 });
		engine.setManual(0.4, 0.3);
		await vi.advanceTimersByTimeAsync(100);
		expect([ring.vib, ring.estim]).toEqual([102, 76]);
		const mark = writesSince().length;
		// e.g. the app's session limit, which watches the clock on every tick
		const off = c.on('tick', () => {
			off();
			c.stop('session_max');
		});
		await vi.advanceTimersByTimeAsync(50);
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP]); // no levels frame from that tick
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		await vi.advanceTimersByTimeAsync(50);
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP, ZERO, STOP]);
		expect(c.active).toBe(false);
		expect(engine.stoppedReason).toBe('session_max');
	});

	it('sends the stop sequence when the engine ends by itself', async () => {
		const engine = new TestEngine({ sessionMaxMs: 500 });
		const { ring, c, log } = await setup({ engine });
		engine.setManual(0.3, 0);
		await vi.advanceTimersByTimeAsync(600);
		expect(log.stopped).toEqual([{ reason: 'session_max' }]);
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(ring.stops).toBeGreaterThanOrEqual(3); // the handshake's + two
		expect(c.active).toBe(false);
	});

	it('sends the stop sequence when the engine is stopped behind its back', async () => {
		const { ring, engine, writesSince } = await setup();
		engine.setManual(0.3, 0.2);
		await vi.advanceTimersByTimeAsync(100);
		engine.stop('elsewhere');
		const mark = writesSince().length;
		await vi.advanceTimersByTimeAsync(100);
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP, ZERO, STOP]);
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});

	it('polls the battery every 60 s while idle', async () => {
		const { ring, log, writesSince } = await setup();
		expect(log.battery).toEqual([{ percent: 87 }]);
		ring.battery = 64;
		await vi.advanceTimersByTimeAsync(57_000); // the handshake's last write was ~1.5 s before setup returned
		expect(writesSince()).toEqual([]);
		await vi.advanceTimersByTimeAsync(2000);
		expect(writesSince()).toEqual(['01']);
		expect(log.battery.at(-1)).toEqual({ percent: 64 });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(writesSince()).toEqual(['01', '01']);
	});

	it('hands the engine the measured dt, capped for throttled timers', async () => {
		let tick: () => void = () => {};
		const scheduler = {
			every: (_ms: number, fn: () => void) => {
				tick = fn;
				return () => {};
			}
		};
		const { engine, c } = await setup({ scheduler });
		engine.setManual(0.2, 0);
		vi.advanceTimersByTime(50);
		tick();
		await flush();
		vi.advanceTimersByTime(5000);
		await c.step();
		expect(engine.dts).toEqual([50, 1000]);
	});
});

describe('Controller link safety', () => {
	it('treats 3 s without a reply while writing as link loss', async () => {
		const { ring, engine, c, log } = await setup();
		engine.setManual(0.3, 0);
		await vi.advanceTimersByTimeAsync(500);
		ring.answerWrites = false; // out of range, link not reported down yet
		// Silence counts from the last reply, which came with the last change or 1 s refresh.
		await vi.advanceTimersByTimeAsync(1900);
		expect(log.watchdog).toEqual([]);
		await vi.advanceTimersByTimeAsync(2100);
		expect(log.watchdog).toHaveLength(1);
		expect(log.watchdog[0]!.silentMs).toBeGreaterThan(3000);
		expect(log.linkLost).toEqual([{ reason: 'watchdog', mayBeRunning: true }]);
		expect(engine.stoppedReason).toBe('ring_not_answering');
		expect(c.state).toBe('lost');
		expect(c.active).toBe(false);
		await vi.advanceTimersByTimeAsync(100);
		expect(ring.connected).toBe(false); // stop sequence, then a clean disconnect
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});

	it('does not trip the watchdog while idle', async () => {
		const { ring, log } = await setup();
		ring.answerWrites = false;
		ring.answerPoll = false;
		await vi.advanceTimersByTimeAsync(200_000);
		expect(log.watchdog).toEqual([]);
		expect(log.linkLost).toEqual([]);
	});

	it('reports a lost link: the ring may still be running; nothing restarts by itself', async () => {
		const { ring, engine, c, log } = await setup();
		engine.setManual(0.4, 0.2);
		await vi.advanceTimersByTimeAsync(100);
		ring.loseLink();
		expect(log.linkLost).toEqual([{ reason: 'disconnected', mayBeRunning: true }]);
		expect(c.state).toBe('lost');
		expect(engine.source).toBeNull();
		expect(engine.stoppedReason).toBe('link_lost');
		expect([ring.vib, ring.estim]).toEqual([102, 51]); // held by the ring
		const n = ring.writes.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(ring.writes.length).toBe(n); // no reconnection unless the user asks
	});

	it('says nothing may be running when the link is lost while idle', async () => {
		const { ring, log } = await setup();
		ring.loseLink();
		expect(log.linkLost).toEqual([{ reason: 'disconnected', mayBeRunning: false }]);
	});

	it('reconnects on request: silences the ring first and never restarts output', async () => {
		const { ring, dev, engine, c, log } = await setup();
		engine.setManual(0.6, 0.3);
		await vi.advanceTimersByTimeAsync(100);
		ring.loseLink();
		const header = dev.info().header;
		const mark = ring.writes.length;
		const dev2 = await settle(S1Driver.open(ring.connect(), { ...FAST, knownHeader: header }));
		expect(ring.writes.slice(mark, mark + 2).map((w) => P.toHex(w.data))).toEqual([ZERO, STOP]);
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		c.attach(dev2);
		expect(c.state).toBe('ready');
		const n = ring.levels.length;
		await vi.advanceTimersByTimeAsync(3000);
		expect(ring.levels.length).toBe(n);
		expect(log.state.map((s) => s.state)).toEqual(['ready', 'lost', 'ready']);
	});

	it('stops a running engine when a device is attached', async () => {
		const { engine, c, log } = await setup();
		const ring2 = new FakeRing({ replyDelayMs: 80 });
		const dev2 = await settle(S1Driver.open(ring2.connect(), FAST));
		engine.setManual(0.5, 0);
		c.attach(dev2);
		expect(engine.source).toBeNull();
		expect(log.stopped.at(-1)).toEqual({ reason: 'connected' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(ring2.vib).toBe(0);
	});

	it('reports a failed write as link loss', async () => {
		const { ring, engine, c, log } = await setup();
		engine.setManual(0.3, 0);
		await vi.advanceTimersByTimeAsync(100);
		ring.failWrites = true;
		engine.setManual(0.5, 0);
		await vi.advanceTimersByTimeAsync(100);
		expect(log.linkLost).toHaveLength(1);
		expect(log.linkLost[0]).toMatchObject({ reason: 'write-failed', mayBeRunning: true });
		expect(c.state).toBe('lost');
	});

	it('disconnects cleanly on request', async () => {
		const { ring, engine, c, log, writesSince } = await setup();
		engine.setManual(0.3, 0.1);
		await vi.advanceTimersByTimeAsync(100);
		const mark = writesSince().length;
		await c.disconnect();
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP]);
		expect(ring.connected).toBe(false);
		expect(c.state).toBe('detached');
		expect(log.linkLost).toEqual([]);
		expect(engine.stoppedReason).toBe('disconnect');
	});
});

describe('Controller background policy (Dragon S1)', () => {
	it('on hide: e-stim to 0 at once, vibration keeps running, e-stim stays off', async () => {
		const { ring, engine, c, log, writesSince } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		expect([ring.vib, ring.estim]).toEqual([153, 127]);
		const mark = writesSince().length;
		expect(c.leavePage('hidden')).toBe('estim-off');
		await flush();
		expect(writesSince().slice(mark)).toEqual([lv(0.6, 0)]); // before any tick, not after a fade
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		expect(c.estimHeld).toBe(true);
		expect(log.background).toEqual([{ trigger: 'hidden', outcome: 'estim-off' }]);
		await vi.advanceTimersByTimeAsync(10_000);
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		expect(ring.levels.slice(-5).every((l) => l.estim === 0)).toBe(true);
		expect(engine.source).not.toBeNull();
	});

	it('brings e-stim back only when the user turns it on, ramping from 0', async () => {
		const { ring, engine, c } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		c.leavePage('hidden');
		await vi.advanceTimersByTimeAsync(200); // the engine's own fade is still under way
		engine.setManual(0.6, 0.5); // the user turns e-stim on again
		await vi.advanceTimersByTimeAsync(200);
		expect(c.estimHeld).toBe(false);
		expect(ring.estim).toBeLessThanOrEqual(Math.ceil(0.25 * 0.2 * 255));
		await vi.advanceTimersByTimeAsync(3000);
		expect(ring.estim).toBe(127);
	});

	it('on hide with "stop everything": a full stop', async () => {
		const { ring, engine, c, writesSince } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		const mark = writesSince().length;
		expect(c.leavePage('hidden', { stopEverything: true })).toBe('stop');
		await flush();
		expect(writesSince().slice(mark)).toEqual([ZERO, STOP]);
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(engine.stoppedReason).toBe('page_hidden');
	});

	it('on pagehide: the same policy, both ways', async () => {
		const { ring, engine, c } = await setup();
		engine.setManual(0.6, 0.5);
		await vi.advanceTimersByTimeAsync(100);
		expect(c.leavePage('pagehide')).toBe('estim-off');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([153, 0]);
		expect(c.leavePage('pagehide', { stopEverything: true })).toBe('stop');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(engine.stoppedReason).toBe('page_closed');
	});

	it('does nothing when nothing is running', async () => {
		const { c, log, writesSince } = await setup();
		expect(c.leavePage('hidden')).toBe('none');
		await vi.advanceTimersByTimeAsync(100);
		expect(writesSince()).toEqual([]);
		expect(log.background).toEqual([{ trigger: 'hidden', outcome: 'none' }]);
	});

	it('stops (rather than suppresses) when no source runs but the ring was left live', async () => {
		let tick: () => void = () => {};
		const scheduler = {
			every: (_ms: number, fn: () => void) => {
				tick = fn;
				return () => {};
			}
		};
		const { ring, engine, c } = await setup({ scheduler });
		engine.setManual(0.5, 0.2);
		tick();
		await flush();
		engine.stop('elsewhere'); // no tick after this (a frozen page)
		expect(c.leavePage('pagehide')).toBe('stop');
		await flush();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});
});
