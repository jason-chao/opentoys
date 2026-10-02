// The output loop (the reference implementation's bridge runner, moved into the page): an output engine ticked every 50 ms,
// turned into level frames for the connected device.
//
// While a source is active the levels are written when they change and re-sent every `refreshMs` otherwise:
// the ring holds its levels while nothing is written (verified with a wearer, SPEC §8), and fewer frames leave
// the shared radio alone. Everything that ends output funnels into the stop sequence: the engine goes silent
// and the device gets a zero frame plus the stop command at once and again on the next tick.
//
// Output never restarts by itself: attaching a (re)connected device stops the engine, and a lost link stops it
// and reports "the ring may still be running" (reconnecting is the user's call).
import { type Clock, intervalScheduler, type Scheduler, systemClock, withTimeout } from '../clock.ts';
import type { Device } from '../device.ts';
import { Emitter } from '../emitter.ts';
import { type ChannelLevels, channelLevels, quantize, type RoleLevels } from '../model.ts';

/** One tick of the engine (packages/core's Session produces these). */
export interface Out {
	source: string;
	wantVib: number;
	wantEstim: number;
	/** What goes to the device, after every limit. */
	vib: number;
	estim: number;
	warm: number;
	stopped: string | null;
	live: boolean;
}

/**
 * What the controller needs from the engine; core's Session satisfies it structurally. Assumes, as in
 * the reference implementation, that `wantEstim` is 0 while e-stim is suppressed and non-zero again once the user turns it back on.
 */
export interface OutputEngine {
	tick(dtMs: number): Out;
	stop(reason: string): void;
	suppressEstim(): boolean;
	readonly source: unknown | null;
}

export type ControllerState = 'detached' | 'ready' | 'lost';
export type LinkLossReason = 'disconnected' | 'watchdog' | 'write-failed';
export type LeaveTrigger = 'hidden' | 'pagehide';
export type BackgroundOutcome = 'stop' | 'estim-off' | 'none';
export type OutputKind = 'levels' | 'refresh' | 'background' | 'stop';

/** Stop reasons the controller itself uses (the engine adds its own, e.g. session_max, finished). */
export const STOP_REASONS = {
	user: 'user',
	connected: 'connected',
	disconnect: 'disconnect',
	pageHidden: 'page_hidden',
	pageClosed: 'page_closed',
	linkLost: 'link_lost',
	notAnswering: 'ring_not_answering',
	writeFailed: 'write_failed'
} as const;

const LOSS_REASON: Record<LinkLossReason, string> = {
	disconnected: STOP_REASONS.linkLost,
	watchdog: STOP_REASONS.notAnswering,
	'write-failed': STOP_REASONS.writeFailed
};

export interface SentOutput {
	readonly at: number;
	readonly kind: OutputKind;
	readonly source: string;
	/** Per role, as written (0..1); what the visuals should show. */
	readonly roles: RoleLevels;
	readonly levels: ChannelLevels;
	/** Per channel, in the model's channel order. */
	readonly bytes: readonly number[];
	readonly live: boolean;
}

export interface ControllerEvents {
	state: { state: ControllerState };
	/** A source is running (or its stop sequence is still going out): hold the wake lock. */
	active: { active: boolean };
	/** Every tick, for visuals; `roles` is what the controller will write. */
	tick: { out: Out; roles: RoleLevels; estimHeld: boolean };
	/** Levels actually written to the device. */
	output: SentOutput;
	battery: { percent: number };
	stopped: { reason: string };
	/** The device has not answered for longer than the reply timeout while being written to. */
	watchdog: { silentMs: number };
	/** Tell the user the ring may still be running and to switch it off at the ring if so. */
	linkLost: { reason: LinkLossReason; mayBeRunning: boolean; error?: unknown };
	background: { trigger: LeaveTrigger; outcome: BackgroundOutcome };
}

export interface ControllerOptions {
	engine: OutputEngine;
	clock?: Clock;
	scheduler?: Scheduler;
	tickMs?: number;
	/** Re-send unchanged levels this often (bounds the effect of a lost frame); 0 writes on every tick. */
	refreshMs?: number;
	/** The ring sends status only when written to: poll for the battery this often while idle; 0 = never. */
	pollIdleMs?: number;
	/** It answers every write; this long without an answer while writing = the link is dead. 0 = off. */
	replyTimeoutMs?: number;
	/** Largest dt handed to the engine (hidden pages get throttled timers). */
	maxDtMs?: number;
	/** How fast e-stim may come back after being held at 0 on leaving the page (fraction per second). */
	estimResumeRisePerS?: number;
	/** Stop sequences sent per stop (the first at once, the others on the following ticks). */
	stopRepeats?: number;
}

export class Controller extends Emitter<ControllerEvents> {
	readonly engine: OutputEngine;
	private readonly clock: Clock;
	private readonly scheduler: Scheduler;
	private readonly tickMs: number;
	private readonly refreshMs: number;
	private readonly pollIdleMs: number;
	private readonly replyTimeoutMs: number;
	private readonly maxDtMs: number;
	private readonly estimResumeRisePerS: number;
	private readonly stopRepeats: number;

	private dev: Device | null = null;
	private unsubs: (() => void)[] = [];
	private cancelLoop: (() => void) | null = null;
	private stepping = false;
	private failing = false;
	private _state: ControllerState = 'detached';
	private _active = false;
	private lastTickAt = 0;
	private hadSource = false;
	private stopPending = 0;
	private sentKey: string | null = null;
	private sentAt = -Infinity;
	private lastSent: SentOutput | null = null;
	/** E-stim held at 0 after leaving the page, until the user turns it on again. */
	private hold = false;
	private resumeCeiling: number | null = null;

	constructor(opts: ControllerOptions) {
		super();
		this.engine = opts.engine;
		this.clock = opts.clock ?? systemClock;
		this.scheduler = opts.scheduler ?? intervalScheduler;
		this.tickMs = opts.tickMs ?? 50;
		this.refreshMs = opts.refreshMs ?? 1000;
		this.pollIdleMs = opts.pollIdleMs ?? 60_000;
		this.replyTimeoutMs = opts.replyTimeoutMs ?? 3000;
		this.maxDtMs = opts.maxDtMs ?? 1000;
		this.estimResumeRisePerS = opts.estimResumeRisePerS ?? 0.25;
		this.stopRepeats = Math.max(1, opts.stopRepeats ?? 2);
	}

	get state(): ControllerState {
		return this._state;
	}
	get active(): boolean {
		return this._active;
	}
	get device(): Device | null {
		return this.dev;
	}
	get estimHeld(): boolean {
		return this.hold;
	}
	/** The last levels written (null before the first write). */
	get lastOutput(): SentOutput | null {
		return this.lastSent;
	}
	private get lastSentLive(): boolean {
		return this.lastSent?.live ?? false;
	}

	/** Start driving a connected, initialised device. Whatever the engine was doing is stopped first. */
	attach(device: Device): void {
		if (this.dev) this.release();
		if (this.engine.source !== null) this.stopEngine(STOP_REASONS.connected);
		this.dev = device;
		this.failing = false;
		this.stopPending = 0;
		this.sentKey = null;
		this.sentAt = -Infinity;
		this.lastSent = null;
		this.hadSource = false;
		this.hold = false;
		this.resumeCeiling = null;
		this.unsubs.push(
			device.onEvent((e) => {
				if ((e.kind === 'status' || e.kind === 'legacy') && e.battery !== null)
					this.emit('battery', { percent: e.battery });
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

	/** Stop all output: the engine goes silent, and the device gets the stop sequence at once. */
	stop(reason: string = STOP_REASONS.user): void {
		this.stopEngine(reason);
		const dev = this.dev;
		if (!dev || this.failing) {
			this.setActive(false);
			return;
		}
		this.stopPending = this.stopRepeats - 1;
		this.sendStop(dev).catch((e: unknown) => void this.fail('write-failed', e));
		if (this.stopPending === 0) this.setActive(false);
	}

	/**
	 * The page is being hidden or closed: apply the device's background policy, or stop everything when the
	 * user asked for that. For the Dragon S1: e-stim to 0 at once (a frame goes out now, not after the engine's
	 * fade), vibration keeps running, and e-stim stays off until the user turns it on again.
	 */
	leavePage(trigger: LeaveTrigger, opts: { stopEverything?: boolean } = {}): BackgroundOutcome {
		const policy = this.dev?.model.background;
		const running = this.engine.source !== null;
		let outcome: BackgroundOutcome = 'none';
		if (running || this.lastSentLive) {
			if (opts.stopEverything || !running || !policy || policy.vibration === 'off') {
				this.stop(trigger === 'hidden' ? STOP_REASONS.pageHidden : STOP_REASONS.pageClosed);
				outcome = 'stop';
			} else if (policy.estim === 'off') {
				this.engine.suppressEstim();
				this.hold = true;
				this.resumeCeiling = null;
				const dev = this.dev;
				if (dev && this.lastSent && !this.failing) {
					const roles = { vibration: this.lastSent.roles.vibration, estim: 0 };
					this.send(dev, roles, this.lastSent.source, 'background').catch(
						(e: unknown) => void this.fail('write-failed', e)
					);
				}
				outcome = 'estim-off';
			}
		}
		this.emit('background', { trigger, outcome });
		return outcome;
	}

	/** Leave the device deliberately: stop sequence, then a clean disconnect (which also stops the ring). */
	async disconnect(): Promise<void> {
		const dev = this.dev;
		if (!dev) return;
		this.stopEngine(STOP_REASONS.disconnect);
		this.release();
		this.setActive(false);
		try {
			await withTimeout(this.clock, dev.stop(), 1000, () => new Error('stop timed out'));
		} catch {
			// the clean disconnect below stops the ring anyway
		}
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

	private async stepWith(dev: Device): Promise<void> {
		const eng = this.engine;
		const now = this.clock.now();
		const dt = Math.min(Math.max(now - this.lastTickAt, 0), this.maxDtMs);
		this.lastTickAt = now;
		const out = eng.tick(dt);
		const has = eng.source !== null;
		if (this.hadSource && !has && this.stopPending === 0) {
			// The engine ended by itself (session max, finished) or was stopped behind our back.
			this.hold = false;
			this.resumeCeiling = null;
			this.stopPending = this.stopRepeats;
			this.emit('stopped', { reason: out.stopped ?? 'stopped' });
		}
		this.hadSource = has;
		const roles = this.shape(out, dt);
		this.emit('tick', { out, roles, estimHeld: this.hold });
		// A tick listener may have stopped output (the app's session limit does): the stop sequence is already
		// on its way, and these levels must not follow it.
		if (has && eng.source === null) return;
		if (has) {
			this.stopPending = 0;
			this.setActive(true);
			const key = this.key(dev, roles);
			if (key !== this.sentKey || !this.refreshMs || now - this.sentAt >= this.refreshMs)
				await this.send(dev, roles, out.source, key === this.sentKey ? 'refresh' : 'levels');
			const silent = dev.silentFor();
			if (this.replyTimeoutMs && silent > this.replyTimeoutMs) {
				this.emit('watchdog', { silentMs: silent });
				await this.fail('watchdog');
			}
		} else if (this.stopPending > 0) {
			this.stopPending--;
			await this.sendStop(dev);
			if (this.stopPending === 0) this.setActive(false);
		} else if (this.lastSentLive) {
			await this.sendStop(dev); // never leave the device running with nothing to drive it
		} else if (this.pollIdleMs && now - dev.lastWriteAt > this.pollIdleMs) {
			await dev.poll();
		}
	}

	/** The levels to write: the engine's, with e-stim held at 0 after leaving the page and ramped back after. */
	private shape(out: Out, dt: number): RoleLevels {
		let estim = out.estim;
		if (this.hold) {
			if (out.wantEstim > 0) {
				this.hold = false; // the user turned e-stim on again
				this.resumeCeiling = 0;
			} else estim = 0;
		}
		if (!this.hold && this.resumeCeiling !== null) {
			// The engine may still hold a partly faded level: come back from 0, not from there.
			this.resumeCeiling += (this.estimResumeRisePerS * dt) / 1000;
			if (estim <= this.resumeCeiling) this.resumeCeiling = null;
			else estim = this.resumeCeiling;
		}
		return { vibration: out.vib, estim };
	}

	private key(dev: Device, roles: RoleLevels): string {
		const levels = channelLevels(dev.model, roles);
		return dev.model.channels.map((c) => quantize(levels[c.id] ?? 0, c.steps)).join(',');
	}

	private async send(dev: Device, roles: RoleLevels, source: string, kind: OutputKind): Promise<void> {
		const levels = channelLevels(dev.model, roles);
		const bytes = dev.model.channels.map((c) => quantize(levels[c.id] ?? 0, c.steps));
		const now = this.clock.now();
		this.sentKey = bytes.join(',');
		this.sentAt = now;
		await dev.output(levels);
		this.record({ at: now, kind, source, roles, levels, bytes, live: bytes.some((b) => b > 0) });
	}

	private async sendStop(dev: Device): Promise<void> {
		this.sentKey = null;
		await dev.stop();
		const levels = channelLevels(dev.model, { vibration: 0, estim: 0 });
		this.record({
			at: this.clock.now(),
			kind: 'stop',
			source: 'none',
			roles: { vibration: 0, estim: 0 },
			levels,
			bytes: dev.model.channels.map(() => 0),
			live: false
		});
	}

	private record(sent: SentOutput): void {
		this.lastSent = sent;
		this.emit('output', sent);
	}

	private stopEngine(reason: string): void {
		this.engine.stop(reason);
		this.hadSource = false;
		this.hold = false;
		this.resumeCeiling = null;
		this.emit('stopped', { reason });
	}

	/** The link is gone or unusable: stop the engine, tell the UI, and try to silence the ring on the way out. */
	private async fail(reason: LinkLossReason, error?: unknown): Promise<void> {
		const dev = this.dev;
		if (!dev || this.failing) return;
		this.failing = true;
		const mayBeRunning = this.lastSentLive;
		this.stopEngine(LOSS_REASON[reason]);
		this.stopPending = 0;
		this.release();
		this.setActive(false);
		this.setState('lost');
		this.emit('linkLost', error === undefined ? { reason, mayBeRunning } : { reason, mayBeRunning, error });
		if (reason === 'disconnected') return;
		try {
			// May not get through; the clean disconnect after it stops the ring for sure (hardware).
			await withTimeout(this.clock, dev.stop(), 1000, () => new Error('stop timed out'));
		} catch {
			// nothing more to do here
		}
		await dev.disconnect().catch(() => {});
	}

	/** Forget the device without writing anything. */
	private release(): void {
		this.cancelLoop?.();
		this.cancelLoop = null;
		for (const u of this.unsubs) u();
		this.unsubs = [];
		this.dev = null;
		this.stopPending = 0;
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
