// Conformance against the reference implementation's protocol vectors (test/fixtures/protocol_vectors.json, copied verbatim) and
// a port of the reference implementation's test_protocol.py.
import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/protocol_vectors.json' with { type: 'json' };
import * as P from './index.ts';

interface FrameCase {
	name: string;
	hdr: number;
	plain: string;
	nonce: number;
	wire: string;
	vib?: number;
	estim?: number;
}
interface NotifyCase {
	kind: string;
	hdr: number;
	wire: string;
	hw?: number;
	fw?: number;
	battery?: number;
	state?: number;
	mac?: string;
	model?: number;
	vendor?: number;
}

const V = vectors as unknown as {
	table: string[];
	level: { x: number; byte: number }[];
	frames: FrameCase[];
	worked_example: { plain: string; nonce: number; wire: string };
	blocks: { plain: string; scrambled: string }[];
	seal: { payload: string; nonce: number; sealed: string; opened: string }[];
	notify: NotifyCase[];
};

const BUILDERS: Record<string, (h: number) => Uint8Array> = {
	stop: P.stop,
	get_mac: P.queryMac,
	get_chip: P.queryChip
};

describe('protocol vectors', () => {
	it('has every vector group', () => {
		expect(V.level.length).toBeGreaterThan(0);
		expect(V.frames.length).toBeGreaterThan(0);
		expect(V.blocks.length).toBeGreaterThan(0);
		expect(V.seal.length).toBeGreaterThan(0);
		expect(V.notify.length).toBeGreaterThan(0);
	});

	it('uses the same table', () => {
		expect(P.TABLE.map((r) => P.toHex(r))).toEqual(V.table);
	});

	it.each(V.level)('level($x) = $byte', ({ x, byte }) => {
		expect(P.level(x)).toBe(byte);
	});

	it.each(V.frames)('frame $name hdr=$hdr nonce=$nonce', (c) => {
		const plain =
			c.name === 'levels' ? P.levels(c.hdr, c.vib ?? NaN, c.estim ?? NaN) : BUILDERS[c.name]!(c.hdr);
		expect(P.toHex(plain)).toBe(c.plain);
		expect(P.toHex(P.toWire(plain, c.nonce))).toBe(c.wire);
	});

	it('reproduces the worked example', () => {
		const w = V.worked_example;
		expect(P.toHex(P.toWire(P.fromHex(w.plain), w.nonce))).toBe(w.wire);
	});

	it.each(V.blocks)('block $plain', ({ plain, scrambled }) => {
		expect(P.toHex(P.scramble(P.fromHex(plain)))).toBe(scrambled);
		expect(P.toHex(P.unscramble(P.fromHex(scrambled)))).toBe(plain);
	});

	it.each(V.seal)('seal $payload nonce=$nonce', ({ payload, nonce, sealed, opened }) => {
		const s = P.seal(P.fromHex(payload), nonce);
		expect(P.toHex(s)).toBe(sealed);
		expect(P.toHex(P.openStripped(s))).toBe(opened);
	});

	it.each(V.notify)('notify $kind hdr=$hdr', (c) => {
		const n = P.parse(P.fromHex(c.wire));
		expect(n.kind).toBe(c.kind);
		expect(n.header).toBe(c.hdr);
		expect(n.crcOk).toBe(true);
		if (c.kind === 'status') {
			expect([n.fields.hw, n.fields.fw, n.fields.battery, n.fields.stateByte]).toEqual([
				c.hw,
				c.fw,
				c.battery,
				c.state
			]);
		} else if (c.kind === 'mac') {
			expect(n.fields.mac).toBe(c.mac);
		} else {
			expect([n.fields.model, n.fields.vendor]).toEqual([c.model, c.vendor]);
		}
	});
});

describe('protocol', () => {
	it('level rejects non-finite values', () => {
		expect(P.level(NaN)).toBe(0);
		expect(P.level(Infinity)).toBe(0);
		expect(P.level(-Infinity)).toBe(0);
	});

	it('refuses an unknown header', () => {
		expect(() => P.levels(0xa0, 0.1, 0.1)).toThrow(RangeError);
	});

	it('builds the S1 frames from the hardware notes', () => {
		// 56 02 05 vib 00 00 00 estim sum; the stop command 56 05 01 01 01 sum
		expect(P.toHex(P.levels(0x56, 0.5, 0.3))).toBe('5602057F0000004C28');
		expect(P.toHex(P.stop(0x56))).toBe('56050101015E');
		expect(P.toHex(P.toWire(P.levels(0x56, 0.5, 0.3)))).toBe('5602057F0000004C28'); // 0x56 is plain
	});

	it('varies the nonce and round-trips with a random one', () => {
		const plain = P.levels(0x58, 0.5, 0.3);
		const wires = new Set<string>();
		for (let i = 0; i < 40; i++) {
			const w = P.toWire(plain);
			wires.add(P.toHex(w));
			const back = new Uint8Array(plain.length);
			back[0] = w[0]!;
			back.set(P.openBlock(w.subarray(1)).subarray(0, plain.length - 1), 1);
			expect(P.toHex(back)).toBe(P.toHex(plain));
		}
		expect(wires.size).toBeGreaterThan(1);
	});

	it('handles other notification families', () => {
		expect(P.parse([0x58]).kind).toBe('ignored');
		expect(P.parse([0x42, 1, 2]).kind).toBe('ignored');
		const leg = P.parse([0x01, 0, 0, 0, 9, 0, 99, 1]);
		expect(leg.kind).toBe('legacy-status');
		expect(leg.fields).toEqual({ fw: 9, battery: 100, heater: true });
		expect(P.parse([0x58, 1, 2, 3]).kind).toBe('ignored'); // scrambled header, wrong length
	});

	it('reports a bad checksum without failing', () => {
		const good = P.frame(0x56, 0x01, 0, [2, 7, 50, 0, 0]);
		const bad = good.slice();
		bad[bad.length - 1] = (bad[bad.length - 1]! + 1) & 0xff;
		const n = P.parse(bad);
		expect(n.kind).toBe('status');
		expect(n.fields.battery).toBe(50);
		expect(n.crcOk).toBe(false);
	});

	it('parses the S1 status frame (battery at p[5])', () => {
		const n = P.parse(P.frame(0x56, 0x01, 0, [1, 1, 87, 0, 0, 0]));
		expect(n).toMatchObject({ kind: 'status', header: 0x56, crcOk: true });
		expect(n.fields).toMatchObject({ hw: 1, fw: 1, battery: 87, stateByte: 0 });
	});

	it('converts hex both ways', () => {
		expect(P.toHex(P.fromHex('0a ff'))).toBe('0AFF');
		expect(() => P.fromHex('abc')).toThrow();
	});
});
