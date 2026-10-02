// Two channels under one clock and one set of limits. The session stops itself when `limits.sessionMaxS` of output
// has elapsed; the caller must then send zero frames.
// Ported from the reference implementation (engine/session.py).

import { CoyoteChannel, type CoyoteChannelOut } from './channel.ts';
import { CoyoteLimits, type CoyoteLimitValues } from './limits.ts';

export type ChannelName = 'a' | 'b';

/** One tick's result for both channels. */
export interface CoyoteOut {
	a: CoyoteChannelOut;
	b: CoyoteChannelOut;
	/** why the session stopped (stays set until resume()), or null */
	stopped: string | null;
	/** at least one channel has a non-silent payload */
	anyOutput: boolean;
}

/** What an output loop needs from the engine. */
export interface CoyoteEngine {
	tick(dtMs: number): CoyoteOut;
	/** silences both channels, intensity 0, warm-up back to 0 */
	stop(reason: string): void;
	resume(): void;
	/** the device reported an intensity we did not command */
	adoptDevice(channel: ChannelName, value: number): number;
	/** something is playing or an intensity is above 0 on either channel */
	readonly busy: boolean;
}

export class CoyoteSession implements CoyoteEngine {
	readonly limits: CoyoteLimits;
	readonly a: CoyoteChannel;
	readonly b: CoyoteChannel;
	/** B follows A's base intensity */
	syncAb = false;
	fireSync = false;
	/** conservative warm-up pinned, and mute-on-connect forced on */
	protectMode = false;
	muteOnConnect = false;
	private muteBackup = false;
	outputMs = 0;
	stoppedReason: string | null = null;

	constructor(limits: CoyoteLimits | Partial<CoyoteLimitValues> = {}) {
		this.limits = (limits instanceof CoyoteLimits ? limits : new CoyoteLimits(limits)).validate();
		this.a = new CoyoteChannel('A', this.limits);
		this.b = new CoyoteChannel('B', this.limits);
	}

	channel(name: ChannelName | 'A' | 'B'): CoyoteChannel {
		return name.toUpperCase() === 'A' ? this.a : this.b;
	}

	channels(): [CoyoteChannel, CoyoteChannel] {
		return [this.a, this.b];
	}

	/** Change the cap or the session maximum (validated; an invalid value throws and changes nothing). Base
	 * intensities above a lowered cap come down with it. */
	setLimits(values: Partial<CoyoteLimitValues>): CoyoteLimits {
		const next = new CoyoteLimits({ ...this.values(), ...values }).validate();
		this.limits.absoluteMax = next.absoluteMax;
		this.limits.sessionMaxS = next.sessionMaxS;
		for (const c of this.channels()) c.setIntensity(c.baseIntensity);
		return this.limits;
	}

	private values(): CoyoteLimitValues {
		return { absoluteMax: this.limits.absoluteMax, sessionMaxS: this.limits.sessionMaxS };
	}

	/** Fire on one channel fires the other too, at the same target. */
	setFireSync(on: boolean): void {
		this.fireSync = Boolean(on);
		this.a.fire.syncTo = on ? this.b.fire : null;
		this.b.fire.syncTo = on ? this.a.fire : null;
	}

	setProtectMode(on: boolean): void {
		on = Boolean(on);
		if (on && !this.protectMode) this.muteBackup = this.muteOnConnect;
		this.a.warmup.setProtected(on);
		this.b.warmup.setProtected(on);
		if (on) this.muteOnConnect = true;
		else if (this.protectMode) this.muteOnConnect = this.muteBackup;
		this.protectMode = on;
	}

	setMuteOnConnect(on: boolean): void {
		// forced on while protected; remember the wish for when protection is lifted
		if (this.protectMode) this.muteBackup = Boolean(on);
		else this.muteOnConnect = Boolean(on);
	}

	onDeviceConnected(): void {
		if (this.muteOnConnect) {
			this.a.muted = true;
			this.b.muted = true;
		}
	}

	/**
	 * The device reports an intensity we did not command (a dial was turned, or a frame was lost): it becomes
	 * the channel's base. Not while Fire is held on that channel: the burst level is ours, and adopting it
	 * would keep it after the release (the reference implementation's output loop skips a firing channel). With A/B sync, B
	 * follows A's base at once.
	 */
	adoptDevice(channel: ChannelName, value: number): number {
		const c = this.channel(channel);
		if (c.fire.active) return c.baseIntensity;
		const base = c.adoptDevice(value);
		if (this.syncAb) this.b.baseIntensity = this.a.baseIntensity;
		return base;
	}

	/** Something is playing, a base intensity is above 0, or Fire is held, on either channel. */
	get busy(): boolean {
		return this.channels().some((c) => c.player.playing || c.baseIntensity > 0 || c.fire.active);
	}

	stop(reason = 'stop'): void {
		this.a.stop();
		this.b.stop();
		this.stoppedReason = reason;
	}

	/** Clear the stop reason and start the session clock again. Until then `stopped` stays set and the session
	 * maximum is not enforced again, so the caller must not start output while it is set. */
	resume(): void {
		this.stoppedReason = null;
		this.outputMs = 0;
	}

	tick(dtMs = 100): CoyoteOut {
		if (this.syncAb) this.b.baseIntensity = this.a.baseIntensity;
		let a = this.a.tick(dtMs);
		let b = this.b.tick(dtMs);
		if (!(a.silent && b.silent)) {
			this.outputMs += dtMs;
			if (this.outputMs >= this.limits.sessionMaxS * 1000 && this.stoppedReason === null) {
				this.stop('session_max');
				a = this.a.tick(0);
				b = this.b.tick(0);
			}
		}
		return { a, b, stopped: this.stoppedReason, anyOutput: !(a.silent && b.silent) };
	}
}
