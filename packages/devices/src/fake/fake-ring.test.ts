import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as P from '../protocol/index.ts';
import { S1_CHAR_NOTIFY, S1_CHAR_WRITE } from '../s1/model.ts';
import { FakeRing } from './fake-ring.ts';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('FakeRing', () => {
	it('is silent until written to, then answers every write with a status frame after 60–100 ms', async () => {
		const ring = new FakeRing({ battery: 42 });
		const link = ring.connect();
		const got: string[] = [];
		await link.subscribe(S1_CHAR_NOTIFY, (d) => got.push(P.toHex(d)));
		await vi.advanceTimersByTimeAsync(1000);
		expect(got).toEqual([]);
		await link.write(S1_CHAR_WRITE, P.LEGACY_POLL);
		await vi.advanceTimersByTimeAsync(59);
		expect(got).toEqual([]);
		await vi.advanceTimersByTimeAsync(41);
		expect(got).toEqual([P.toHex(P.frame(0x56, 1, 0, [1, 1, 42, 0, 0, 0]))]);
		expect(got[0]!.slice(0, 16)).toBe('5601060101' + '2A' + '0000');
		await link.write(S1_CHAR_WRITE, Uint8Array.of(0xde, 0xad)); // anything
		await vi.advanceTimersByTimeAsync(100);
		expect(got).toHaveLength(2);
	});

	it('holds levels, stops vibration only on the stop command, and stops both on a clean disconnect', async () => {
		const ring = new FakeRing();
		const outputs: [number, number][] = [];
		ring.on('output', (o) => outputs.push([o.vibByte, o.estimByte]));
		const link = ring.connect();
		await link.write(S1_CHAR_WRITE, P.levels(0x56, 0.5, 0.3));
		await vi.advanceTimersByTimeAsync(10_000);
		expect(ring.output).toMatchObject({ vibByte: 127, estimByte: 76 });
		expect(ring.output.vibration).toBeCloseTo(127 / 255);
		await link.write(S1_CHAR_WRITE, P.stop(0x56));
		expect([ring.vib, ring.estim]).toEqual([0, 76]);
		await link.write(S1_CHAR_WRITE, P.levels(0x56, 0.2, 0.3));
		await link.disconnect();
		expect([ring.vib, ring.estim]).toEqual([0, 0]);
		expect(outputs).toEqual([
			[127, 76],
			[0, 76],
			[51, 76],
			[0, 0]
		]);
	});

	it('keeps running through a lost link, and buzzes on every new connection', async () => {
		const ring = new FakeRing();
		const buzzes: number[] = [];
		ring.on('buzz', (b) => buzzes.push(b.at));
		const link = ring.connect();
		const lost: boolean[] = [];
		link.onDisconnect((i) => lost.push(i.requested));
		await link.write(S1_CHAR_WRITE, P.levels(0x56, 0.5, 0.3));
		ring.loseLink();
		expect(lost).toEqual([false]);
		expect([ring.vib, ring.estim]).toEqual([127, 76]); // the ring may still be running
		await expect(link.write(S1_CHAR_WRITE, P.LEGACY_POLL)).rejects.toThrow();
		ring.connect();
		expect(buzzes).toHaveLength(2);
	});

	it('drops replies to a link that went away', async () => {
		const ring = new FakeRing();
		const link = ring.connect();
		const got: Uint8Array[] = [];
		await link.subscribe(S1_CHAR_NOTIFY, (d) => got.push(d));
		await link.write(S1_CHAR_WRITE, P.LEGACY_POLL);
		ring.loseLink();
		await vi.advanceTimersByTimeAsync(200);
		expect(got).toEqual([]);
	});

	it('decodes scrambled frames', async () => {
		const ring = new FakeRing({ header: 0x58 });
		const link = ring.connect();
		await link.write(S1_CHAR_WRITE, P.toWire(P.levels(0x58, 1, 0.1)));
		expect([ring.vib, ring.estim]).toEqual([255, 25]);
	});
});
