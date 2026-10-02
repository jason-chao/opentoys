// A simulated Dragon S1 for tests and the app's demo mode.
//
// Defaults mirror the hardware (reference spec §8, verified 2026-09-27/29): header 0x56 (plain), silent until
// written to, a status frame `56 01 06 hw fw battery 00 00 00 sum` in reply to *every* write after 60–100 ms, no
// answer to the MAC/chip queries, absolute level bytes per channel (0 = off), the stop command silencing
// vibration only, levels held while nothing is written, both channels off on a clean disconnect, and a buzz on
// every new connection. A lost link (range) leaves the levels running: "the ring may still be running".
// Options simulate other firmware (announcing, scrambled 0x58, answering the info queries, legacy).
//
// FakeRing is the physical ring (it outlives connections); connect() opens a link to it, which is the Transport.
import { type Clock, systemClock, type TimerHandle } from '../clock.ts';
import { Emitter } from '../emitter.ts';
import * as P from '../protocol/index.ts';
import type { DisconnectInfo, Transport } from '../transport.ts';
import { S1_CHAR_NOTIFY, S1_CHAR_WRITE } from '../s1/model.ts';

export interface FakeRingOptions {
	header?: number;
	battery?: number;
	fw?: number;
	hw?: number;
	mac?: string;
	/** Announce the header by itself once notifications are enabled (the S1 does not). */
	announce?: boolean;
	announceDelayMs?: number;
	answerPoll?: boolean;
	answerWrites?: boolean;
	answersInfo?: boolean;
	legacy?: boolean;
	/** Reply latency; the hardware answers in 60–100 ms. */
	replyDelayMs?: number | (() => number);
	/** Characteristics the ring exposes (default: the S1's write and notify). */
	characteristics?: readonly string[];
	clock?: Clock;
}

export interface FakeRingOutput {
	/** Level bytes as the ring holds them. */
	readonly vibByte: number;
	readonly estimByte: number;
	/** The same as fractions 0..1. */
	readonly vibration: number;
	readonly estim: number;
}

export interface FakeRingEvents {
	/** The physical output changed. */
	output: FakeRingOutput;
	/** A new connection: the real ring buzzes by itself (announce it in the UI). */
	buzz: { at: number };
	/** Every write that reached the ring. */
	write: { at: number; data: Uint8Array };
	link: { connected: boolean; clean: boolean };
}

export class FakeRing extends Emitter<FakeRingEvents> {
	header: number;
	battery: number;
	fw: number;
	hw: number;
	mac: string;
	announce: boolean;
	announceDelayMs: number;
	answerPoll: boolean;
	answerWrites: boolean;
	answersInfo: boolean;
	legacy: boolean;
	replyDelayMs: number | (() => number);
	characteristics: readonly string[];
	/** Make writes fail (a radio error). */
	failWrites = false;
	vib = 0;
	estim = 0;
	stops = 0;
	readonly writes: { at: number; data: Uint8Array }[] = [];
	/** Plaintext of every decoded frame. */
	readonly frames: { at: number; plain: Uint8Array }[] = [];
	/** Level bytes per levels frame. */
	readonly levels: { at: number; vib: number; estim: number }[] = [];
	readonly clock: Clock;
	private link: FakeRingLink | null = null;

	constructor(opts: FakeRingOptions = {}) {
		super();
		this.header = opts.header ?? 0x56;
		this.battery = opts.battery ?? 87;
		this.fw = opts.fw ?? 1;
		this.hw = opts.hw ?? 1;
		this.mac = opts.mac ?? 'C0:FF:EE:00:00:01';
		this.announce = opts.announce ?? false;
		this.announceDelayMs = opts.announceDelayMs ?? 50;
		this.answerPoll = opts.answerPoll ?? true;
		this.answerWrites = opts.answerWrites ?? true;
		this.answersInfo = opts.answersInfo ?? false;
		this.legacy = opts.legacy ?? false;
		this.replyDelayMs = opts.replyDelayMs ?? (() => 60 + Math.random() * 40);
		this.characteristics = opts.characteristics ?? [S1_CHAR_WRITE, S1_CHAR_NOTIFY];
		this.clock = opts.clock ?? systemClock;
	}

	/** The physical output right now. */
	get output(): FakeRingOutput {
		return { vibByte: this.vib, estimByte: this.estim, vibration: this.vib / 255, estim: this.estim / 255 };
	}

	get connected(): boolean {
		return this.link?.connected ?? false;
	}

	/** Open a new connection (a previous one still open is lost first). The ring buzzes. */
	connect(): FakeRingLink {
		if (this.link?.connected) this.loseLink();
		this.link = new FakeRingLink(this);
		this.emit('buzz', { at: this.clock.now() });
		this.emit('link', { connected: true, clean: true });
		return this.link;
	}

	/** The radio link goes away without a clean disconnect (range): the ring keeps its levels running. */
	loseLink(): void {
		this.link?.end(false);
	}

	/** Output as the ring's own button would end it. */
	switchOff(): void {
		this.setOutput(0, 0);
		this.link?.end(false);
	}

	/** @internal Called by the link. */
	linkEnded(link: FakeRingLink, clean: boolean): void {
		if (link !== this.link) return;
		if (clean) this.setOutput(0, 0); // a clean disconnect stops both channels
		this.emit('link', { connected: false, clean });
	}

	private setOutput(vib: number, estim: number): void {
		if (vib === this.vib && estim === this.estim) return;
		this.vib = vib;
		this.estim = estim;
		this.emit('output', this.output);
	}

	/** @internal A write arriving over `link`. */
	receive(link: FakeRingLink, input: Uint8Array): void {
		const data = input.slice();
		const now = this.clock.now();
		this.writes.push({ at: now, data });
		this.emit('write', { at: now, data });
		if (P.bytesEqual(data, P.LEGACY_POLL)) {
			if (this.answerPoll) this.statusTo(link);
			return;
		}
		if (this.answerWrites && !this.legacy) this.statusTo(link); // the hardware answers any write, valid or not
		if (data.length < 3 || !P.isNewHeader(data[0]) || this.legacy) return;
		let plain = data;
		if (P.isScrambledHeader(data[0])) {
			if (data.length !== 1 + P.BLOCK) return;
			plain = new Uint8Array(P.BLOCK);
			plain[0] = data[0]!;
			plain.set(P.openBlock(data.subarray(1)), 1);
		}
		this.frames.push({ at: now, plain });
		const cmd = plain[1];
		if (cmd === P.CMD_LEVELS) {
			this.levels.push({ at: now, vib: plain[3]!, estim: plain[7]! });
			this.setOutput(plain[3]!, plain[7]!);
		} else if (cmd === P.CMD_STOP) {
			this.stops++;
			this.setOutput(0, this.estim); // the S1's stop command leaves e-stim running
		} else if (this.answersInfo && cmd === P.CMD_INFO && plain[2] === P.SUB_MAC) {
			const mac = this.mac.split(':').map((x) => parseInt(x, 16));
			this.later(link, P.toWire(P.frame(this.header, P.CMD_INFO, P.SUB_MAC, mac)));
		} else if (this.answersInfo && cmd === P.CMD_INFO && plain[2] === P.SUB_CHIP) {
			this.later(link, P.toWire(P.frame(this.header, P.CMD_INFO, P.SUB_CHIP, [0x36, 0x02])));
		}
	}

	/** @internal Notifications were enabled on `link`. */
	subscribed(link: FakeRingLink): void {
		if (this.announce) link.schedule(this.announceDelayMs, () => this.statusTo(link, true));
	}

	private statusTo(link: FakeRingLink, now = false): void {
		const wire = this.legacy
			? Uint8Array.of(0x01, 0, 0, 0, this.fw, 0, this.battery, 0)
			: P.toWire(P.frame(this.header, P.CMD_STATUS, 0, [this.hw, this.fw, this.battery, 0, 0, 0]));
		if (now) link.notify(wire);
		else this.later(link, wire);
	}

	private later(link: FakeRingLink, wire: Uint8Array): void {
		const d = this.replyDelayMs;
		link.schedule(typeof d === 'number' ? d : d(), () => link.notify(wire));
	}
}

/** One connection to a FakeRing: the Transport the driver talks to. */
export class FakeRingLink implements Transport {
	private listener: ((data: Uint8Array) => void) | null = null;
	private disconnectListeners = new Set<(info: DisconnectInfo) => void>();
	private timers = new Set<TimerHandle>();
	private open = true;
	private readonly ring: FakeRing;

	constructor(ring: FakeRing) {
		this.ring = ring;
	}

	get connected(): boolean {
		return this.open;
	}

	hasCharacteristic(uuid: string): boolean {
		return this.ring.characteristics.includes(uuid.toLowerCase());
	}

	async write(characteristic: string, data: Uint8Array): Promise<void> {
		if (!this.open) throw new Error('not connected');
		if (this.ring.failWrites) throw new Error('write failed');
		if (characteristic.toLowerCase() !== S1_CHAR_WRITE || !this.hasCharacteristic(characteristic))
			throw new Error(`cannot write to ${characteristic}`);
		this.ring.receive(this, data);
	}

	/** The S1 has nothing to read: everything arrives as notifications. */
	async read(characteristic: string): Promise<Uint8Array> {
		throw new Error(`cannot read ${characteristic}`);
	}

	async subscribe(characteristic: string, listener: (data: Uint8Array) => void): Promise<void> {
		if (!this.open) throw new Error('not connected');
		if (characteristic.toLowerCase() !== S1_CHAR_NOTIFY || !this.hasCharacteristic(characteristic))
			throw new Error(`cannot subscribe to ${characteristic}`);
		this.listener = listener;
		this.ring.subscribed(this);
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
		for (const t of this.timers) this.ring.clock.clearTimeout(t);
		this.timers.clear();
		this.ring.linkEnded(this, clean);
		for (const fn of [...this.disconnectListeners]) fn({ requested: clean });
		this.disconnectListeners.clear();
	}

	/** @internal */
	schedule(ms: number, fn: () => void): void {
		const h = this.ring.clock.setTimeout(() => {
			this.timers.delete(h);
			fn();
		}, ms);
		this.timers.add(h);
	}

	/** @internal */
	notify(wire: Uint8Array): void {
		if (this.open) this.listener?.(wire.slice());
	}
}
