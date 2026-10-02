// Driver for the Dragon S1 (reference spec §4–5): header learning, identification queries, levels and stop.
import { type Clock, sleep, systemClock } from '../clock.ts';
import { DeviceError, type Device, type DeviceEvent, type DeviceInfo } from '../device.ts';
import { Emitter } from '../emitter.ts';
import type { ChannelLevels } from '../model.ts';
import * as P from '../protocol/index.ts';
import type { DisconnectInfo, Transport } from '../transport.ts';
import { DRAGON_S1, S1_CHAR_NOTIFY, S1_CHAR_WRITE } from './model.ts';

/** Longer than the controller's refresh period: a pause this long starts a new burst of writes. */
export const BURST_GAP_MS = 1500;

export interface S1InitOptions {
	/** How long to wait for a header announced unprompted (the S1 never announces; it answers the 01 poll). */
	waitMs?: number;
	polls?: number;
	pollIntervalMs?: number;
	/** Bring-up only: the header to use if the device never names one. */
	assumeHeader?: number | null;
	infoGapMs?: number;
	/**
	 * The header learned on an earlier connection: a zero frame and the stop command go out before anything
	 * else, because the ring keeps running through a lost link and a reconnection must silence it at once.
	 */
	knownHeader?: number | null;
}

export interface S1Info extends DeviceInfo {
	readonly header: number | null;
	readonly scrambled: boolean;
	readonly fw: number | null;
	readonly hw: number | null;
	readonly mac: string;
	readonly chip: { model: number; vendor: number } | null;
	readonly stateByte: number | null;
	readonly statusAt: number | null;
	readonly crcErrors: number;
}

class Events extends Emitter<{ event: DeviceEvent }> {
	fire(e: DeviceEvent): void {
		this.emit('event', e);
	}
}

export class S1Driver implements Device {
	readonly model = DRAGON_S1;
	header: number | null = null;
	legacySeen = false;
	battery: number | null = null;
	fw: number | null = null;
	hw: number | null = null;
	stateByte: number | null = null;
	statusAt: number | null = null;
	mac = '';
	chip: { model: number; vendor: number } | null = null;
	framesSent = 0;
	notifications = 0;
	crcErrors = 0;
	/** Plaintext of the last frame written. */
	lastSent: Uint8Array | null = null;
	lastWriteAt = -Infinity;
	/** The ring answers every write with a status frame (SPEC §4). */
	lastReplyAt = -Infinity;
	/** First write after a pause of more than BURST_GAP_MS. */
	private burstStart = -Infinity;
	private headerWaiters = new Set<() => void>();
	private events = new Events();
	private readonly t: Transport;
	private readonly clock: Clock;

	constructor(transport: Transport, opts: { clock?: Clock } = {}) {
		this.t = transport;
		this.clock = opts.clock ?? systemClock;
	}

	/** Create the driver and run the handshake; on failure the link is closed again. */
	static async open(transport: Transport, opts: S1InitOptions & { clock?: Clock } = {}): Promise<S1Driver> {
		const dev = new S1Driver(transport, opts);
		try {
			await dev.init(opts);
		} catch (e) {
			await transport.disconnect().catch(() => {});
			throw e;
		}
		return dev;
	}

	get connected(): boolean {
		return this.t.connected;
	}

	get scrambled(): boolean {
		return P.isScrambledHeader(this.header);
	}

	onEvent(listener: (e: DeviceEvent) => void): () => void {
		return this.events.on('event', listener);
	}

	onDisconnect(listener: (info: DisconnectInfo) => void): () => void {
		return this.t.onDisconnect(listener);
	}

	disconnect(): Promise<void> {
		return this.t.disconnect();
	}

	// ----- identification -----------------------------------------------------

	/** Subscribe, learn the header, query MAC and chip, and leave the ring silent. */
	async init(opts: S1InitOptions = {}): Promise<void> {
		const {
			waitMs = 300,
			polls = 3,
			pollIntervalMs = 1000,
			assumeHeader = null,
			infoGapMs = 500,
			knownHeader = null
		} = opts;
		for (const ch of [S1_CHAR_WRITE, S1_CHAR_NOTIFY]) {
			if (!this.t.hasCharacteristic(ch))
				throw new DeviceError(
					'missing-characteristic',
					`characteristic ${ch.slice(4, 8)} missing: not a supported ring`
				);
		}
		await this.t.subscribe(S1_CHAR_NOTIFY, (data) => this.onNotify(data));
		if (P.isNewHeader(knownHeader)) {
			await this.writeRaw(P.toWire(P.levels(knownHeader, 0, 0)));
			await this.writeRaw(P.toWire(P.stop(knownHeader)));
		}
		if (!(await this.waitHeader(waitMs))) {
			for (let i = 0; i < polls; i++) {
				await this.writeRaw(P.LEGACY_POLL);
				if (await this.waitHeader(pollIntervalMs)) break;
			}
		}
		if (this.header === null) {
			if (assumeHeader != null) this.setHeader(assumeHeader);
			else if (this.legacySeen)
				throw new DeviceError('legacy-firmware', 'legacy firmware (no e-stim protocol): not supported');
			else throw new DeviceError('not-identified', 'the device did not identify itself');
		}
		await this.stop();
		await this.queryInfo(infoGapMs);
	}

	private waitHeader(ms: number): Promise<boolean> {
		if (this.header !== null) return Promise.resolve(true);
		return new Promise((resolve) => {
			const done = (): void => {
				this.clock.clearTimeout(timer);
				this.headerWaiters.delete(done);
				resolve(true);
			};
			const timer = this.clock.setTimeout(() => {
				this.headerWaiters.delete(done);
				resolve(this.header !== null);
			}, ms);
			this.headerWaiters.add(done);
		});
	}

	private setHeader(h: number): void {
		if (h !== this.header) {
			this.header = h;
			this.events.fire({ kind: 'header', header: h, scrambled: this.scrambled });
		}
		for (const w of [...this.headerWaiters]) w();
	}

	async queryInfo(gapMs = 500): Promise<void> {
		await this.send(P.queryMac(this.hdr()));
		await sleep(this.clock, gapMs);
		await this.send(P.queryChip(this.hdr()));
	}

	// ----- output -------------------------------------------------------------

	private hdr(): number {
		if (this.header === null) throw new DeviceError('header-unknown', 'protocol header not known yet');
		return this.header;
	}

	/** Each channel's byte is absolute, trunc(x·255); 0 turns that channel off (verified with a wearer, SPEC §8). */
	async writeLevels(vib: number, estim: number): Promise<Uint8Array> {
		const plain = P.levels(this.hdr(), vib, estim);
		await this.send(plain);
		return plain;
	}

	async output(levels: ChannelLevels): Promise<void> {
		await this.writeLevels(levels['vib'] ?? 0, levels['estim'] ?? 0);
	}

	/**
	 * Zero-level frame (silences both channels) then the stop command (silences vibration only: it does not
	 * touch e-stim, SPEC §8); together they stop the ring whatever the firmware variant.
	 */
	async stop(): Promise<void> {
		await this.send(P.levels(this.hdr(), 0, 0));
		await this.send(P.stop(this.hdr()));
	}

	async raw(data: Uint8Array): Promise<void> {
		await this.writeRaw(data.slice());
	}

	/** Ask for a status frame (battery etc.); the ring sends none unless written to. */
	async poll(): Promise<void> {
		await this.writeRaw(P.LEGACY_POLL);
	}

	/**
	 * Milliseconds without an answer while we have been writing. Counted from the last reply or from the start
	 * of the current burst of writes, whichever is later, so a quiet spell before the burst (idle ring, nothing
	 * written, nothing answered) does not count, and reply latency does not accumulate.
	 */
	silentFor(): number {
		if (this.lastWriteAt <= this.lastReplyAt) return 0;
		return this.clock.now() - Math.max(this.lastReplyAt, this.burstStart);
	}

	private async send(plain: Uint8Array): Promise<void> {
		await this.writeRaw(P.toWire(plain));
		this.lastSent = plain;
	}

	private async writeRaw(wire: Uint8Array): Promise<void> {
		const now = this.clock.now();
		if (now - this.lastWriteAt > BURST_GAP_MS) this.burstStart = now;
		this.lastWriteAt = now;
		await this.t.write(S1_CHAR_WRITE, wire);
		this.framesSent++;
	}

	// ----- notifications ------------------------------------------------------

	private onNotify(data: Uint8Array): void {
		const n = P.parse(data);
		if (n.kind === 'ignored') return;
		this.notifications++;
		this.lastReplyAt = this.clock.now();
		const raw = P.toHex(data);
		const f = n.fields;
		if (n.kind === 'legacy-status') {
			this.legacySeen = true;
			this.events.fire({ kind: 'legacy', fw: f.fw ?? null, battery: f.battery ?? null, raw });
			return;
		}
		if (n.header !== null) this.setHeader(n.header);
		if (n.crcOk === false) this.crcErrors++;
		if (n.kind === 'status') {
			this.hw = f.hw ?? this.hw;
			this.fw = f.fw ?? this.fw;
			this.battery = f.battery ?? this.battery;
			this.stateByte = f.stateByte ?? this.stateByte;
			this.statusAt = this.clock.now();
			this.events.fire({
				kind: 'status',
				battery: this.battery,
				fw: this.fw,
				hw: this.hw,
				stateByte: this.stateByte,
				crcOk: n.crcOk,
				raw
			});
		} else if (n.kind === 'mac' && f.mac !== undefined) {
			this.mac = f.mac;
			this.events.fire({ kind: 'mac', mac: f.mac, raw });
		} else if (n.kind === 'chip' && f.model !== undefined && f.vendor !== undefined) {
			this.chip = { model: f.model, vendor: f.vendor };
			this.events.fire({ kind: 'chip', model: f.model, vendor: f.vendor, raw });
		} else {
			this.events.fire({ kind: 'other', cmd: f.cmd ?? null, crcOk: n.crcOk, raw });
		}
	}

	info(): S1Info {
		return {
			model: this.model.id,
			header: this.header,
			scrambled: this.scrambled,
			battery: this.battery,
			fw: this.fw,
			hw: this.hw,
			mac: this.mac,
			chip: this.chip,
			stateByte: this.stateByte,
			statusAt: this.statusAt,
			frames: this.framesSent,
			replies: this.notifications,
			crcErrors: this.crcErrors
		};
	}
}
