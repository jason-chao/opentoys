// Records the wanted values at 10 Hz for "My creations" (reference spec §6.3).

import { pyRound } from '../py.ts';

export const PERIOD_MS = 100;
export const MIN_S = 10;
export const MAX_S = 1800;

export interface Recording {
	periodMs: number;
	vib: number[];
	estim: number[];
	durationS: number;
	stoppedBy: string | null;
	longEnough: boolean;
}

export class Recorder {
	readonly periodMs: number;
	readonly maxS: number;
	active = false;
	vib: number[] = [];
	estim: number[] = [];
	stoppedBy: string | null = null;
	private acc = 0;

	constructor(periodMs = PERIOD_MS, maxS = MAX_S) {
		this.periodMs = periodMs;
		this.maxS = maxS;
	}

	get elapsedS(): number {
		return (this.vib.length * this.periodMs) / 1000;
	}

	start(): void {
		this.active = true;
		this.vib = [];
		this.estim = [];
		this.acc = 0;
		this.stoppedBy = null;
	}

	halt(why: string): void {
		if (this.active) {
			this.active = false;
			this.stoppedBy = why;
		}
	}

	feed(vib: number, estim: number, dtMs: number): void {
		if (!this.active) return;
		this.acc += dtMs;
		while (this.acc >= this.periodMs) {
			this.acc -= this.periodMs;
			this.vib.push(pyRound(vib, 4));
			this.estim.push(pyRound(estim, 4));
		}
		if (this.elapsedS >= this.maxS) this.halt('max_length');
	}

	/** Stop and hand over what was recorded (the recording is then cleared). */
	take(): Recording {
		this.halt('stopped');
		const out: Recording = {
			periodMs: this.periodMs,
			vib: this.vib,
			estim: this.estim,
			durationS: pyRound(this.elapsedS, 1),
			stoppedBy: this.stoppedBy,
			longEnough: this.elapsedS >= MIN_S
		};
		this.vib = [];
		this.estim = [];
		return out;
	}

	snapshot(): { active: boolean; elapsedS: number; stoppedBy: string | null } {
		return { active: this.active, elapsedS: pyRound(this.elapsedS, 1), stoppedBy: this.stoppedBy };
	}
}
