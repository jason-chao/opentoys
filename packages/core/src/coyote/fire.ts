// Momentary intensity burst: while held, the channel runs at `target` (still capped).
// Ported from the reference implementation (engine/fire.py).

import { toInt } from './limits.ts';

export class Fire {
	minValue = 1;
	maxValue = 200;
	/** the value the button is armed with */
	target = 10;
	active = false;
	/** the other channel's Fire while "fire both" is on */
	syncTo: Fire | null = null;
	/** a held Fire releases itself: a lost "release" must never stick */
	maxHoldMs = 15000;
	heldMs = 0;

	setTarget(v: number): void {
		this.target = Math.max(this.minValue, Math.min(this.maxValue, toInt(v)));
	}

	start(): void {
		this.active = true;
		this.heldMs = 0;
		if (this.syncTo !== null) {
			this.syncTo.target = this.target;
			this.syncTo.active = true;
			this.syncTo.heldMs = 0;
		}
	}

	end(): void {
		this.active = false;
		if (this.syncTo !== null) this.syncTo.active = false;
	}

	/** Advance the hold timer; returns true when the hold timed out on this tick. */
	tick(dtMs: number): boolean {
		if (!this.active) return false;
		this.heldMs += dtMs;
		if (this.heldMs >= this.maxHoldMs) {
			this.active = false;
			return true;
		}
		return false;
	}
}
