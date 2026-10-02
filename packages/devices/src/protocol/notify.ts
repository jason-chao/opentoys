// Parser for notifications from the ring (reference spec §4).
import {
	CMD_INFO,
	CMD_STATUS,
	LEGACY_STATUS,
	SUB_CHIP,
	SUB_MAC,
	checksum,
	isNewHeader,
	isScrambledHeader
} from './frame.ts';
import { BLOCK, openBlock } from './scramble.ts';

export type NotificationKind = 'status' | 'chip' | 'mac' | 'info' | 'frame' | 'legacy-status' | 'ignored';

export interface NotificationFields {
	cmd?: number;
	hw?: number;
	fw?: number;
	battery?: number;
	stateByte?: number;
	model?: number;
	vendor?: number;
	mac?: string;
	sub?: number;
	heater?: boolean;
}

export interface Notification {
	kind: NotificationKind;
	/** The protocol header this notification announces (new family only). */
	header: number | null;
	/** Header + payload after unscrambling. */
	plain: Uint8Array;
	fields: NotificationFields;
	/** null when the frame is too short to tell. */
	crcOk: boolean | null;
}

/** [content start, content length, checksum index], or null if p is too short to have a length byte. */
function layout(p: Uint8Array): [number, number, number] | null {
	const start = p[1] === CMD_INFO ? 4 : 3; // only the info replies carry a sub id
	if (p.length < start) return null;
	const n = p[start - 1]!;
	return [start, n, start + n];
}

export function parse(input: ArrayLike<number>): Notification {
	const data = Uint8Array.from(input);
	if (data.length < 2) return { kind: 'ignored', header: null, plain: data, fields: {}, crcOk: null };
	const b0 = data[0]!;
	if (b0 === LEGACY_STATUS) {
		const f: NotificationFields = {};
		if (data.length > 4) f.fw = data[4]!;
		if (data.length > 6) f.battery = data[6]! >= 98 ? 100 : data[6]!;
		if (data.length > 7) f.heater = data[7] === 1;
		return { kind: 'legacy-status', header: null, plain: data, fields: f, crcOk: null };
	}
	if (!isNewHeader(b0)) return { kind: 'ignored', header: null, plain: data, fields: {}, crcOk: null };
	let p = data;
	if (isScrambledHeader(b0)) {
		if (data.length !== 1 + BLOCK)
			return { kind: 'ignored', header: b0, plain: data, fields: {}, crcOk: null };
		p = new Uint8Array(BLOCK);
		p[0] = b0;
		p.set(openBlock(data.subarray(1)), 1); // padding kept: fields stay at fixed offsets
	}
	const lay = layout(p);
	let crcOk: boolean | null = null;
	if (lay !== null) {
		const s = lay[2];
		if (s < p.length) crcOk = p[s] === checksum(p.subarray(0, s));
	}
	const cmd = p[1]!;
	let f: NotificationFields = {};
	let kind: NotificationKind = 'frame';
	if (cmd === CMD_STATUS) {
		kind = 'status';
		if (p.length > 3) f.hw = p[3]!;
		if (p.length > 4) f.fw = p[4]!;
		if (p.length > 5) f.battery = p[5]!;
		if (p.length > 7) f.stateByte = p[7]!;
	} else if (cmd === CMD_INFO && p.length > 2) {
		const sub = p[2]!;
		if (sub === SUB_CHIP && p.length > 5) {
			kind = 'chip';
			f = { model: p[4]!, vendor: p[5]! };
		} else if (sub === SUB_MAC && p.length > 9) {
			kind = 'mac';
			f = {
				mac: Array.from(p.subarray(4, 10), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
			};
		} else {
			kind = 'info';
			f = { sub };
		}
	}
	f.cmd = cmd;
	return { kind, header: b0, plain: p, fields: f, crcOk };
}
