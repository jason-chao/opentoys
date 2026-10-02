// Comfort ceiling with an overheat budget. Running above `comfortMax` fills a budget over `upSpeed` seconds; when
// full the absolute ceiling drops to the comfort ceiling for `overheatDuration` seconds. `autoIncr` lets the
// ceilings creep up by 1 every `incrTime` seconds of output (and back down every `decrTime` seconds of silence).
// Ported from the reference implementation (engine/comfort.py).

import { toInt } from './limits.ts';

export interface ComfortSettings {
	/** "complex" (with overheat) or "simple" */
	mode: 'complex' | 'simple';
	comfortMax: number;
	absoluteMax: number;
	upSpeed: number;
	downSpeed: number;
	downDuration: number;
	overheatDuration: number;
	autoIncr: boolean;
	autoIncrMax: number;
	/** bit0 raise comfortMax, bit1 raise absoluteMax */
	autoIncrScope: number;
	incrTime: number;
	decrTime: number;
	overheat: boolean;
	overheatPct: number;
	totalIncr: number;
}

const KEYS: readonly (keyof ComfortSettings)[] = [
	'mode',
	'comfortMax',
	'absoluteMax',
	'upSpeed',
	'downSpeed',
	'downDuration',
	'overheatDuration',
	'autoIncr',
	'autoIncrMax',
	'autoIncrScope',
	'incrTime',
	'decrTime',
	'overheat',
	'overheatPct',
	'totalIncr'
];

export class ComfortLimit implements ComfortSettings {
	mode: 'complex' | 'simple' = 'complex';
	comfortMax = 80;
	absoluteMax = 100;
	upSpeed = 20;
	downSpeed = 10;
	downDuration = 3;
	overheatDuration = 60;
	autoIncr = false;
	autoIncrMax = 20;
	autoIncrScope = 3;
	incrTime = 20;
	decrTime = 20;
	overheat = false;
	overheatPct = 0;
	totalIncr = 0;
	private overheatMs = 0;
	private downMs = 0;
	private incrMs = 0;
	private decrMs = 0;

	constructor(settings: Partial<ComfortSettings> = {}) {
		Object.assign(this, settings); // as given, like the reference implementation's constructor: configure() is what bounds values
	}

	/** Change settings; values are then forced into their ranges. An unknown key throws. */
	configure(kw: Partial<ComfortSettings>): void {
		const mode = kw.mode ?? this.mode;
		if (mode === 'simple' && this.mode === 'complex') {
			this.overheat = false;
			this.overheatPct = 0;
			this.overheatMs = 0;
		}
		const auto = kw.autoIncr ?? this.autoIncr;
		if (auto !== this.autoIncr) {
			this.incrMs = 0;
			this.decrMs = 0;
			this.totalIncr = 0;
		}
		for (const [k, v] of Object.entries(kw)) {
			if (!(KEYS as readonly string[]).includes(k)) throw new Error(`unknown comfort setting: ${k}`);
			if (v !== undefined) (this as Record<string, unknown>)[k] = v;
		}
		this.absoluteMax = Math.max(1, Math.min(200, toInt(this.absoluteMax)));
		this.comfortMax = Math.max(1, Math.min(this.absoluteMax, toInt(this.comfortMax)));
		this.upSpeed = Math.max(1, toInt(this.upSpeed));
		this.downSpeed = Math.max(1, toInt(this.downSpeed));
		this.downDuration = Math.max(1, toInt(this.downDuration));
		this.overheatDuration = Math.max(1, toInt(this.overheatDuration));
		this.incrTime = Math.max(1, toInt(this.incrTime));
		this.decrTime = Math.max(1, toInt(this.decrTime));
		this.autoIncrScope = this.mode === 'simple' ? 2 : toInt(this.autoIncrScope);
		this.totalIncr = Math.max(0, Math.min(this.autoIncrMax, this.totalIncr));
	}

	get totalAbsoluteMax(): number {
		if (this.autoIncr && this.autoIncrScope & 2) return Math.min(200, this.absoluteMax + this.totalIncr);
		return this.absoluteMax;
	}

	get totalComfortMax(): number {
		if (this.autoIncr && this.autoIncrScope & 1)
			return Math.min(200, this.comfortMax + this.totalIncr, this.totalAbsoluteMax);
		return Math.min(this.comfortMax, this.totalAbsoluteMax);
	}

	/** The ceiling in force now. */
	get maxStrength(): number {
		if (this.overheat && this.mode === 'complex')
			return Math.min(this.totalComfortMax, this.totalAbsoluteMax);
		return this.totalAbsoluteMax;
	}

	tick(dtMs: number, realIntensity: number, silentLastRun: boolean): number {
		if (this.autoIncr) {
			if (silentLastRun) {
				this.incrMs = 0;
				this.decrMs += dtMs;
				if (this.decrMs >= this.decrTime * 1000) {
					this.decrMs -= this.decrTime * 1000;
					if (this.totalIncr > 0) this.totalIncr -= 1;
				}
			} else {
				this.decrMs = 0;
				this.incrMs += dtMs;
				if (this.incrMs >= this.incrTime * 1000) {
					this.incrMs -= this.incrTime * 1000;
					if (this.totalIncr < this.autoIncrMax) this.totalIncr += 1;
				}
			}
		}
		if (this.mode !== 'simple') {
			if (this.overheat) {
				this.overheatMs += dtMs;
				this.overheatPct = Math.max(0, 100 * (1 - this.overheatMs / (this.overheatDuration * 1000)));
				if (this.overheatMs >= this.overheatDuration * 1000) {
					this.overheat = false;
					this.overheatMs = 0;
				}
			} else if (!silentLastRun && realIntensity > this.totalComfortMax) {
				this.downMs = 0;
				if (this.overheatPct < 100) {
					this.overheatPct = Math.min(100, this.overheatPct + 10 / this.upSpeed);
					if (this.overheatPct >= 100) {
						this.overheatMs = 0;
						this.overheat = true;
					}
				}
			} else {
				this.downMs += dtMs;
				if (this.downMs >= this.downDuration * 1000 && this.overheatPct > 0)
					this.overheatPct = Math.max(0, this.overheatPct - 10 / this.downSpeed);
			}
		}
		return this.maxStrength;
	}
}
