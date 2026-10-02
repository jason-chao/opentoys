// Frame builder for the ring's command channel (reference spec §2–3).
//
//     HDR CMD [SUB if SUB > 0] LEN CONTENT… SUM        SUM = 8-bit sum of every preceding byte
//
// HDR is learned from the device (0x55..0x58). Frames with HDR 0x55/0x58 are scrambled on the wire.
import { seal } from './scramble.ts';

export const NEW_HEADERS: readonly number[] = [0x55, 0x56, 0x57, 0x58];
export const SCRAMBLED_HEADERS: readonly number[] = [0x55, 0x58];

export const CMD_STATUS = 0x01;
export const CMD_LEVELS = 0x02;
export const CMD_STOP = 0x05;
export const CMD_INFO = 0x06;
export const SUB_CHIP = 0x01;
export const SUB_MAC = 0x02;

export const LEGACY_STATUS = 0x01;
/** The vendor's info poll; answered by legacy firmware, harmless otherwise (the S1 answers it with status). */
export const LEGACY_POLL: Uint8Array = Uint8Array.of(0x01);

export function isNewHeader(hdr: number | null | undefined): hdr is number {
	return hdr != null && NEW_HEADERS.includes(hdr);
}

export function isScrambledHeader(hdr: number | null | undefined): boolean {
	return hdr != null && SCRAMBLED_HEADERS.includes(hdr);
}

/** Fraction 0..1 → byte, truncating like the vendor; clamped (the vendor does not clamp). */
export function level(x: number): number {
	if (!Number.isFinite(x)) return 0;
	return Math.trunc(Math.min(Math.max(x, 0), 1) * 255);
}

export function checksum(body: ArrayLike<number>): number {
	let s = 0;
	for (let i = 0; i < body.length; i++) s += body[i]!;
	return s & 0xff;
}

function checkHeader(hdr: number): number {
	if (!NEW_HEADERS.includes(hdr))
		throw new RangeError(`header 0x${hdr.toString(16)} is not a known protocol header`);
	return hdr;
}

export function frame(hdr: number, cmd: number, sub: number, content: ArrayLike<number>): Uint8Array {
	const body = [checkHeader(hdr), cmd & 0xff];
	if (sub > 0) body.push(sub & 0xff);
	body.push(content.length & 0xff);
	for (let i = 0; i < content.length; i++) body.push(content[i]! & 0xff);
	body.push(checksum(body));
	return Uint8Array.from(body);
}

/** Vibration and e-stim; the three channels the ring does not have are sent as zero. */
export function levels(hdr: number, vib: number, estim: number): Uint8Array {
	return frame(hdr, CMD_LEVELS, 0, [level(vib), 0, 0, 0, level(estim)]);
}

/** The stop command. On the S1 it stops vibration only: e-stim keeps going (SPEC §8). */
export function stop(hdr: number): Uint8Array {
	return frame(hdr, CMD_STOP, 1, [0x01]);
}

export function queryMac(hdr: number): Uint8Array {
	return frame(hdr, CMD_INFO, SUB_MAC, [0x01]);
}

export function queryChip(hdr: number): Uint8Array {
	return frame(hdr, CMD_INFO, SUB_CHIP, [0x01]);
}

/** What goes to the write characteristic for a plaintext frame (`nonce` is injectable for tests). */
export function toWire(plain: Uint8Array, nonce?: number): Uint8Array {
	if (plain.length > 0 && isScrambledHeader(plain[0])) {
		const sealed = seal(plain.subarray(1), nonce);
		const out = new Uint8Array(1 + sealed.length);
		out[0] = plain[0]!;
		out.set(sealed, 1);
		return out;
	}
	return plain.slice();
}
