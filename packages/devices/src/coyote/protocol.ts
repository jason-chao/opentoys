// Wire protocol of the Coyote 3.0 (everything over one write characteristic, replies on one notify
// characteristic; published by DG-LAB, verified in the reference implementation on firmware 7):
//
//   B0 seq|types iA iB  A[8]  B[8]   pulse frame, every 100 ms         → B1 seq iA iB (only if seq ≠ 0)
//   BF maxA maxB fbA fbB sbA sbB     soft caps and balance
//   50 n 00…                         LED colour
//   E0 cmd 01                        "unsupported command" reply (seen on firmware 7)
//   anything else                    accessory traffic and extras this app does not use
//
// Not here: storing waveforms on the device, strength mode, accessories.
import { toHex } from '../protocol/bytes.ts';
import { COYOTE_INTENSITY_MAX } from './model.ts';

/** How a B0 frame's intensity byte is to be read, per channel. */
export const T_KEEP = 0;
export const T_INC = 1;
export const T_DEC = 2;
export const T_SET = 3;
export type IntensityType = 0 | 1 | 2 | 3;

export interface ChannelCommand {
	readonly type: IntensityType;
	/** Delta or absolute target, 0..200. */
	readonly value: number;
	/** The 8 wire bytes f0 f1 f2 f3 s0 s1 s2 s3 (four 25 ms slots); null = a silent frame. */
	readonly payload: Uint8Array | null;
}

/** Frequency 10 (the lowest valid), strength 0. */
export const SILENT_PAYLOAD: Uint8Array = Uint8Array.of(10, 10, 10, 10, 0, 0, 0, 0);

export const KEEP: ChannelCommand = { type: T_KEEP, value: 0, payload: null };

export function setIntensity(value: number, payload: Uint8Array | null = null): ChannelCommand {
	return { type: T_SET, value, payload };
}

export function keepIntensity(payload: Uint8Array | null = null): ChannelCommand {
	return { type: T_KEEP, value: 0, payload };
}

function isByteIn(v: number, hi: number): boolean {
	return Number.isInteger(v) && v >= 0 && v <= hi;
}

/** `seq` 0 asks for no answer; 1..15 is answered with B1 carrying the device's actual intensities. */
export function buildB0(seq: number, a: ChannelCommand, b: ChannelCommand): Uint8Array {
	if (!isByteIn(seq, 15)) throw new RangeError('seq 0..15');
	for (const c of [a, b]) {
		if (!isByteIn(c.type, 3) || !isByteIn(c.value, COYOTE_INTENSITY_MAX))
			throw new RangeError('bad channel command');
		if (c.payload !== null && c.payload.length !== 8) throw new RangeError('payload must be 8 bytes');
	}
	const out = new Uint8Array(20);
	out[0] = 0xb0;
	out[1] = (seq << 4) | (a.type << 2) | b.type;
	out[2] = a.value;
	out[3] = b.value;
	out.set(a.payload ?? SILENT_PAYLOAD, 4);
	out.set(b.payload ?? SILENT_PAYLOAD, 12);
	return out;
}

export interface Balance {
	/** Frequency balance per channel (0..255; the device's default is 160). */
	fbA?: number;
	fbB?: number;
	/** Strength balance per channel (0..255). */
	sbA?: number;
	sbB?: number;
}

/** Device-side soft caps (0..200 per channel) and balance. */
export function buildBF(maxA: number, maxB: number, balance: Balance = {}): Uint8Array {
	const { fbA = 160, fbB = 160, sbA = 0, sbB = 0 } = balance;
	if (!isByteIn(maxA, COYOTE_INTENSITY_MAX) || !isByteIn(maxB, COYOTE_INTENSITY_MAX))
		throw new RangeError('BF parameter out of range');
	for (const v of [fbA, fbB, sbA, sbB])
		if (!isByteIn(v, 255)) throw new RangeError('BF parameter out of range');
	return Uint8Array.of(0xbf, maxA, maxB, fbA, fbB, sbA, sbB);
}

/** Keys for the LED colours, in the device's order (the app translates them). */
export const LED_COLOURS = ['yellow', 'red', 'purple', 'blue', 'cyan', 'green'] as const;
export type LedColour = (typeof LED_COLOURS)[number];

/** "50 0n" + 15 zero bytes. */
export function buildLed(colour: LedColour): Uint8Array {
	const out = new Uint8Array(17);
	out[0] = 0x50;
	out[1] = Math.max(0, LED_COLOURS.indexOf(colour));
	return out;
}

export type CoyoteNotification =
	/** B1: the device's intensities, in answer to frame `seq` or (seq 0) because a dial was turned. */
	| { kind: 'intensity'; seq: number; a: number; b: number; raw: string }
	/** E0: the firmware does not know command `cmd` (two hex digits). */
	| { kind: 'unsupported'; cmd: string; raw: string }
	| { kind: 'identity'; tail: string; raw: string }
	| { kind: 'strength-mode'; raw: string }
	/** Replies to commands this app does not send, or does not wait for (LED ack). */
	| { kind: 'reply'; cmd: string; raw: string }
	| { kind: 'accessory'; raw: string }
	| { kind: 'unknown'; raw: string };

const REPLY_CODES = [0xed, 0x0e, 0xc3, 0xc4, 0x0d, 0xa1, 0xa3, 0xa4, 0xae, 0x51];

const hex2 = (b: number): string => b.toString(16).padStart(2, '0').toUpperCase();

export function parseNotification(data: ArrayLike<number>): CoyoteNotification {
	const raw = toHex(data);
	if (data.length === 0) return { kind: 'unknown', raw };
	const c = data[0]!;
	if (c === 0xb1 && data.length >= 4)
		return { kind: 'intensity', seq: data[1]!, a: data[2]!, b: data[3]!, raw };
	if (c === 0xe0 && data.length >= 2) return { kind: 'unsupported', cmd: hex2(data[1]!), raw };
	if (c === 0x53) return { kind: 'identity', tail: raw.slice(4), raw };
	if (c === 0xbd) return { kind: 'strength-mode', raw };
	if (REPLY_CODES.includes(c)) return { kind: 'reply', cmd: hex2(c), raw };
	return { kind: 'accessory', raw };
}
