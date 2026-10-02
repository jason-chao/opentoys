// Port of the reference implementation's test_s1.py, against the FakeRing with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceError } from '../device.ts';
import { FakeRing, type FakeRingOptions } from '../fake/fake-ring.ts';
import * as P from '../protocol/index.ts';
import { S1Driver, type S1InitOptions } from './driver.ts';
import { isDragonS1Name } from './model.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const FAST: S1InitOptions = { waitMs: 300, polls: 2, pollIntervalMs: 100, infoGapMs: 10 };

async function settle<T>(p: Promise<T>, ms = 5000): Promise<T> {
	const guarded = p.then(
		(v) => ({ ok: true as const, v }),
		(e: unknown) => ({ ok: false as const, e })
	);
	await vi.advanceTimersByTimeAsync(ms);
	const r = await guarded;
	if (!r.ok) throw r.e;
	return r.v;
}

async function make(ringOpts: FakeRingOptions = {}, init: S1InitOptions = FAST) {
	const ring = new FakeRing({ replyDelayMs: 80, ...ringOpts });
	const dev = await settle(S1Driver.open(ring.connect(), init));
	return { ring, dev };
}

const wrote = (ring: FakeRing) => ring.writes.map((w) => P.toHex(w.data));

describe('S1Driver', () => {
	it('handshakes with a hardware-like ring (silent until polled, 0x56 plain, answers every write)', async () => {
		const { ring, dev } = await make();
		expect(dev.header).toBe(0x56);
		expect(dev.scrambled).toBe(false);
		expect(wrote(ring)).toContain('01');
		expect([dev.battery, dev.fw, dev.hw, dev.stateByte]).toEqual([87, 1, 1, 0]);
		expect(dev.mac).toBe('');
		expect(dev.chip).toBeNull();
		expect(ring.stops).toBe(1); // the connection ends silent
		expect(ring.levels.at(-1)).toMatchObject({ vib: 0, estim: 0 });
		const n = dev.notifications;
		await dev.writeLevels(0.1, 0);
		await vi.advanceTimersByTimeAsync(100);
		expect(dev.notifications).toBe(n + 1); // every write is answered
		expect(dev.silentFor()).toBe(0);
	});

	it('learns an announced, scrambled header and reads MAC and chip', async () => {
		const { ring, dev } = await make({ announce: true, header: 0x58, answersInfo: true, fw: 7, hw: 2 });
		expect(dev.header).toBe(0x58);
		expect(dev.scrambled).toBe(true);
		expect(dev.mac).toBe('C0:FF:EE:00:00:01');
		expect(dev.chip).toEqual({ model: 0x36, vendor: 0x02 });
		expect([dev.battery, dev.fw, dev.hw]).toEqual([87, 7, 2]);
		expect(wrote(ring)).not.toContain('01'); // announced by itself: no poll needed
	});

	it('emits typed events', async () => {
		const ring = new FakeRing({ replyDelayMs: 80 });
		const dev = new S1Driver(ring.connect());
		const kinds: string[] = [];
		dev.onEvent((e) => kinds.push(e.kind));
		await settle(dev.init(FAST));
		expect(kinds.slice(0, 2)).toEqual(['header', 'status']);
	});

	it('measures silence while writing', async () => {
		const { ring, dev } = await make();
		ring.answerWrites = false;
		await dev.writeLevels(0.1, 0);
		await vi.advanceTimersByTimeAsync(50);
		await dev.writeLevels(0.1, 0);
		expect(dev.silentFor()).toBeGreaterThanOrEqual(50);
	});

	it('does not count a quiet spell before writing as silence', async () => {
		// Regression (found on hardware): an idle minute without writes or replies must not count as silence.
		const { dev } = await make();
		await vi.advanceTimersByTimeAsync(100_000);
		await dev.writeLevels(0.1, 0); // the reply is still on its way
		expect(dev.silentFor()).toBeLessThan(100);
		await vi.advanceTimersByTimeAsync(100);
		expect(dev.silentFor()).toBe(0);
	});

	it('does not accumulate slow replies', async () => {
		// Replies 200 ms behind a 2 s burst, then none: silence counts from the last reply, not the burst start.
		const { ring, dev } = await make({ replyDelayMs: 200 });
		for (let i = 0; i < 40; i++) {
			await dev.writeLevels(0.1, 0);
			await vi.advanceTimersByTimeAsync(50);
			expect(dev.silentFor()).toBeLessThanOrEqual(200); // never more than the latency
		}
		ring.answerWrites = false;
		for (let i = 0; i < 8; i++) {
			await dev.writeLevels(0.1, 0);
			await vi.advanceTimersByTimeAsync(50);
		}
		expect(dev.silentFor()).toBeGreaterThanOrEqual(200);
		expect(dev.silentFor()).toBeLessThanOrEqual(250);
	});

	it('fails when nothing answers', async () => {
		const ring = new FakeRing({ answerPoll: false });
		const link = ring.connect();
		await expect(settle(S1Driver.open(link, FAST))).rejects.toMatchObject({ code: 'not-identified' });
		expect(link.connected).toBe(false); // open() closes the link again
	});

	it('uses an assumed header when asked to', async () => {
		const ring = new FakeRing({ answerPoll: false, answerWrites: false });
		const dev = await settle(S1Driver.open(ring.connect(), { ...FAST, polls: 1, assumeHeader: 0x58 }));
		expect(dev.header).toBe(0x58);
	});

	it('refuses legacy firmware', async () => {
		const ring = new FakeRing({ legacy: true, replyDelayMs: 10 });
		await expect(settle(S1Driver.open(ring.connect(), FAST))).rejects.toMatchObject({
			code: 'legacy-firmware'
		});
	});

	it('writes levels as trunc(x·255), also scrambled', async () => {
		const { ring, dev } = await make({ header: 0x55, announce: true });
		await dev.writeLevels(0.5, 0.3);
		expect([ring.vib, ring.estim]).toEqual([127, 76]);
		await dev.output({ vib: 0.2, estim: 0 });
		expect([ring.vib, ring.estim]).toEqual([51, 0]);
		await dev.stop();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});

	it('refuses a device without the characteristics', async () => {
		const ring = new FakeRing({ characteristics: [] });
		const err = await settle(S1Driver.open(ring.connect(), FAST)).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(DeviceError);
		expect(err).toMatchObject({ code: 'missing-characteristic' });
	});

	it('refuses output before the header is known', async () => {
		const ring = new FakeRing();
		const dev = new S1Driver(ring.connect());
		await expect(dev.writeLevels(0.1, 0)).rejects.toMatchObject({ code: 'header-unknown' });
	});

	it('channels are independent and stop needs the zero frame', async () => {
		// As verified with a wearer (SPEC §8): 0 turns a channel off; the stop command alone leaves e-stim on.
		const { ring, dev } = await make();
		await dev.writeLevels(0.4, 0.3);
		expect([ring.vib, ring.estim]).toEqual([102, 76]);
		await dev.writeLevels(0, 0.3);
		expect([ring.vib, ring.estim]).toEqual([0, 76]);
		await dev.writeLevels(0.2, 0.3);
		await dev.raw(P.stop(0x56)); // the raw stop command: vibration only
		expect([ring.vib, ring.estim]).toEqual([0, 76]);
		await dev.stop(); // the driver's stop: zero frame + stop command
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(wrote(ring).slice(-2)).toEqual([P.toHex(P.levels(0x56, 0, 0)), P.toHex(P.stop(0x56))]);
	});

	it('silences a ring left running before anything else when the header is known', async () => {
		const ring = new FakeRing({ replyDelayMs: 80 });
		ring.connect();
		ring.vib = 153;
		ring.estim = 76; // left running through a lost link
		ring.loseLink();
		await settle(S1Driver.open(ring.connect(), { ...FAST, knownHeader: 0x56 }));
		expect(wrote(ring).slice(0, 2)).toEqual([P.toHex(P.levels(0x56, 0, 0)), P.toHex(P.stop(0x56))]);
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
	});

	it('reports info', async () => {
		const { dev } = await make();
		expect(dev.info()).toMatchObject({ model: 'dragon-s1', header: 0x56, battery: 87, fw: 1, hw: 1 });
		expect(dev.info().frames).toBeGreaterThan(0);
	});

	it('recognises the advertised name', () => {
		expect(isDragonS1Name('YLS01')).toBe(true);
		expect(isDragonS1Name(' YLS01-12 ')).toBe(true);
		expect(isDragonS1Name('RocketX701')).toBe(false);
		expect(isDragonS1Name(null)).toBe(false);
	});
});
