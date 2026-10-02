// The output session: one source, the safety pipeline, the recorder (reference spec §7).
//
// Every tick: source → clamp 0..1 → calibrated mapping (+ "intensify slowly") for presets → comfort maximum →
// hard caps → warm-up scale → e-stim rise limit → session maximum. stop() is the single place output ends; a new
// source starts again from zero.
//
// suppressEstim() is what happens when the page is hidden (for the Dragon S1, following the reference implementation): e-stim fades
// to 0 over at most 1 s and stays off until the next output command; vibration carries on.

import { level } from '../level.ts';
import { pmax, pmin, pyRound } from '../py.ts';
import { Rng } from '../rng.ts';
import { DEFAULT_CAPS, HardCaps, Limits, clamp01, type LimitValues } from './limits.ts';
import { Recorder } from './recorder.ts';
import {
	Manual,
	Pattern,
	PatternItem,
	Preset,
	type PatternItemInput,
	type PresetOptions,
	type Source
} from './sources.ts';

/** unattended e-stim falls by at most 100 % per second (0 within 1 s) */
export const ESTIM_FADE_PER_S = 1.0;
export const TICK_MS = 50;
/** "intensify slowly": at most +15 % … */
export const CREEP_MAX = 0.15;
/** … reached after 10 min of output */
export const CREEP_FULL_MS = 600_000;
/** 10 s without output starts it again from 0 */
export const CREEP_RESET_MS = 10_000;

/** One tick's result. vib/estim are what goes to the device, after every limit; live = either byte > 0. */
export interface Out {
	source: string;
	wantVib: number;
	wantEstim: number;
	vib: number;
	estim: number;
	warm: number;
	stopped: string | null;
	live: boolean;
}

function out(
	source: string,
	wantVib: number,
	wantEstim: number,
	vib: number,
	estim: number,
	warm: number,
	stopped: string | null
): Out {
	return { source, wantVib, wantEstim, vib, estim, warm, stopped, live: level(vib) > 0 || level(estim) > 0 };
}

export class Session {
	readonly caps: HardCaps;
	limits: Limits;
	source: Source | null = null;
	stoppedReason: string | null = null;
	warm = 0;
	outVib = 0;
	outEstim = 0;
	outputMs = 0;
	readonly recorder = new Recorder();
	estimSuppressed = false;
	/** "intensify slowly": output time counted towards the creep */
	creepMs = 0;
	quietMs = 0;

	constructor(limits?: Limits | Partial<LimitValues> | null, caps: HardCaps = DEFAULT_CAPS) {
		this.caps = caps;
		const lim = limits instanceof Limits ? limits : new Limits(limits ?? {});
		this.limits = lim.bounded(this.caps);
	}

	// ----- intents --------------------------------------------------------------------------------------------
	setLimits(kw: Partial<Record<keyof LimitValues, unknown>>): Limits {
		this.limits = this.limits.update(this.caps, kw);
		return this.limits;
	}

	private start(src: Source): void {
		if (this.source === null) {
			this.outputMs = 0;
			this.warm = 0;
		}
		this.stoppedReason = null;
		this.estimSuppressed = false;
		this.resetCreep();
		this.source = src;
	}

	private resetCreep(): void {
		this.creepMs = 0;
		this.quietMs = 0;
	}

	setManual(vib: number, estim: number): void {
		if (this.source instanceof Manual) {
			this.source.set(vib, estim);
			this.estimSuppressed = false;
		} else this.start(new Manual(vib, estim));
	}

	setPreset(presetId: string, opts: PresetOptions = {}): void {
		if (this.source instanceof Preset) {
			if (this.source.configure(presetId, opts)) this.resetCreep();
			this.estimSuppressed = false;
		} else this.start(new Preset(presetId, opts));
	}

	/** Play saved modes / recordings. `seed` fixes the shuffle order (tests); by default it is random. */
	play(items: readonly PatternItemInput[], order = 'loop', startIndex = 0, seed?: number): void {
		const parsed = items.map((d) => PatternItem.fromDict(d));
		this.start(new Pattern(parsed, order, startIndex, seed === undefined ? undefined : new Rng(seed)));
	}

	/** The page is hidden: e-stim off until the next output command, vibration continues. The source's own e-stim
	 * setting is cleared too, so the page shows e-stim as off when it returns. True if anything changed. */
	suppressEstim(): boolean {
		if (this.source === null || this.estimSuppressed) return false;
		this.estimSuppressed = true;
		if (this.source instanceof Manual) this.source.estim = 0;
		else if (this.source instanceof Preset) this.source.estimOn = false;
		return true;
	}

	stop(reason: string): void {
		this.source = null;
		this.stoppedReason = reason;
		this.estimSuppressed = false;
		this.warm = 0;
		this.outVib = 0;
		this.outEstim = 0;
		this.recorder.halt(reason);
	}

	// ----- one tick -------------------------------------------------------------------------------------------
	tick(dtMs: number): Out {
		const src = this.source;
		if (src === null) {
			this.warm = 0;
			this.outVib = 0;
			this.outEstim = 0;
			return out('none', 0, 0, 0, 0, 0, this.stoppedReason);
		}
		const [sv, se] = src.sample(dtMs);
		let wv = clamp01(sv);
		let we = clamp01(se);
		if (src instanceof Preset && src.done) {
			// a program that ends by itself (session arc)
			this.stop('finished');
			return out('none', 0, 0, 0, 0, 0, 'finished');
		}
		const lim = this.limits;
		const caps = this.caps;
		if (src instanceof Preset) [wv, we] = this.map(src, wv, we, dtMs);
		let v = pmin(wv, lim.maxVib, caps.vib);
		let e = pmin(we, lim.maxEstim, caps.estim);
		this.warm = lim.warmupS <= 0 ? 1 : pmin(1, this.warm + dtMs / 1000 / lim.warmupS);
		v *= this.warm;
		e *= this.warm;
		const rise = ((lim.estimRampPctS / 100) * dtMs) / 1000;
		if (this.estimSuppressed) {
			we = 0;
			e = pmax(0, this.outEstim - (ESTIM_FADE_PER_S * dtMs) / 1000);
		} else if (e > this.outEstim) e = pmin(e, this.outEstim + rise);
		this.outVib = v;
		this.outEstim = e;
		this.recorder.feed(wv, we, dtMs);
		const o = out(src.name, wv, we, v, e, this.warm, null);
		if (o.live) {
			this.outputMs += dtMs;
			if (this.outputMs >= lim.sessionMaxS * 1000) {
				this.stop('session_max');
				return out('none', wv, we, 0, 0, 0, 'session_max');
			}
		}
		return o;
	}

	/** Calibrated range (SPEC §6.4): 0 stays off; p > 0 lands between the channel's floor and its top, where
	 * top = floor + intensity · (comfort max − floor). "Intensify slowly" raises the top by up to 15 % over 10 min
	 * of output, reset by 10 s without output, a stop or another preset; never above the comfort max. */
	private map(src: Preset, pv: number, pe: number, dtMs: number = TICK_MS): [number, number] {
		const lim = this.limits;
		const caps = this.caps;
		let boost = 0;
		if (src.intensify) {
			const live = pv > 0 || pe > 0;
			this.quietMs = live ? 0 : this.quietMs + dtMs;
			if (this.quietMs >= CREEP_RESET_MS) this.creepMs = 0;
			else if (live) this.creepMs += dtMs;
			boost = CREEP_MAX * pmin(1, this.creepMs / CREEP_FULL_MS);
		}
		const [iv, ie] = src.intensity;
		const one = (p: number, floor: number, cap: number, inten: number): number => {
			if (p <= 0 || cap <= 0) return 0;
			floor = pmin(floor, cap);
			const top = floor + inten * (cap - floor);
			return pmin(cap, (floor + p * (top - floor)) * (1 + boost));
		};
		return [
			one(pv, lim.vibFloor, pmin(lim.maxVib, caps.vib), iv),
			one(pe, lim.estimFloor, pmin(lim.maxEstim, caps.estim), ie)
		];
	}

	get creepPct(): number {
		const src = this.source;
		if (!(src instanceof Preset) || !src.intensify) return 0;
		return pyRound(CREEP_MAX * pmin(1, this.creepMs / CREEP_FULL_MS) * 100, 1);
	}

	// ----- views ----------------------------------------------------------------------------------------------
	snapshot() {
		const src = this.source;
		return {
			source: src ? src.name : 'none',
			stopped: this.stoppedReason,
			live: level(this.outVib) > 0 || level(this.outEstim) > 0,
			sessionS: pyRound(this.outputMs / 1000, 1),
			limits: this.limits.asDict(),
			hardMax: { vib: this.caps.vib, estim: this.caps.estim },
			manual: src instanceof Manual ? src.snapshot() : null,
			preset: src instanceof Preset ? src.snapshot() : null,
			pattern: src instanceof Pattern ? src.snapshot() : null,
			recording: this.recorder.snapshot(),
			estimSuppressed: this.estimSuppressed,
			creepPct: this.creepPct,
			out: { vib: pyRound(this.outVib, 4), estim: pyRound(this.outEstim, 4) }
		};
	}

	patternNames(): string[] {
		return this.source instanceof Pattern ? this.source.items.map((i) => i.name) : [];
	}
}
