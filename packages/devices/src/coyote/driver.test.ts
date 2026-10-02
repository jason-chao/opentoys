// The Coyote driver and the simulated device (firmware 7 behaviour), with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCoyote, type FakeCoyoteOutput } from '../fake/fake-coyote.ts';
import { toHex } from '../protocol/bytes.ts';
import { CoyoteDriver, type CoyoteEvent } from './driver.ts';
import { COYOTE_CHAR_MAC, COYOTE_CHAR_NOTIFY, COYOTE_CHAR_WRITE } from './model.ts';
import { keepIntensity, setIntensity, T_DEC, T_INC } from './protocol.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

const P = Uint8Array.of(30, 30, 30, 30, 100, 100, 100, 100);
const wrote = (fake: FakeCoyote) => fake.writes.map((w) => toHex(w.data));

async function open(fake = new FakeCoyote(), caps?: { a: number; b: number }) {
	const dev = await CoyoteDriver.open(fake.connect(), caps ? { caps } : {});
	const events: CoyoteEvent[] = [];
	dev.onEvent((e) => events.push(e));
	return { fake, dev, events };
}

describe('CoyoteDriver', () => {
	it('reads version, battery and MAC, then zeroes and writes the soft caps', async () => {
		const { fake, dev } = await open(new FakeCoyote({ battery: 77 }), { a: 100, b: 80 });
		expect(dev.info()).toMatchObject({
			model: 'coyote-3',
			fw: 7,
			fwLabel: 3,
			battery: 77,
			mac: 'FA:0E:00:00:00:01',
			caps: { a: 100, b: 80 }
		});
		expect(wrote(fake)).toEqual(['B0FF00000A0A0A0A000000000A0A0A0A00000000', 'BF6450A0A00000']);
		expect(fake.caps).toEqual([100, 80]);
		await vi.advanceTimersByTimeAsync(50);
		expect(dev.info()).toMatchObject({ lastSeqAck: 15, intensityA: 0, intensityB: 0, replies: 1 });
	});

	it('writes no caps when none are given, and does without the MAC', async () => {
		const fake = new FakeCoyote();
		fake.characteristics = fake.characteristics.filter((c) => c !== COYOTE_CHAR_MAC);
		const { dev } = await open(fake);
		expect(wrote(fake)).toHaveLength(1);
		expect(dev.mac).toBeNull();
		expect(dev.caps).toBeNull();
	});

	it('refuses a device without the characteristics, closing the link', async () => {
		const fake = new FakeCoyote({ characteristics: [COYOTE_CHAR_WRITE] });
		const link = fake.connect();
		await expect(CoyoteDriver.open(link)).rejects.toMatchObject({ code: 'missing-characteristic' });
		expect(link.connected).toBe(false);
	});

	it('reports battery once a second', async () => {
		const { fake, dev, events } = await open();
		fake.battery = 64;
		await vi.advanceTimersByTimeAsync(2000);
		expect(events.filter((e) => e.kind === 'battery')).toEqual([
			{ kind: 'battery', percent: 64 },
			{ kind: 'battery', percent: 64 }
		]);
		expect(dev.battery).toBe(64);
	});

	it('gets an intensity report for a numbered frame, none for seq 0', async () => {
		const { fake, dev, events } = await open();
		await vi.advanceTimersByTimeAsync(50);
		events.length = 0;
		await dev.writeFrame(3, setIntensity(20, P), setIntensity(5));
		await vi.advanceTimersByTimeAsync(50);
		expect(events).toEqual([{ kind: 'intensity', seq: 3, a: 20, b: 5, raw: 'B1031405' }]);
		expect([dev.intensityA, dev.intensityB, dev.lastSeqAck]).toEqual([20, 5, 3]);
		await dev.writeFrame(0, keepIntensity(P), keepIntensity());
		await vi.advanceTimersByTimeAsync(50);
		expect(events).toHaveLength(1);
		expect(fake.intensity).toEqual([20, 5]);
		await dev.zero();
		await vi.advanceTimersByTimeAsync(50);
		expect([dev.intensityA, dev.intensityB, dev.lastSeqAck]).toEqual([0, 0, 15]);
	});

	it('reports what it does not understand instead of guessing', async () => {
		const { dev, events } = await open();
		await vi.advanceTimersByTimeAsync(50);
		expect(events).toContainEqual({ kind: 'other', type: 'identity', raw: '530000000001' });
		events.length = 0;
		await dev.write(Uint8Array.of(0xed, 0xe8));
		await dev.setLed('purple');
		await vi.advanceTimersByTimeAsync(50);
		expect(events).toEqual([
			{ kind: 'unsupported', cmd: 'ED', raw: 'E0ED01' },
			{ kind: 'other', type: 'reply', raw: '51001064' }
		]);
	});

	it('passes on a lost link', async () => {
		const { fake, dev } = await open();
		const seen: boolean[] = [];
		dev.onDisconnect((i) => seen.push(i.requested));
		fake.loseLink();
		expect(seen).toEqual([false]);
		expect(dev.connected).toBe(false);
		await expect(dev.zero()).rejects.toThrow();
	});
});

describe('FakeCoyote', () => {
	it('applies set, increase and decrease, bounded by the soft caps', async () => {
		const { fake, dev } = await open(new FakeCoyote(), { a: 50, b: 200 });
		await dev.writeFrame(1, setIntensity(90), setIntensity(90));
		expect(fake.intensity).toEqual([50, 90]);
		await dev.writeFrame(
			2,
			{ type: T_DEC, value: 60, payload: null },
			{ type: T_INC, value: 150, payload: null }
		);
		expect(fake.intensity).toEqual([0, 200]);
		await dev.setSoftCaps(50, 120);
		expect(fake.intensity).toEqual([0, 120]);
	});

	it('drains by itself when frames stop', async () => {
		const { fake, dev } = await open();
		const seen: FakeCoyoteOutput[] = [];
		fake.on('output', (o) => seen.push(o));
		await dev.writeFrame(1, setIntensity(30, P), setIntensity(0));
		expect(fake.output.a).toMatchObject({ intensity: 30, active: true });
		expect([...fake.output.a.payload!]).toEqual([...P]);
		expect(fake.output.b.active).toBe(false);
		await vi.advanceTimersByTimeAsync(100);
		await dev.writeFrame(0, keepIntensity(P), keepIntensity());
		await vi.advanceTimersByTimeAsync(100);
		expect(fake.output.a.active).toBe(true); // a frame every 100 ms keeps it going
		await vi.advanceTimersByTimeAsync(100);
		expect(fake.output.a).toEqual({ intensity: 30, payload: null, active: false });
		expect(seen.map((o) => o.a.active)).toEqual([true, false]);
	});

	it('reports a dial turn unasked, never above the soft cap', async () => {
		const { fake, dev, events } = await open(new FakeCoyote(), { a: 60, b: 60 });
		await vi.advanceTimersByTimeAsync(50);
		events.length = 0;
		fake.turnDial('a', 27);
		fake.turnDial('b', 90);
		expect(events).toEqual([
			{ kind: 'intensity', seq: 0, a: 27, b: 0, raw: 'B1001B00' },
			{ kind: 'intensity', seq: 0, a: 27, b: 60, raw: 'B1001B3C' }
		]);
		expect([dev.intensityA, dev.intensityB, dev.lastSeqAck]).toEqual([27, 60, 0]);
	});

	it('stops talking to a link that went away, and takes a new one', async () => {
		const { fake } = await open();
		const got: Uint8Array[] = [];
		const link = fake.connect(); // the first link is lost
		await link.subscribe(COYOTE_CHAR_NOTIFY, (d) => got.push(d));
		await link.write(COYOTE_CHAR_WRITE, Uint8Array.of(0xb0, 0x1f, 0, 0, ...P, ...P));
		fake.loseLink();
		await vi.advanceTimersByTimeAsync(500);
		expect(got).toEqual([]);
		expect(fake.connected).toBe(false);
		expect(fake.output.a.active).toBe(false);
		await expect(link.read(COYOTE_CHAR_MAC)).rejects.toThrow('not connected');
	});
});
