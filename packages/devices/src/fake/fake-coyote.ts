// A simulated Coyote 3.0 for tests and the app's preview.
//
// Mimics what firmware 7 was observed to do (the reference implementation, 2026-09-16): version, battery and MAC can be read;
// battery is notified once a second; a B0 frame sets the intensities and carries 100 ms of output per channel,
// and is answered with `B1 seq iA iB` when seq ≠ 0; output drains by itself when frames stop; BF sets soft
// caps; turning a dial changes the intensity and reports it unasked (B1 with seq 0); commands the firmware does
// not know get `E0 cmd 01`. Assumed, not verified: the soft cap also bounds the dials and SET frames, and the
// intensity setting survives a lost link (output still drains).
//
// FakeCoyote is the physical device (it outlives connections); connect() opens a link to it: the Transport.
import { type Clock, systemClock, type TimerHandle } from '../clock.ts';
import {
	COYOTE_CHAR_BATTERY,
	COYOTE_CHAR_MAC,
	COYOTE_CHAR_NOTIFY,
	COYOTE_CHAR_VERSION,
	COYOTE_CHAR_WRITE,
	COYOTE_INTENSITY_MAX,
	type CoyoteChannel
} from '../coyote/model.ts';
import { T_DEC, T_INC, T_SET } from '../coyote/protocol.ts';
import { Emitter } from '../emitter.ts';
import { bytesEqual, fromHex } from '../protocol/bytes.ts';
import type { DisconnectInfo, Transport } from '../transport.ts';

export interface FakeCoyoteOptions {
	fwVersion?: number;
	fwLabel?: number;
	battery?: number;
	mac?: string;
	/** How long the device takes to answer a write. */
	replyDelayMs?: number;
	/** Output stops this long after the last frame (a frame carries 100 ms). */
	drainMs?: number;
	/** Battery notifications; 0 = none. */
	batteryPeriodMs?: number;
	/** Characteristics the device exposes (default: write, notify, battery, version, MAC). */
	characteristics?: readonly string[];
	clock?: Clock;
}

export interface FakeCoyoteChannelOutput {
	/** The device's intensity setting, 0..200. */
	readonly intensity: number;
	/** The last 8-byte payload (f0 f1 f2 f3 s0 s1 s2 s3) while it is still being output; null once drained. */
	readonly payload: Uint8Array | null;
	/** Something is felt: intensity above 0 and a payload with strength in it. */
	readonly active: boolean;
}

export interface FakeCoyoteOutput {
	readonly a: FakeCoyoteChannelOutput;
	readonly b: FakeCoyoteChannelOutput;
}

export interface FakeCoyoteEvents {
	/** The physical output changed (intensity or payload). */
	output: FakeCoyoteOutput;
	/** Every write that reached the device. */
	write: { at: number; data: Uint8Array };
	/** A dial was turned on the device. */
	dial: { channel: CoyoteChannel; value: number };
	link: { connected: boolean; clean: boolean };
}

const IDX: Record<CoyoteChannel, 0 | 1> = { a: 0, b: 1 };
const UNKNOWN_ON_FW7 = [0xed, 0x0e, 0xc3, 0xc4, 0x0d];

export class FakeCoyote extends Emitter<FakeCoyoteEvents> {
	fwVersion: number;
	fwLabel: number;
	battery: number;
	mac: string;
	replyDelayMs: number;
	drainMs: number;
	batteryPeriodMs: number;
	characteristics: readonly string[];
	/** Make writes fail (a radio error). */
	failWrites = false;
	/** Answer numbered frames with B1 (switch off to simulate a link that has silently died). */
	answerFrames = true;
	readonly intensity: [number, number] = [0, 0];
	readonly caps: [number, number] = [COYOTE_INTENSITY_MAX, COYOTE_INTENSITY_MAX];
	readonly writes: { at: number; data: Uint8Array }[] = [];
	/** Every B0 frame received. */
	readonly frames: { at: number; data: Uint8Array }[] = [];
	led = 0;
	readonly clock: Clock;
	private payloads: [Uint8Array | null, Uint8Array | null] = [null, null];
	private drainTimer: TimerHandle | null = null;
	private link: FakeCoyoteLink | null = null;

	constructor(opts: FakeCoyoteOptions = {}) {
		super();
		this.fwVersion = opts.fwVersion ?? 7;
		this.fwLabel = opts.fwLabel ?? 3;
		this.battery = opts.battery ?? 100;
		this.mac = opts.mac ?? 'FA:0E:00:00:00:01';
		this.replyDelayMs = opts.replyDelayMs ?? 20;
		this.drainMs = opts.drainMs ?? 150;
		this.batteryPeriodMs = opts.batteryPeriodMs ?? 1000;
		this.characteristics = opts.characteristics ?? [
			COYOTE_CHAR_WRITE,
			COYOTE_CHAR_NOTIFY,
			COYOTE_CHAR_BATTERY,
			COYOTE_CHAR_VERSION,
			COYOTE_CHAR_MAC
		];
		this.clock = opts.clock ?? systemClock;
	}

	/** The physical output right now. */
	get output(): FakeCoyoteOutput {
		const ch = (i: 0 | 1): FakeCoyoteChannelOutput => {
			const payload = this.payloads[i];
			const strong = payload !== null && payload.subarray(4).some((s) => s > 0);
			return { intensity: this.intensity[i], payload, active: this.intensity[i] > 0 && strong };
		};
		return { a: ch(0), b: ch(1) };
	}

	get connected(): boolean {
		return this.link?.connected ?? false;
	}

	/** Open a new connection (a previous one still open is lost first). */
	connect(): FakeCoyoteLink {
		if (this.link?.connected) this.loseLink();
		this.link = new FakeCoyoteLink(this);
		this.emit('link', { connected: true, clean: true });
		return this.link;
	}

	/** The radio link goes away: no more frames arrive, so output drains by itself. */
	loseLink(): void {
		this.link?.end(false);
	}

	/** The user turns a dial on the device: the intensity changes and is reported unasked. */
	turnDial(channel: CoyoteChannel, value: number): void {
		const i = IDX[channel];
		const v = Math.min(Math.max(Math.trunc(value), 0), this.caps[i]);
		this.intensity[i] = v;
		this.emit('dial', { channel, value: v });
		this.emit('output', this.output);
		this.link?.notify(COYOTE_CHAR_NOTIFY, Uint8Array.of(0xb1, 0, this.intensity[0], this.intensity[1]));
	}

	/** @internal Called by the link. */
	linkEnded(link: FakeCoyoteLink, clean: boolean): void {
		if (link !== this.link) return;
		this.emit('link', { connected: false, clean });
	}

	/** @internal A read over `link`. */
	read(characteristic: string): Uint8Array {
		switch (characteristic) {
			case COYOTE_CHAR_VERSION:
				return Uint8Array.of(this.fwVersion, this.fwLabel);
			case COYOTE_CHAR_BATTERY:
				return Uint8Array.of(this.battery);
			case COYOTE_CHAR_MAC:
				return fromHex(this.mac.replace(/:/g, ''));
			default:
				throw new Error(`cannot read ${characteristic}`);
		}
	}

	/** @internal Notifications were enabled on `link`. */
	subscribed(link: FakeCoyoteLink, characteristic: string): void {
		if (characteristic === COYOTE_CHAR_NOTIFY) {
			const tail = fromHex(this.mac.replace(/:/g, '')).subarray(2);
			link.schedule(this.replyDelayMs, () =>
				link.notify(COYOTE_CHAR_NOTIFY, Uint8Array.of(0x53, 0, ...tail))
			);
		} else if (characteristic === COYOTE_CHAR_BATTERY && this.batteryPeriodMs > 0) {
			const tick = (): void => {
				link.notify(COYOTE_CHAR_BATTERY, Uint8Array.of(this.battery));
				link.schedule(this.batteryPeriodMs, tick);
			};
			link.schedule(this.batteryPeriodMs, tick);
		}
	}

	/** @internal A write arriving over `link`. */
	receive(link: FakeCoyoteLink, input: Uint8Array): void {
		const d = input.slice();
		const now = this.clock.now();
		this.writes.push({ at: now, data: d });
		this.emit('write', { at: now, data: d });
		const c = d[0];
		if (c === 0xb0 && d.length === 20) this.frame(link, d, now);
		else if (c === 0xbf && d.length === 7) {
			this.caps[0] = Math.min(d[1]!, COYOTE_INTENSITY_MAX);
			this.caps[1] = Math.min(d[2]!, COYOTE_INTENSITY_MAX);
			const before = [...this.intensity];
			this.intensity[0] = Math.min(this.intensity[0], this.caps[0]);
			this.intensity[1] = Math.min(this.intensity[1], this.caps[1]);
			if (before[0] !== this.intensity[0] || before[1] !== this.intensity[1])
				this.emit('output', this.output);
		} else if (c === 0x50 && d.length === 17) {
			this.led = d[1]!;
			this.reply(link, Uint8Array.of(0x51, 0x00, 0x10, 0x64));
		} else if (c !== undefined && UNKNOWN_ON_FW7.includes(c) && this.fwVersion < 8) {
			this.reply(link, Uint8Array.of(0xe0, c, 1));
		}
	}

	private frame(link: FakeCoyoteLink, d: Uint8Array, now: number): void {
		this.frames.push({ at: now, data: d });
		const before = this.output;
		const seq = d[1]! >> 4;
		const types = [(d[1]! >> 2) & 3, d[1]! & 3];
		for (const i of [0, 1] as const) {
			const v = d[2 + i]!;
			let next = this.intensity[i];
			if (types[i] === T_SET) next = v;
			else if (types[i] === T_INC) next += v;
			else if (types[i] === T_DEC) next -= v;
			this.intensity[i] = Math.min(Math.max(next, 0), this.caps[i]);
			this.payloads[i] = d.slice(4 + 8 * i, 12 + 8 * i);
		}
		if (this.drainTimer !== null) this.clock.clearTimeout(this.drainTimer);
		this.drainTimer = this.clock.setTimeout(() => {
			this.drainTimer = null;
			this.payloads = [null, null];
			this.emit('output', this.output);
		}, this.drainMs);
		if (!sameOutput(before, this.output)) this.emit('output', this.output);
		if (seq !== 0 && this.answerFrames) {
			// The answer carries the intensities as they are when it leaves.
			link.schedule(this.replyDelayMs, () =>
				link.notify(COYOTE_CHAR_NOTIFY, Uint8Array.of(0xb1, seq, this.intensity[0], this.intensity[1]))
			);
		}
	}

	private reply(link: FakeCoyoteLink, data: Uint8Array): void {
		link.schedule(this.replyDelayMs, () => link.notify(COYOTE_CHAR_NOTIFY, data));
	}
}

function sameOutput(x: FakeCoyoteOutput, y: FakeCoyoteOutput): boolean {
	const same = (p: FakeCoyoteChannelOutput, q: FakeCoyoteChannelOutput): boolean =>
		p.intensity === q.intensity &&
		(p.payload === null || q.payload === null ? p.payload === q.payload : bytesEqual(p.payload, q.payload));
	return same(x.a, y.a) && same(x.b, y.b);
}

/** One connection to a FakeCoyote: the Transport the driver talks to. */
export class FakeCoyoteLink implements Transport {
	private listeners = new Map<string, (data: Uint8Array) => void>();
	private disconnectListeners = new Set<(info: DisconnectInfo) => void>();
	private timers = new Set<TimerHandle>();
	private open = true;
	private readonly dev: FakeCoyote;

	constructor(dev: FakeCoyote) {
		this.dev = dev;
	}

	get connected(): boolean {
		return this.open;
	}

	hasCharacteristic(uuid: string): boolean {
		return this.dev.characteristics.includes(uuid.toLowerCase());
	}

	private check(characteristic: string): string {
		if (!this.open) throw new Error('not connected');
		const uuid = characteristic.toLowerCase();
		if (!this.hasCharacteristic(uuid)) throw new Error(`characteristic ${characteristic} not available`);
		return uuid;
	}

	async read(characteristic: string): Promise<Uint8Array> {
		return this.dev.read(this.check(characteristic));
	}

	async write(characteristic: string, data: Uint8Array): Promise<void> {
		const uuid = this.check(characteristic);
		if (this.dev.failWrites) throw new Error('write failed');
		if (uuid !== COYOTE_CHAR_WRITE) throw new Error(`cannot write to ${characteristic}`);
		this.dev.receive(this, data);
	}

	async subscribe(characteristic: string, listener: (data: Uint8Array) => void): Promise<void> {
		const uuid = this.check(characteristic);
		if (uuid !== COYOTE_CHAR_NOTIFY && uuid !== COYOTE_CHAR_BATTERY)
			throw new Error(`cannot subscribe to ${characteristic}`);
		this.listeners.set(uuid, listener);
		this.dev.subscribed(this, uuid);
	}

	onDisconnect(listener: (info: DisconnectInfo) => void): () => void {
		this.disconnectListeners.add(listener);
		return () => this.disconnectListeners.delete(listener);
	}

	async disconnect(): Promise<void> {
		this.end(true);
	}

	/** @internal */
	end(clean: boolean): void {
		if (!this.open) return;
		this.open = false;
		for (const t of this.timers) this.dev.clock.clearTimeout(t);
		this.timers.clear();
		this.dev.linkEnded(this, clean);
		for (const fn of [...this.disconnectListeners]) fn({ requested: clean });
		this.disconnectListeners.clear();
	}

	/** @internal */
	schedule(ms: number, fn: () => void): void {
		const h = this.dev.clock.setTimeout(() => {
			this.timers.delete(h);
			fn();
		}, ms);
		this.timers.add(h);
	}

	/** @internal */
	notify(characteristic: string, data: Uint8Array): void {
		if (this.open) this.listeners.get(characteristic)?.(data.slice());
	}
}
