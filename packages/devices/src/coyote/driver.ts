// Driver for the Coyote 3.0: identification reads, battery and intensity reports, pulse frames, soft caps.
import { type Clock, systemClock } from '../clock.ts';
import { type ConnectedDevice, DeviceError, type DeviceInfo } from '../device.ts';
import { Emitter } from '../emitter.ts';
import type { DisconnectInfo, Transport } from '../transport.ts';
import {
	COYOTE_3,
	COYOTE_CHAR_BATTERY,
	COYOTE_CHAR_MAC,
	COYOTE_CHAR_NOTIFY,
	COYOTE_CHAR_VERSION,
	COYOTE_CHAR_WRITE,
	COYOTE_INTENSITY_MAX
} from './model.ts';
import {
	type Balance,
	buildB0,
	buildBF,
	buildLed,
	type ChannelCommand,
	type LedColour,
	parseNotification,
	setIntensity
} from './protocol.ts';

export interface CoyoteCaps {
	/** Device-side cap per channel, 0..200. */
	readonly a: number;
	readonly b: number;
}

export interface CoyoteOpenOptions {
	/** Written to the device as its own caps (BF) on connecting: a safety layer below the app's. */
	caps?: CoyoteCaps;
	clock?: Clock;
}

export type CoyoteEvent =
	| { kind: 'battery'; percent: number }
	/** The device's intensities: the answer to frame `seq`, or (seq 0) a dial was turned. */
	| { kind: 'intensity'; seq: number; a: number; b: number; raw: string }
	/** The firmware does not know a command we sent. */
	| { kind: 'unsupported'; cmd: string; raw: string }
	/** Anything else the device said; reported, never guessed at. */
	| { kind: 'other'; type: string; raw: string };

export interface CoyoteInfo extends DeviceInfo {
	readonly fw: number;
	readonly fwLabel: number;
	readonly mac: string | null;
	readonly intensityA: number;
	readonly intensityB: number;
	readonly lastSeqAck: number;
	readonly caps: CoyoteCaps | null;
}

/** What the Coyote output loop needs from the driver. */
export interface CoyoteDevice extends ConnectedDevice {
	/** What the device last reported (B1): the truth about its intensity. */
	readonly intensityA: number;
	readonly intensityB: number;
	/** The frame number the latest report answers; 0 = unasked (a dial was turned). */
	readonly lastSeqAck: number;
	/** Count of intensity reports received (acknowledgements and dial turns alike). */
	readonly reports: number;
	writeFrame(seq: number, a: ChannelCommand, b: ChannelCommand): Promise<void>;
	zero(seq?: number): Promise<void>;
	onEvent(listener: (e: CoyoteEvent) => void): () => void;
}

class Events extends Emitter<{ event: CoyoteEvent }> {
	fire(e: CoyoteEvent): void {
		this.emit('event', e);
	}
}

function clampCap(v: number): number {
	return Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 0), COYOTE_INTENSITY_MAX) : 0;
}

export class CoyoteDriver implements CoyoteDevice {
	readonly model = COYOTE_3;
	battery: number | null = null;
	fwVersion = 0;
	fwLabel = 0;
	mac: string | null = null;
	intensityA = 0;
	intensityB = 0;
	lastSeqAck = 0;
	reports = 0;
	lastReportAt = -Infinity;
	framesSent = 0;
	lastWriteAt = -Infinity;
	caps: CoyoteCaps | null = null;
	private events = new Events();
	private readonly t: Transport;
	private readonly clock: Clock;

	constructor(transport: Transport, opts: { clock?: Clock } = {}) {
		this.t = transport;
		this.clock = opts.clock ?? systemClock;
	}

	/** Create the driver and run the connect sequence; on failure the link is closed again. */
	static async open(transport: Transport, opts: CoyoteOpenOptions = {}): Promise<CoyoteDriver> {
		const dev = new CoyoteDriver(transport, opts);
		try {
			await dev.init(opts.caps);
		} catch (e) {
			await transport.disconnect().catch(() => {});
			throw e;
		}
		return dev;
	}

	get connected(): boolean {
		return this.t.connected;
	}

	onEvent(listener: (e: CoyoteEvent) => void): () => void {
		return this.events.on('event', listener);
	}

	onDisconnect(listener: (info: DisconnectInfo) => void): () => void {
		return this.t.onDisconnect(listener);
	}

	disconnect(): Promise<void> {
		return this.t.disconnect();
	}

	/**
	 * Read version, battery and MAC, subscribe to battery and notifications, then leave the device silent: a
	 * zero frame (answered with its intensities), and the soft caps.
	 */
	async init(caps?: CoyoteCaps): Promise<void> {
		for (const ch of [COYOTE_CHAR_WRITE, COYOTE_CHAR_NOTIFY, COYOTE_CHAR_VERSION, COYOTE_CHAR_BATTERY]) {
			if (!this.t.hasCharacteristic(ch))
				throw new DeviceError(
					'missing-characteristic',
					`characteristic ${ch.slice(4, 8)} missing: not a supported device`
				);
		}
		const v = await this.t.read(COYOTE_CHAR_VERSION);
		if (v.length < 1) throw new DeviceError('not-identified', 'the device did not report its version');
		this.fwVersion = v[0]!;
		this.fwLabel = v[1] ?? 0;
		const b = await this.t.read(COYOTE_CHAR_BATTERY);
		if (b.length > 0) this.battery = b[0]!;
		if (this.t.hasCharacteristic(COYOTE_CHAR_MAC)) {
			const m = await this.t.read(COYOTE_CHAR_MAC);
			if (m.length === 6)
				this.mac = Array.from(m, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
		}
		await this.t.subscribe(COYOTE_CHAR_BATTERY, (d) => this.onBattery(d));
		await this.t.subscribe(COYOTE_CHAR_NOTIFY, (d) => this.onNotify(d));
		await this.zero();
		if (caps) await this.setSoftCaps(caps.a, caps.b);
	}

	// ----- notifications ------------------------------------------------------

	private onBattery(data: Uint8Array): void {
		if (data.length === 0) return;
		this.battery = data[0]!;
		this.events.fire({ kind: 'battery', percent: data[0]! });
	}

	private onNotify(data: Uint8Array): void {
		const n = parseNotification(data);
		if (n.kind === 'intensity') {
			this.lastSeqAck = n.seq;
			this.intensityA = n.a;
			this.intensityB = n.b;
			this.reports++;
			this.lastReportAt = this.clock.now();
			this.events.fire(n);
		} else if (n.kind === 'unsupported') this.events.fire(n);
		else this.events.fire({ kind: 'other', type: n.kind, raw: n.raw });
	}

	// ----- commands -----------------------------------------------------------

	async write(data: Uint8Array): Promise<void> {
		this.lastWriteAt = this.clock.now();
		await this.t.write(COYOTE_CHAR_WRITE, data);
	}

	/** One pulse frame for both channels; `seq` 1..15 is answered with the device's intensities. */
	async writeFrame(seq: number, a: ChannelCommand, b: ChannelCommand): Promise<void> {
		await this.write(buildB0(seq, a, b));
		this.framesSent++;
	}

	/** Absolute zero on both channels with silent payloads; its answer is the only way to *know* output stopped. */
	zero(seq = 15): Promise<void> {
		return this.writeFrame(seq, setIntensity(0), setIntensity(0));
	}

	/** Device-side caps (0..200 per channel): the dials and our frames cannot go above them. */
	async setSoftCaps(a: number, b: number, balance?: Balance): Promise<void> {
		const caps = { a: clampCap(a), b: clampCap(b) };
		await this.write(buildBF(caps.a, caps.b, balance));
		this.caps = caps;
	}

	setLed(colour: LedColour): Promise<void> {
		return this.write(buildLed(colour));
	}

	info(): CoyoteInfo {
		return {
			model: this.model.id,
			battery: this.battery,
			frames: this.framesSent,
			replies: this.reports,
			fw: this.fwVersion,
			fwLabel: this.fwLabel,
			mac: this.mac,
			intensityA: this.intensityA,
			intensityB: this.intensityB,
			lastSeqAck: this.lastSeqAck,
			caps: this.caps
		};
	}
}
