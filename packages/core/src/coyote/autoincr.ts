// Slow automatic escalation: +1 every `time` seconds of output, up to `intensityMax` above the base; optionally
// decays after `decreaseTime` seconds once the top is reached.
// Ported from the reference implementation (engine/autoincr.py).

import { Rng, randomSeed } from '../rng.ts';

export class AutoIncrease {
	enabled = false;
	intensityMax = 20;
	/** seconds */
	timeMin = 60;
	timeMax = 120;
	/** 0 fixed (timeMin), 1 random in [timeMin, timeMax] */
	timeMode: 0 | 1 = 0;
	enableDecrease = false;
	decreaseTime = 60;
	totalIncr = 0;
	increasing = true;
	rng: Rng;
	private periodMs = -1;
	private elapsedMs = 0;
	private decMs = 0;

	constructor(rng?: Rng) {
		this.rng = rng ?? new Rng(randomSeed());
	}

	reset(): void {
		this.totalIncr = 0;
		this.increasing = true;
		this.periodMs = -1;
		this.elapsedMs = 0;
		this.decMs = 0;
	}

	private nextPeriod(): number {
		const a = Math.max(1, this.timeMin);
		const b = Math.max(1, this.timeMax);
		const [lo, hi] = b < a ? [b, a] : [a, b];
		return (this.timeMode === 0 ? lo : this.rng.randint(lo, hi)) * 1000;
	}

	/** The increase to add to the base intensity; it only advances while the channel is outputting. */
	tick(dtMs: number, outputting: boolean): number {
		if (!this.enabled || !outputting) return this.totalIncr;
		if (this.increasing) {
			if (this.periodMs < 0) this.periodMs = this.nextPeriod();
			this.elapsedMs += dtMs;
			if (this.elapsedMs >= this.periodMs) {
				this.elapsedMs = 0;
				this.periodMs = this.nextPeriod();
				if (this.totalIncr < this.intensityMax) this.totalIncr += 1;
				if (this.totalIncr >= this.intensityMax && this.enableDecrease) {
					this.increasing = false;
					this.decMs = 0;
				}
			}
		} else {
			this.decMs += dtMs;
			if (this.decMs >= this.decreaseTime * 1000) {
				this.decMs = 0;
				if (this.totalIncr > 0) this.totalIncr -= 1;
				if (this.totalIncr === 0) {
					this.increasing = true;
					this.periodMs = -1;
				}
			}
		}
		return this.totalIncr;
	}
}
