// The Coyote's output loop (the reference implementation's bridge runner, moved into the page): an engine ticked every 100 ms,
// translated into B0 frames.
//
// A frame carries 100 ms of output for both channels, so one is written on every tick while there is output;
// nothing is written while there is nothing to say. Intensity is set (numbered frame, answered with B1) only
// when it changes; otherwise frames say "keep". The device is the truth about its intensity: when it reports a
// value we did not command (a dial was turned, or a frame was lost) the engine adopts it.
//
// Everything that ends output funnels into stop(): the engine goes silent and the device gets ten explicit
// zero-intensity frames (the first at once), until it reports 0 on both channels: the only observable proof
// that output has ceased. Output never restarts by itself: attaching a (re)connected device stops the engine,
// and a lost link stops it (the device drains by itself; reconnecting is the user's call).
import { type Clock, intervalScheduler, type Scheduler, systemClock, withTimeout } from '../clock.ts';
import type { CoyoteDevice } from '../coyote/driver.ts';
import { COYOTE_INTENSITY_MAX, type CoyoteChannel } from '../coyote/model.ts';
import { type ChannelCommand, keepIntensity, setIntensity } from '../coyote/protocol.ts';
import { Emitter } from '../emitter.ts';
import type { BackgroundOutcome, ControllerState, LeaveTrigger, LinkLossReason } from './controller.ts';

export interface CoyoteChannelOut {
	/** Commanded intensity 0..200, after every cap. */
	intensity: number;
	/** Differs from the previous tick's command. */
	changed: boolean;
	/** The 8 wire bytes f0 f1 f2 f3 s0 s1 s2 s3 after the warm-up scale; null = nothing to output this tick. */
	payload: Uint8Array | null;
	silent: boolean;
	scale: number;
	/** The active ceiling. */
	cap: number;
}

export interface CoyoteOut {
	a: CoyoteChannelOut;
	b: CoyoteChannelOut;
	stopped: string | null;
	anyOutput: boolean;
}

/**
 * What the controller needs from the engine; core's CoyoteSession satisfies it structurally. As in
 * the reference implementation: stop() silences both channels and sets `stopped` until resume(), which the engine calls on
 * the user's next intent; adoptDevice() makes a reported value the channel's base (never above the cap) and
 * returns that base.
 */
export interface CoyoteEngine {
	tick(dtMs: number): CoyoteOut;
	stop(reason: string): void;
	resume(): void;
	adoptDevice(channel: CoyoteChannel, value: number): number;
	/** Something is playing or an intensity is above 0 on either channel. */
	readonly busy: boolean;
}

/** Stop reasons the controller itself uses (the engine adds its own, e.g. session_max). */
export const COYOTE_STOP_REASONS = {
	user: 'user',
	connected: 'connected',
	disconnect: 'disconnect',
	pageHidden: 'page_hidden',
	pageClosed: 'page_closed',
	linkLost: 'link_lost',
	notAnswering: 'device_not_answering',
	writeFailed: 'write_failed'
} as const;

const LOSS_REASON: Record<LinkLossReason, string> = {
	disconnected: COYOTE_STOP_REASONS.linkLost,
	watchdog: COYOTE_STOP_REASONS.notAnswering,
	'write-failed': COYOTE_STOP_REASONS.writeFailed
};

/** The frame a tick writes. */
export interface CoyoteFrame {
	/** 'zero' = one of a stop's zero frames. */
	readonly kind: 'frame' | 'zero';
	/** Numbered frames are answered with the device's intensities. */
	readonly numbered: boolean;
	readonly a: ChannelCommand;
	readonly b: ChannelCommand;
}

export interface CoyoteControllerEvents {
	state: { state: ControllerState };
	/** Something is playing, an intensity is up, or a stop is still going out: hold the wake lock. */
	active: { active: boolean };
	/** Every tick, for visuals: the engine's output and the frame being written (null = nothing written). */
	tick: { out: CoyoteOut; frame: CoyoteFrame | null };
	/** The intensities the device reported (an acknowledgement, or seq 0: a dial was turned). */
	output: { at: number; seq: number; a: number; b: number };
	battery: { percent: number };
	/** The device was at a value we did not command, and the engine adopted it. */
	dial: { channel: CoyoteChannel; device: number; commanded: number; base: number };
	stopped: { reason: string };
	/** A stop's zero frames have gone out; `confirmed` = the device reported 0 on both channels. */
	silenced: { confirmed: boolean; a: number; b: number };
	/** Numbered frames have gone unanswered for longer than the reply timeout. */
	watchdog: { silentMs: number };
	/** The Coyote stops by itself when frames stop: `mayBeRunning` is always false. */
	linkLost: { reason: LinkLossReason; mayBeRunning: false; error?: unknown };
	background: { trigger: LeaveTrigger; outcome: BackgroundOutcome };
}

export interface CoyoteControllerOptions {
	engine: CoyoteEngine;
	clock?: Clock;
	scheduler?: Scheduler;
	/** One frame lasts 100 ms. */
	tickMs?: number;
	/** Explicit zero frames per stop (ten = 1 s). */
	zeroFrames?: number;
	/** Further zero frames if the device has not reported 0 by then. */
	extraZeroFrames?: number;
	/** Ticks to let the acknowledgement of our own change arrive before comparing. */
	settleTicks?: number;
	/**
	 * While output is live, number a frame this often so the device reports its intensities (keeps the dial
	 * following honest and feeds the watchdog); 0 = only when the intensity changes.
	 */
	probeMs?: number;
	/** Numbered frames unanswered for this long = the link is dead. 0 = off. */
	replyTimeoutMs?: number;
	/** Largest dt handed to the engine (hidden pages get throttled timers). */
	maxDtMs?: number;
}

const ZERO = setIntensity(0);

function clampIntensity(ch: CoyoteChannelOut): number {
	const v = Number.isFinite(ch.intensity) ? Math.trunc(ch.intensity) : 0;
	const cap = Number.isFinite(ch.cap) ? Math.min(ch.cap, COYOTE_INTENSITY_MAX) : COYOTE_INTENSITY_MAX;
	return Math.min(Math.max(v, 0), Math.max(Math.trunc(cap), 0));
}

export class CoyoteController extends Emitter<CoyoteControllerEvents> {
	readonly engine: CoyoteEngine;
	private readonly clock: Clock;
	private readonly scheduler: Scheduler;
	private readonly tickMs: number;
	private readonly zeroFrames: number;
	private readonly extraZeroFrames: number;
	private readonly settleTicks: number;
	private readonly probeMs: number;
	private readonly replyTimeoutMs: number;
	private readonly maxDtMs: number;

	private dev: CoyoteDevice | null = null;
	private unsubs: (() => void)[] = [];
	private cancelLoop: (() => void) | null = null;
	private stepping = false;
	private failing = false;
	private _state: ControllerState = 'detached';
	private _active = false;
	private lastTickAt = 0;
	private last: CoyoteOut | null = null;
	private seq = 0;
	private outputLive = false;
	/** Ticks since we last commanded an intensity change. */
	private stable = 0;
	/** Device reports seen when we last commanded a change. */
	private reportMark = 0;
	/** Sequence number of our latest numbered frame. */
	private changeSeq = 0;
	private forceSet = false;
	private wasSilent = { a: true, b: true };
	private probeWanted = false;
	private lastNumberedAt = -Infinity;
	/** When the oldest still unanswered numbered frame was written. */
	private awaitingSince: number | null = null;
	/** A stop's zero frames are going out. */
	private stopping = false;
	private stopGen = 0;
	private zeroPending = 0;
	private zeroExtra = 0;
	private stopMark = 0;
	private stopWaiters: ((confirmed: boolean) => void)[] = [];
	/** The engine's current stop has been announced. */
	private stoppedSeen = true;

	constructor(opts: CoyoteControllerOptions) {
		super();
		this.engine = opts.engine;
		this.clock = opts.clock ?? systemClock;
		this.scheduler = opts.scheduler ?? intervalScheduler;
		this.tickMs = opts.tickMs ?? 100;
		this.zeroFrames = Math.max(1, opts.zeroFrames ?? 10);
		this.extraZeroFrames = Math.max(0, opts.extraZeroFrames ?? 20);
		this.settleTicks = opts.settleTicks ?? 3;
		this.probeMs = opts.probeMs ?? 1000;
		this.replyTimeoutMs = opts.replyTimeoutMs ?? 3000;
		this.maxDtMs = opts.maxDtMs ?? 1000;
	}

	get state(): ControllerState {
		return this._state;
	}
	get active(): boolean {
		return this._active;
	}
	get device(): CoyoteDevice | null {
		return this.dev;
	}
	/** Frames carrying output are being written. */
	get live(): boolean {
		return this.outputLive;
	}
	/** The engine's output on the last tick. */
	get lastOut(): CoyoteOut | null {
		return this.last;
	}
	/** What the device last reported (null without a device). */
	get reported(): { a: number; b: number } | null {
		return this.dev ? { a: this.dev.intensityA, b: this.dev.intensityB } : null;
	}

	/** Start driving a connected, initialised device. Whatever the engine was doing is stopped first. */
	attach(device: CoyoteDevice): void {
		if (this.dev) this.release();
		if (this.engine.busy) this.stopEngine(COYOTE_STOP_REASONS.connected);
		this.dev = device;
		this.failing = false;
		this.last = null;
		this.seq = 0;
		this.outputLive = false;
		this.stable = 0;
		this.reportMark = device.reports;
		this.changeSeq = 0;
		this.forceSet = false;
		this.probeWanted = false;
		this.lastNumberedAt = -Infinity;
		this.awaitingSince = null;
		this.stoppedSeen = true; // a stop from before this connection is not news
		this.unsubs.push(
			device.onEvent((e) => {
				if (e.kind === 'battery') this.emit('battery', { percent: e.percent });
				else if (e.kind === 'intensity') {
					this.awaitingSince = null;
					this.emit('output', { at: this.clock.now(), seq: e.seq, a: e.a, b: e.b });
				}
			}),
			device.onDisconnect((info) => {
				if (this.dev !== device) return;
				if (info.requested) {
					this.release();
					this.setActive(false);
					this.setState('detached');
				} else void this.fail('disconnected');
			})
		);
		this.lastTickAt = this.clock.now();
		this.cancelLoop = this.scheduler.every(this.tickMs, () => void this.step());
		this.setState('ready');
		if (device.battery !== null) this.emit('battery', { percent: device.battery });
	}

	/**
	 * Stop all output: the engine goes silent and zero frames go out, the first at once. Resolves when they
	 * have gone out: true if the device reported 0 on both channels.
	 */
	stop(reason: string = COYOTE_STOP_REASONS.user): Promise<boolean> {
		this.stopEngine(reason);
		const dev = this.dev;
		if (!dev || this.failing) {
			this.setActive(false);
			return Promise.resolve(false);
		}
		const done = new Promise<boolean>((resolve) => this.stopWaiters.push(resolve));
		this.beginZero(dev);
		this.writeZero(dev).catch((e: unknown) => void this.fail('write-failed', e));
		this.setActive(true);
		return done;
	}

	/** Ask the device to report its intensities with the next frame, without changing them. */
	probe(): void {
		this.probeWanted = true;
	}

	/**
	 * The page is being hidden or closed. For this device that is always a full stop, whatever the setting:
	 * it stays off until the user turns it on again.
	 */
	leavePage(trigger: LeaveTrigger, opts: { stopEverything?: boolean } = {}): BackgroundOutcome {
		void opts;
		const dev = this.dev;
		const up = dev !== null && (dev.intensityA > 0 || dev.intensityB > 0);
		let outcome: BackgroundOutcome = 'none';
		if (this.engine.busy || this.outputLive || this.stopping || up) {
			void this.stop(trigger === 'hidden' ? COYOTE_STOP_REASONS.pageHidden : COYOTE_STOP_REASONS.pageClosed);
			outcome = 'stop';
		}
		this.emit('background', { trigger, outcome });
		return outcome;
	}

	/** Leave the device deliberately: stop, get it to acknowledge zero, then drop the link. */
	async disconnect(): Promise<void> {
		const dev = this.dev;
		if (!dev) return;
		this.stopEngine(COYOTE_STOP_REASONS.disconnect);
		this.release();
		this.setActive(false);
		await this.zeroAcknowledged(dev);
		await dev.disconnect().catch(() => {});
		this.setState('detached');
	}

	/** One loop iteration; public for tests and for a caller that drives the loop itself. */
	async step(): Promise<void> {
		const dev = this.dev;
		if (!dev || this.stepping || this.failing) return;
		this.stepping = true;
		try {
			await this.stepWith(dev);
		} catch (e) {
			await this.fail('write-failed', e);
		} finally {
			this.stepping = false;
		}
	}

	private async stepWith(dev: CoyoteDevice): Promise<void> {
		const now = this.clock.now();
		if (
			this.replyTimeoutMs &&
			this.awaitingSince !== null &&
			now - this.awaitingSince > this.replyTimeoutMs
		) {
			this.emit('watchdog', { silentMs: now - this.awaitingSince });
			await this.fail('watchdog');
			return;
		}
		this.reconcile(dev);
		const dt = Math.min(Math.max(now - this.lastTickAt, 0), this.maxDtMs);
		this.lastTickAt = now;
		const out = this.engine.tick(dt);
		this.last = out;
		if (out.stopped === null) this.stoppedSeen = false;
		else if (!this.stoppedSeen) {
			// The engine ended by itself (session max) or was stopped behind our back.
			this.stoppedSeen = true;
			this.emit('stopped', { reason: out.stopped });
			if (!this.stopping) this.beginZero(dev);
		}
		// A channel that starts to output states its intensity explicitly. Its wheel may have been turned while
		// it was idle, and a frame that says "keep" would then play the pattern at the wheel's value.
		const starting = (this.wasSilent.a && !out.a.silent) || (this.wasSilent.b && !out.b.silent);
		this.wasSilent = { a: out.a.silent, b: out.b.silent };
		const forced = this.forceSet || starting;
		this.forceSet = false;
		const changed = forced || out.a.changed || out.b.changed;
		const probeDue = this.probeMs > 0 && out.anyOutput && now - this.lastNumberedAt >= this.probeMs;
		const probe = this.probeWanted || probeDue;
		this.probeWanted = false;

		let frame: CoyoteFrame | null = null;
		if (this.stopping) {
			if (this.zeroPending === 0 && !this.confirmed(dev) && this.zeroExtra > 0) {
				this.zeroExtra--;
				this.zeroPending = 1;
			}
			if (this.zeroPending > 0) frame = { kind: 'zero', numbered: true, a: ZERO, b: ZERO };
		} else if (changed || probe || out.anyOutput) {
			frame = {
				kind: 'frame',
				numbered: changed || probe,
				a: changed ? setIntensity(clampIntensity(out.a), out.a.payload) : keepIntensity(out.a.payload),
				b: changed ? setIntensity(clampIntensity(out.b), out.b.payload) : keepIntensity(out.b.payload)
			};
		}
		const gen = this.stopGen;
		const busy = this.engine.busy;
		this.emit('tick', { out, frame });
		// A tick listener may have stopped output (the app's session limit does): its zero frame is already on
		// its way, and this tick's frame must not follow it. Stopped through the engine instead: the next tick
		// sees it and starts the zero frames.
		if (this.stopGen !== gen || this.dev !== dev || (busy && !this.engine.busy)) return;

		if (this.stopping) {
			if (frame) await this.writeZero(dev);
			else this.finishStop(this.confirmed(dev), dev);
		} else {
			if (changed) {
				this.stable = 0;
				this.reportMark = dev.reports;
			} else this.stable++;
			if (frame) {
				this.seq = frame.numbered ? (this.seq % 15) + 1 : 0;
				if (frame.numbered) this.numbered(now);
				await dev.writeFrame(this.seq, frame.a, frame.b);
			}
			this.outputLive = frame !== null && out.anyOutput && !this.stopping;
		}
		if (this.dev === dev) this.setActive(this.stopping || this.outputLive || this.engine.busy);
	}

	/**
	 * Follow the intensity the device reports. Turning its dial, or a lost frame, leaves the device at a value
	 * the engine did not command; that value becomes the channel's base (the engine keeps it under the cap).
	 */
	private reconcile(dev: CoyoteDevice): void {
		const last = this.last;
		if (!last || this.stopping || last.stopped !== null) return;
		if (this.stable < this.settleTicks || dev.reports <= this.reportMark) return;
		// The newest report still answers an older change of ours: stale, not a dial turn.
		if (dev.lastSeqAck !== 0 && dev.lastSeqAck !== this.changeSeq) return;
		const pairs: [CoyoteChannel, number, number][] = [
			['a', last.a.intensity, dev.intensityA],
			['b', last.b.intensity, dev.intensityB]
		];
		for (const [channel, commanded, device] of pairs) {
			if (device === commanded) continue;
			const base = this.engine.adoptDevice(channel, device);
			this.forceSet = true;
			this.emit('dial', { channel, device, commanded, base });
		}
	}

	private numbered(now: number): void {
		this.changeSeq = this.seq;
		this.lastNumberedAt = now;
		if (this.awaitingSince === null) this.awaitingSince = now;
	}

	private beginZero(dev: CoyoteDevice): void {
		this.stopping = true;
		this.stopGen++;
		this.zeroPending = this.zeroFrames;
		this.zeroExtra = this.extraZeroFrames;
		this.stopMark = dev.reports;
		this.outputLive = false;
	}

	private async writeZero(dev: CoyoteDevice): Promise<void> {
		if (this.zeroPending > 0) this.zeroPending--;
		this.seq = (this.seq % 15) + 1;
		this.numbered(this.clock.now());
		this.stable = 0;
		this.reportMark = dev.reports;
		this.outputLive = false;
		await dev.writeFrame(this.seq, ZERO, ZERO);
	}

	/** The device has reported 0 on both channels since the stop began. */
	private confirmed(dev: CoyoteDevice): boolean {
		return dev.reports > this.stopMark && dev.intensityA === 0 && dev.intensityB === 0;
	}

	private finishStop(confirmed: boolean, dev: CoyoteDevice | null): void {
		if (!this.stopping && this.stopWaiters.length === 0) return;
		const was = this.stopping;
		this.stopping = false;
		this.zeroPending = 0;
		const waiters = this.stopWaiters;
		this.stopWaiters = [];
		for (const w of waiters) w(confirmed);
		if (was) this.emit('silenced', { confirmed, a: dev?.intensityA ?? 0, b: dev?.intensityB ?? 0 });
	}

	/** One zero frame, waiting up to a second for the device to report 0 on both channels. */
	private async zeroAcknowledged(dev: CoyoteDevice): Promise<boolean> {
		let off: () => void = () => {};
		const acked = new Promise<void>((resolve) => {
			off = dev.onEvent((e) => {
				if (e.kind === 'intensity' && e.seq !== 0 && e.a === 0 && e.b === 0) resolve();
			});
		});
		try {
			await withTimeout(
				this.clock,
				dev.zero(15).then(() => acked),
				1000,
				() => new Error('zero not acknowledged')
			);
			return true;
		} catch {
			return false; // the link is going anyway, and the device drains without frames
		} finally {
			off();
		}
	}

	private stopEngine(reason: string): void {
		this.engine.stop(reason);
		this.stoppedSeen = true;
		this.emit('stopped', { reason });
	}

	/** The link is gone or unusable: stop the engine and tell the UI; the device stops by itself. */
	private async fail(reason: LinkLossReason, error?: unknown): Promise<void> {
		const dev = this.dev;
		if (!dev || this.failing) return;
		this.failing = true;
		this.stopEngine(LOSS_REASON[reason]);
		this.release();
		this.setActive(false);
		this.setState('lost');
		this.emit(
			'linkLost',
			error === undefined ? { reason, mayBeRunning: false } : { reason, mayBeRunning: false, error }
		);
		if (reason === 'disconnected') return;
		await this.zeroAcknowledged(dev); // may not get through
		await dev.disconnect().catch(() => {});
	}

	/** Forget the device without writing anything. */
	private release(): void {
		this.cancelLoop?.();
		this.cancelLoop = null;
		for (const u of this.unsubs) u();
		this.unsubs = [];
		const dev = this.dev;
		this.dev = null;
		this.outputLive = false;
		this.awaitingSince = null;
		this.finishStop(false, dev);
	}

	private setActive(active: boolean): void {
		if (active === this._active) return;
		this._active = active;
		this.emit('active', { active });
	}

	private setState(state: ControllerState): void {
		if (state === this._state) return;
		this._state = state;
		this.emit('state', { state });
	}
}
