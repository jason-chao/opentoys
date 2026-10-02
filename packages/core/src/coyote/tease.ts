// Random pauses ("tease"): alternate working and pause periods; during a pause the channel is silent.
// Ported from the reference implementation (engine/tease.py).

import { Rng, randomSeed } from '../rng.ts';

export class Tease {
	enabled = false;
	/** fixed: always the shorter end of the range; otherwise a random whole number of seconds within it */
	workingFixed = false;
	/** seconds */
	workingRange: [number, number] = [10, 30];
	pauseFixed = false;
	pauseRange: [number, number] = [10, 30];
	rng: Rng;
	working = true;
	private elapsedMs = 0;
	private periodMs = 0;

	constructor(rng?: Rng) {
		this.rng = rng ?? new Rng(randomSeed());
	}

	private pick(fixed: boolean, range: readonly [number, number]): number {
		const a = Math.max(1, range[0]);
		const b = Math.max(1, range[1]);
		const [lo, hi] = b < a ? [b, a] : [a, b];
		return (fixed ? lo : this.rng.randint(lo, hi)) * 1000;
	}

	reset(): void {
		this.working = true;
		this.elapsedMs = 0;
		this.periodMs = this.pick(this.workingFixed, this.workingRange);
	}

	/** Returns true when output is allowed this tick. */
	tick(dtMs: number): boolean {
		if (!this.enabled) return true;
		if (this.periodMs <= 0) this.reset();
		if (this.elapsedMs >= this.periodMs) {
			this.working = !this.working;
			this.elapsedMs = 0;
			this.periodMs = this.working
				? this.pick(this.workingFixed, this.workingRange)
				: this.pick(this.pauseFixed, this.pauseRange);
		}
		this.elapsedMs += dtMs;
		return this.working;
	}
}
