// Output sources: what the user asked for, before any limit (reference spec §6).

import { BY_ID, makeProgram, type PresetDef } from '../presets/index.ts';
import type { Params, Program } from '../presets/programs.ts';
import {
	PyValueError,
	pmax,
	pyEqual,
	pyFloorDiv,
	pyInt,
	pyIter,
	pyReprStr,
	pyRound,
	pyStr,
	truthy
} from '../py.ts';
import { Rng, randomSeed } from '../rng.ts';
import { clamp01 } from './limits.ts';

export const ORDERS = ['loop', 'sequence', 'shuffle'] as const;
export type Order = (typeof ORDERS)[number];
/** 2 h at 100 ms */
export const MAX_SAMPLES = 72000;

export interface Source {
	readonly name: string;
	/** The (vibration, e-stim) wanted for this tick; then advance by dtMs. */
	sample(dtMs: number): [number, number];
}

export class Manual implements Source {
	readonly name = 'manual';
	vib: number;
	estim: number;

	constructor(vib: unknown = 0, estim: unknown = 0) {
		this.vib = clamp01(vib);
		this.estim = clamp01(estim);
	}

	set(vib: unknown, estim: unknown): void {
		this.vib = clamp01(vib);
		this.estim = clamp01(estim);
	}

	sample(): [number, number] {
		return [this.vib, this.estim];
	}

	snapshot(): { vib: number; estim: number } {
		return { vib: pyRound(this.vib, 4), estim: pyRound(this.estim, 4) };
	}
}

/** Share of the calibrated range, vibration / e-stim. */
export const DEFAULT_INTENSITY: readonly [number, number] = [0.8, 0.5];

export interface PresetOptions {
	estimOn?: boolean;
	/** full vibration (the "orgasm/flower" toggle), whatever the preset does */
	boost?: boolean;
	intensity?: { vib?: unknown; estim?: unknown } | null;
	/** "intensify slowly" */
	intensify?: boolean;
	/** generator parameters (snake_case keys, as in the schema) */
	params?: Record<string, unknown> | null;
	seed?: number | null;
}

/** A shaped or generated preset (SPEC §6.2, §6.4). Its values are fractions of the calibrated range; the session
 * maps them between floor and top. */
export class Preset implements Source {
	readonly name = 'preset';
	defn: PresetDef | null = null;
	program: Program | null = null;
	params: Params = {};
	seed: number | null = null;
	estimOn = false;
	boost = false;
	intensify = false;
	intensity: [number, number] = [...DEFAULT_INTENSITY];
	private given: Record<string, unknown> | null = null;

	constructor(presetId: string, opts: PresetOptions = {}) {
		this.configure(presetId, opts);
	}

	get done(): boolean {
		return this.program !== null && this.program.done;
	}

	/** Apply settings; a different preset, new parameters or a new seed restart the program. True if the preset
	 * itself changed (the session then resets its intensify budget). */
	configure(presetId: string, opts: PresetOptions = {}): boolean {
		const defn = BY_ID.get(presetId);
		if (!defn) throw new PyValueError(`unknown preset ${pyReprStr(String(presetId))}`);
		const { params = null, seed = null } = opts;
		const changed = this.defn === null || defn.id !== this.defn.id;
		if (
			changed ||
			(defn.generator && (!pyEqual(params ?? {}, this.given ?? {}) || (seed !== null && seed !== this.seed)))
		) {
			const made = makeProgram(defn, params, seed); // throws on bad params
			this.program = made.program;
			this.params = made.params;
			this.seed = made.seed;
			this.given = { ...(params ?? {}) };
		}
		this.defn = defn;
		this.estimOn = Boolean(opts.estimOn);
		this.boost = Boolean(opts.boost);
		this.intensify = Boolean(opts.intensify);
		const i = opts.intensity;
		if (i !== undefined && i !== null) {
			this.intensity = [
				clamp01(i.vib !== undefined ? i.vib : this.intensity[0]),
				clamp01(i.estim !== undefined ? i.estim : this.intensity[1])
			];
		}
		return changed;
	}

	sample(dtMs: number): [number, number] {
		let [v, e] = (this.program as Program).sample(dtMs);
		if (this.boost) v = 1;
		if (!this.estimOn) e = 0;
		return [v, e];
	}

	snapshot() {
		const d = this.defn as PresetDef;
		return {
			id: d.id,
			label: d.label,
			estimOn: this.estimOn,
			boost: this.boost,
			intensify: this.intensify,
			intensity: { vib: pyRound(this.intensity[0], 3), estim: pyRound(this.intensity[1], 3) },
			params: this.params,
			seed: this.seed,
			phase: this.program?.phase ?? ''
		};
	}
}

export interface PatternItemInput {
	name?: unknown;
	period_ms?: unknown;
	vib?: unknown;
	estim?: unknown;
}

export class PatternItem {
	readonly name: string;
	readonly periodMs: number;
	readonly vib: readonly number[];
	readonly estim: readonly number[];

	constructor(name: string, periodMs: number, vib: readonly number[], estim: readonly number[]) {
		this.name = name;
		this.periodMs = periodMs;
		this.vib = vib;
		this.estim = estim;
	}

	get samples(): number {
		return Math.max(this.vib.length, this.estim.length);
	}

	get durationMs(): number {
		return this.samples * this.periodMs;
	}

	/** From a saved mode or recording ({name, period_ms, vib, estim}, the ring-link-mode/1 keys). */
	static fromDict(d: PatternItemInput): PatternItem {
		if (d === null || typeof d !== 'object' || Array.isArray(d))
			throw new TypeError('a pattern must be an object');
		let period: number;
		let vib: number[];
		let estim: number[];
		try {
			period = pyInt('period_ms' in d ? d.period_ms : 100);
			vib = pyIter(truthy(d.vib) ? d.vib : []).map(clamp01);
			estim = pyIter(truthy(d.estim) ? d.estim : []).map(clamp01);
		} catch (e) {
			if (e instanceof PyValueError) throw new PyValueError(`bad pattern: ${e.message}`);
			throw e;
		}
		if (!(20 <= period && period <= 5000)) throw new PyValueError('period_ms must be 20..5000');
		const n = Math.max(vib.length, estim.length);
		if (n === 0 || n > MAX_SAMPLES) throw new PyValueError(`a pattern needs 1..${MAX_SAMPLES} samples`);
		const name = Array.from(pyStr(truthy(d.name) ? d.name : 'pattern'))
			.slice(0, 80)
			.join('');
		return new PatternItem(name, period, vib, estim);
	}
}

export class Pattern implements Source {
	readonly name = 'pattern';
	readonly items: PatternItem[];
	readonly order: Order;
	index: number;
	posMs = 0;
	plays = 0;
	private readonly rng: Rng;

	constructor(items: readonly PatternItem[], order: string = 'loop', startIndex: number = 0, rng?: Rng) {
		if (!items.length) throw new PyValueError('nothing to play');
		if (!(ORDERS as readonly string[]).includes(order))
			throw new PyValueError(`order must be one of ('loop', 'sequence', 'shuffle')`);
		this.items = [...items];
		this.order = order as Order;
		this.index = Math.min(pmax(pyInt(startIndex), 0), this.items.length - 1);
		this.rng = rng ?? new Rng(randomSeed());
	}

	get item(): PatternItem {
		return this.items[this.index] as PatternItem;
	}

	private advance(): void {
		this.plays += 1;
		const n = this.items.length;
		if (this.order === 'sequence') this.index = (this.index + 1) % n;
		else if (this.order === 'shuffle' && n > 1) {
			const others: number[] = [];
			for (let i = 0; i < n; i++) if (i !== this.index) others.push(i);
			this.index = this.rng.choice(others);
		}
		this.posMs = 0;
	}

	sample(dtMs: number): [number, number] {
		if (this.posMs >= this.item.durationMs) this.advance();
		const it = this.item;
		const i = Math.trunc(pyFloorDiv(this.posMs, it.periodMs));
		const v = i < it.vib.length ? (it.vib[i] as number) : 0;
		const e = i < it.estim.length ? (it.estim[i] as number) : 0;
		this.posMs += dtMs;
		return [v, e];
	}

	snapshot() {
		return {
			names: this.items.map((i) => i.name),
			order: this.order,
			index: this.index,
			positionS: pyRound(Math.min(this.posMs, this.item.durationMs) / 1000, 2),
			durationS: pyRound(this.item.durationMs / 1000, 2),
			plays: this.plays
		};
	}
}
