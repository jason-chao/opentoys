// One output channel: producers (player, fire, tease, auto-increase) feed a frame and an intensity target; the
// safety stages (comfort ceiling, absolute cap, warm-up, mute) shape what leaves. tick() is pure: the caller owns
// the clock and the transport.
// Ported from the reference implementation (engine/channel.py).

import { AutoIncrease } from './autoincr.ts';
import { ComfortLimit } from './comfort.ts';
import { Fire } from './fire.ts';
import { CoyoteLimits } from './limits.ts';
import { Player } from './player.ts';
import { Tease } from './tease.ts';
import { Warmup } from './warmup.ts';

export const SILENT_TICKS_FOR_IDLE = 10;

/** One channel's result for one tick. */
export interface CoyoteChannelOut {
	/** commanded intensity 0..200 after every cap */
	intensity: number;
	/** differs from the previous tick's command */
	changed: boolean;
	/** the 8 wire bytes f0 f1 f2 f3 s0 s1 s2 s3 after the warm-up scale; null = nothing to output this tick */
	payload: Uint8Array | null;
	/** no payload, or every strength in it is 0 */
	silent: boolean;
	/** warm-up factor applied to the frame's strengths */
	scale: number;
	/** active ceiling (min of the absolute cap and the comfort ceiling) */
	cap: number;
}

export class CoyoteChannel {
	readonly name: 'A' | 'B';
	readonly limits: CoyoteLimits;
	baseIntensity = 0;
	muted = false;
	readonly player = new Player();
	readonly fire = new Fire();
	readonly tease = new Tease();
	readonly auto = new AutoIncrease();
	readonly comfort = new ComfortLimit();
	readonly warmup = new Warmup();
	last: CoyoteChannelOut | null = null;
	private silentTicks = SILENT_TICKS_FOR_IDLE;

	constructor(name: 'A' | 'B' = 'A', limits: CoyoteLimits = new CoyoteLimits()) {
		this.name = name;
		this.limits = limits;
	}

	// ----- intents --------------------------------------------------------------------------------------------
	/** Set the base intensity (clamped to 0..cap); returns what was set. */
	setIntensity(value: number): number {
		this.baseIntensity = this.limits.clamp(value);
		return this.baseIntensity;
	}

	addIntensity(delta: number): number {
		return this.setIntensity(this.baseIntensity + Math.trunc(Number.isFinite(delta) ? delta : 0));
	}

	/** The device reports an intensity we did not command (its dial was turned, or a frame was lost): the device
	 * is the truth, so it becomes the new base — never above the cap. */
	adoptDevice(value: number): number {
		this.baseIntensity = Math.max(0, this.limits.clamp(value) - this.auto.totalIncr);
		return this.baseIntensity;
	}

	/** Hard stop: silence, intensity 0, ramp back to zero. */
	stop(): void {
		this.player.stop();
		this.fire.end();
		this.baseIntensity = 0;
		this.auto.reset();
		this.warmup.reset();
	}

	// ----- tick -----------------------------------------------------------------------------------------------
	get silentLastRun(): boolean {
		return this.muted || this.silentTicks > SILENT_TICKS_FOR_IDLE - 1;
	}

	tick(dtMs = 100): CoyoteChannelOut {
		let frame = this.player.nextFrame();
		if (!this.tease.tick(dtMs)) frame = null;
		if (this.muted) frame = null;
		const silentNow = frame === null || frame.isSilent(1);
		const incr = this.auto.tick(dtMs, !silentNow);
		this.fire.tick(dtMs);
		const target = this.fire.active ? this.fire.target : this.baseIntensity + incr;
		const prev = this.last ? this.last.intensity : 0;
		this.comfort.tick(dtMs, prev, this.silentLastRun);
		const cap = Math.min(this.limits.absoluteMax, this.comfort.maxStrength);
		const intensity = Math.max(0, Math.min(cap, Math.trunc(target)));
		const scale = this.warmup.tick(dtMs, intensity, silentNow, this.silentLastRun);
		const out: CoyoteChannelOut = {
			intensity,
			changed: intensity !== prev,
			payload: frame === null ? null : frame.bytes(scale),
			silent: frame === null || frame.isSilent(scale),
			scale,
			cap
		};
		this.silentTicks = out.silent ? this.silentTicks + 1 : 0;
		this.last = out;
		return out;
	}
}
