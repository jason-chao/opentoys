// Conformance against vectors generated from the reference implementation's builders and parser
// (test/fixtures/coyote_protocol_vectors.json), and a port of its test_v3.py.
import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/coyote_protocol_vectors.json' with { type: 'json' };
import { fromHex, toHex } from '../protocol/bytes.ts';
import { coyoteNameKind, COYOTE_3, isCoyoteName } from './model.ts';
import {
	buildB0,
	buildBF,
	buildLed,
	type ChannelCommand,
	type IntensityType,
	KEEP,
	keepIntensity,
	LED_COLOURS,
	parseNotification,
	setIntensity,
	SILENT_PAYLOAD,
	T_INC,
	T_KEEP,
	T_SET
} from './protocol.ts';

interface CmdCase {
	type: number;
	value: number;
	payload: string | null;
}
const V = vectors as unknown as {
	silent_payload: string;
	b0: { seq: number; a: CmdCase; b: CmdCase; wire: string }[];
	bf: { args: number[]; wire: string }[];
	led: { index: number; wire: string }[];
	notify: { wire: string; kind: string; data: Record<string, unknown> }[];
	names: { name: string; family: string | null }[];
};

const cmd = (c: CmdCase): ChannelCommand => ({
	type: c.type as IntensityType,
	value: c.value,
	payload: c.payload === null ? null : fromHex(c.payload)
});

describe('coyote protocol vectors', () => {
	it('has every vector group', () => {
		expect(V.b0.length).toBeGreaterThan(50);
		expect(V.bf.length).toBeGreaterThan(10);
		expect(V.led).toHaveLength(6);
		expect(V.notify.length).toBeGreaterThan(20);
		expect(toHex(SILENT_PAYLOAD)).toBe(V.silent_payload);
	});

	it.each(V.b0)('B0 seq=$seq → $wire', (c) => {
		expect(toHex(buildB0(c.seq, cmd(c.a), cmd(c.b)))).toBe(c.wire);
	});

	it.each(V.bf)('BF $args', ({ args, wire }) => {
		const [maxA, maxB, fbA, fbB, sbA, sbB] = args;
		expect(toHex(buildBF(maxA!, maxB!, { fbA, fbB, sbA, sbB }))).toBe(wire);
	});

	it.each(V.led)('LED $index', ({ index, wire }) => {
		expect(toHex(buildLed(LED_COLOURS[index]!))).toBe(wire);
	});

	it.each(V.notify)('notification "$wire" is $kind', ({ wire, kind, data }) => {
		const n = parseNotification(fromHex(wire));
		expect(n.kind).toBe(kind.replace('_', '-'));
		expect(n.raw).toBe(wire);
		if (n.kind === 'intensity') expect({ seq: n.seq, a: n.a, b: n.b }).toEqual(data);
		if (n.kind === 'unsupported' || n.kind === 'reply') expect(n.cmd).toBe(data['cmd']);
		if (n.kind === 'identity') expect(n.tail).toBe(data['tail']);
	});

	it.each(V.names)('name "$name" is $family', ({ name, family }) => {
		const want =
			family === 'v3' ? 'supported' : family === 'recovery' || family === 'v3-dfu' ? 'recovery' : null;
		expect(coyoteNameKind(name)).toBe(want);
	});
});

describe('coyote protocol', () => {
	it('matches the frame the vendor app writes on reconnect', () => {
		// seq 1, A "increase by 0", B keep, payloads 00000000000000FF
		const p = fromHex('00000000000000FF');
		const wire = buildB0(1, { type: T_INC, value: 0, payload: p }, { type: T_KEEP, value: 0, payload: p });
		expect(toHex(wire)).toBe('B014000000000000000000FF00000000000000FF');
	});

	it('lays out B0 and sends a silent payload by default', () => {
		const f = Uint8Array.of(10, 10, 10, 10, 100, 100, 100, 100);
		const pkt = buildB0(7, setIntensity(35, f), setIntensity(0));
		expect([...pkt.subarray(0, 4)]).toEqual([0xb0, (7 << 4) | (T_SET << 2) | T_SET, 35, 0]);
		expect([...pkt.subarray(4, 12)]).toEqual([...f]);
		expect([...pkt.subarray(12)]).toEqual([10, 10, 10, 10, 0, 0, 0, 0]);
		expect(pkt).toHaveLength(20);
		expect(toHex(buildB0(0, KEEP, keepIntensity()))).toBe('B00000000A0A0A0A000000000A0A0A0A00000000');
	});

	it('refuses frames it cannot encode', () => {
		expect(() => buildB0(16, KEEP, KEEP)).toThrow(RangeError);
		expect(() => buildB0(1, setIntensity(201), KEEP)).toThrow(RangeError);
		expect(() => buildB0(1, setIntensity(-1), KEEP)).toThrow(RangeError);
		expect(() => buildB0(1, setIntensity(1.5), KEEP)).toThrow(RangeError);
		expect(() => buildB0(1, setIntensity(1, new Uint8Array(7)), KEEP)).toThrow(RangeError);
		expect(() => buildBF(201, 10)).toThrow(RangeError);
		expect(() => buildBF(10, 10, { fbA: 256 })).toThrow(RangeError);
	});

	it('builds BF and the LED frame', () => {
		expect(toHex(buildBF(60, 60))).toBe('BF3C3CA0A00000');
		expect(toHex(buildLed('purple'))).toBe('5002' + '00'.repeat(15));
		expect(buildLed('green')).toHaveLength(17);
	});

	it('parses the notifications seen on hardware', () => {
		expect(parseNotification(fromHex('B1020200'))).toMatchObject({ kind: 'intensity', seq: 2, a: 2, b: 0 });
		expect(parseNotification(fromHex('E0ED01'))).toMatchObject({ kind: 'unsupported', cmd: 'ED' });
		expect(parseNotification(fromHex('5300D5B1AC74')).kind).toBe('identity');
		expect(parseNotification(fromHex('F1010000')).kind).toBe('accessory');
	});

	it('recognises supported and recovery names', () => {
		expect(isCoyoteName('47L121000')).toBe(true);
		for (const n of ['47L121000_O3', '47L121000_OFF', 'Dfu12345']) {
			expect(coyoteNameKind(n)).toBe('recovery');
			expect(isCoyoteName(n)).toBe(false);
		}
		expect(coyoteNameKind('SomethingElse')).toBeNull();
		expect(coyoteNameKind(undefined)).toBeNull();
	});

	it('describes the Coyote 3.0 with keys only', () => {
		expect(COYOTE_3).toMatchObject({ id: 'coyote-3', advertisedName: '47L121000' });
		expect(COYOTE_3.channels).toEqual([
			{ id: 'a', role: 'estim', steps: 200 },
			{ id: 'b', role: 'estim', steps: 200 }
		]);
		expect(COYOTE_3.background).toEqual({ vibration: 'off', estim: 'off' });
		expect(COYOTE_3.capabilities).toMatchObject({
			dials: true,
			stopsWithoutFrames: true,
			buzzesOnConnect: false
		});
		expect(COYOTE_3.ble.service).toBe('0000180c-0000-1000-8000-00805f9b34fb');
		expect(COYOTE_3.ble.services).toEqual([
			{
				uuid: '0000180a-0000-1000-8000-00805f9b34fb',
				characteristics: [
					'00001500-0000-1000-8000-00805f9b34fb',
					'00001501-0000-1000-8000-00805f9b34fb',
					'00001502-0000-1000-8000-00805f9b34fb'
				]
			}
		]);
	});
});
