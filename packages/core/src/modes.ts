// Saved modes ("My creations"): the reference implementation's JSON format, kept compatible so the two apps can swap modes, and
// import of the vendor app's mode JSON (reference spec §6.3).
//
// One mode:  {"format": "ring-link-mode/1", "name", "period_ms", "vib": [..], "estim": [..]}
// Export:    {"format": "ring-link-modes/1", "modes": [<mode>, ...]}
// Vendor:    {"name", "duration": <s>, "wave": [lane1 = vibration, lane2 = e-stim, lane3 unused], "device"?}

import { clamp01 } from './engine/limits.ts';
import { MAX_SAMPLES } from './engine/sources.ts';
import { PyValueError, pyInt, pyIter, pyRound, pyStr, truthy } from './py.ts';

export const FORMAT = 'ring-link-mode/1';
export const EXPORT_FORMAT = 'ring-link-modes/1';
export const NAME_MAX = 40;

export class ModeError extends PyValueError {
	override name = 'ModeError';
}

/** A validated mode (in memory; export() writes the the reference implementation keys). */
export interface Mode {
	name: string;
	periodMs: number;
	vib: number[];
	estim: number[];
	durationS: number;
}

export interface ModeJson {
	format: typeof FORMAT;
	name: string;
	period_ms: number;
	vib: number[];
	estim: number[];
}

export interface ExportJson {
	format: typeof EXPORT_FORMAT;
	modes: ModeJson[];
}

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
	return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function lane(x: unknown): number[] {
	if (!Array.isArray(x)) throw new ModeError('lanes must be lists of numbers');
	return x.map((v) => pyRound(clamp01(v), 4));
}

function get(d: Obj, key: string, fallback: unknown): unknown {
	return Object.hasOwn(d, key) ? d[key] : fallback;
}

/** Validate one mode in the ring-link-mode/1 format. */
export function normalize(d: unknown): Mode {
	if (!isObj(d)) throw new ModeError('a mode must be an object');
	const trimmed = pyStr(truthy(d.name) ? d.name : '').trim();
	const name = Array.from(trimmed).slice(0, NAME_MAX).join('') || 'Untitled';
	let period: number;
	try {
		period = pyInt(get(d, 'period_ms', 100));
	} catch {
		throw new ModeError('period_ms must be an integer');
	}
	if (!(20 <= period && period <= 5000)) throw new ModeError('period_ms must be 20..5000');
	const vib = lane(get(d, 'vib', []));
	const estim = lane(get(d, 'estim', []));
	const n = Math.max(vib.length, estim.length);
	if (n === 0 || n > MAX_SAMPLES) throw new ModeError(`a mode needs 1..${MAX_SAMPLES} samples`);
	while (vib.length < n) vib.push(0);
	while (estim.length < n) estim.push(0);
	return { name, periodMs: period, vib, estim, durationS: pyRound((n * period) / 1000, 1) };
}

/** The vendor's recorded/shared mode. The sample period follows its player: 1000 / (n div duration). */
export function fromVendor(d: unknown): Mode {
	if (!isObj(d)) throw new ModeError('a mode must be an object');
	const wave = d.wave;
	if (!Array.isArray(wave) || wave.length === 0) throw new ModeError("vendor mode without a 'wave'");
	let duration: number;
	try {
		duration = pyInt(truthy(d.duration) ? d.duration : 0);
	} catch {
		throw new ModeError("vendor mode with a bad 'duration'");
	}
	const vib = lane(wave[0]);
	const estim = wave.length > 1 ? lane(wave[1]) : [];
	const n = Math.max(vib.length, estim.length);
	if (duration <= 0) throw new ModeError('vendor mode with zero duration');
	if (n < duration) throw new ModeError('vendor mode has fewer samples than seconds');
	const period = Math.trunc(1000 / Math.floor(n / duration));
	return normalize({ name: d.name, period_ms: period, vib, estim });
}

/** Accepts our export, a single mode of ours, a vendor mode, or a list of either. */
export function importAny(obj: unknown): Mode[] {
	let items: unknown[];
	if (isObj(obj) && obj.format === EXPORT_FORMAT) items = truthy(obj.modes) ? pyIter(obj.modes) : [];
	else if (Array.isArray(obj)) items = obj;
	else items = [obj];
	const out = items.map((it) => (isObj(it) && Object.hasOwn(it, 'wave') ? fromVendor(it) : normalize(it)));
	if (!out.length) throw new ModeError('no modes found');
	return out;
}

export function exportModes(modes: readonly Mode[]): ExportJson {
	return {
		format: EXPORT_FORMAT,
		modes: modes.map((m) => ({
			format: FORMAT,
			name: m.name,
			period_ms: m.periodMs,
			vib: m.vib,
			estim: m.estim
		}))
	};
}
