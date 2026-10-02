// The built-in patterns as the app shows them: the catalogue from packages/core (with preview thumbnails), how
// they are grouped, and their translated names, descriptions and parameter labels.
import { BY_ID, catalogue, preview, type CatalogueItem, type Param } from '@opentoys/core';
import { m } from '$lib/paraglide/messages';
import { duration, pct } from './format.ts';

export type Section = 'vibration' | 'combined' | 'generated';
export const SECTIONS: readonly Section[] = ['vibration', 'combined', 'generated'];

/** Kinds of vibration pattern, for the filter chips (derived from the catalogue's tags). */
export const KINDS = ['steady', 'pulses', 'waves', 'rhythms', 'buildups'] as const;
export type Kind = (typeof KINDS)[number];

const KIND_OF_TAG: Record<string, Kind> = {
	constant: 'steady',
	texture: 'steady',
	pulse: 'pulses',
	wave: 'waves',
	rhythm: 'rhythms',
	ramp: 'buildups',
	steps: 'buildups',
	escalation: 'buildups',
	edging: 'buildups'
};

/** The kind of a pattern: its first tag that names one (tags are ordered most telling first). */
export function kindOf(tags: readonly string[]): Kind | null {
	for (const t of tags) if (KIND_OF_TAG[t]) return KIND_OF_TAG[t];
	return null;
}

export const ITEMS: readonly CatalogueItem[] = catalogue(false);
export const ITEM_BY_ID: ReadonlyMap<string, CatalogueItem> = new Map(ITEMS.map((i) => [i.id, i]));
export const itemsIn = (section: Section) => ITEMS.filter((i) => i.category === section);

const TEXT: Record<string, readonly [() => string, () => string]> = {
	steady: [m.preset_steady_name, m.preset_steady_desc],
	'slow-pulse': [m.preset_slow_pulse_name, m.preset_slow_pulse_desc],
	'quick-pulse': [m.preset_quick_pulse_name, m.preset_quick_pulse_desc],
	knock: [m.preset_knock_name, m.preset_knock_desc],
	heartbeat: [m.preset_heartbeat_name, m.preset_heartbeat_desc],
	breath: [m.preset_breath_name, m.preset_breath_desc],
	tide: [m.preset_tide_name, m.preset_tide_desc],
	wave: [m.preset_wave_name, m.preset_wave_desc],
	stroke: [m.preset_stroke_name, m.preset_stroke_desc],
	climb: [m.preset_climb_name, m.preset_climb_desc],
	waterfall: [m.preset_waterfall_name, m.preset_waterfall_desc],
	staircase: [m.preset_staircase_name, m.preset_staircase_desc],
	build: [m.preset_build_name, m.preset_build_desc],
	tease: [m.preset_tease_name, m.preset_tease_desc],
	rhythm: [m.preset_rhythm_name, m.preset_rhythm_desc],
	flutter: [m.preset_flutter_name, m.preset_flutter_desc],
	'tingle-bed': [m.preset_tingle_bed_name, m.preset_tingle_bed_desc],
	'breath-together': [m.preset_breath_together_name, m.preset_breath_together_desc],
	'counter-breath': [m.preset_counter_breath_name, m.preset_counter_breath_desc],
	'heart-accent': [m.preset_heart_accent_name, m.preset_heart_accent_desc],
	'split-pulse': [m.preset_split_pulse_name, m.preset_split_pulse_desc],
	'split-swell': [m.preset_split_swell_name, m.preset_split_swell_desc],
	'climb-together': [m.preset_climb_together_name, m.preset_climb_together_desc],
	toggle: [m.preset_toggle_name, m.preset_toggle_desc],
	'stroke-tingle': [m.preset_stroke_tingle_name, m.preset_stroke_tingle_desc],
	'tide-pair': [m.preset_tide_pair_name, m.preset_tide_pair_desc],
	'edge-pair': [m.preset_edge_pair_name, m.preset_edge_pair_desc],
	finale: [m.preset_finale_name, m.preset_finale_desc],
	'gen-shape': [m.preset_gen_shape_name, m.preset_gen_shape_desc],
	'gen-rhythm': [m.preset_gen_rhythm_name, m.preset_gen_rhythm_desc],
	'gen-drift': [m.preset_gen_drift_name, m.preset_gen_drift_desc],
	'gen-pink': [m.preset_gen_pink_name, m.preset_gen_pink_desc],
	'gen-surprise': [m.preset_gen_surprise_name, m.preset_gen_surprise_desc],
	'gen-wander': [m.preset_gen_wander_name, m.preset_gen_wander_desc],
	'gen-edge': [m.preset_gen_edge_name, m.preset_gen_edge_desc],
	'gen-arc': [m.preset_gen_arc_name, m.preset_gen_arc_desc]
};

const PARAM: Record<string, () => string> = {
	shape: m.param_shape,
	period_s: m.param_period_s,
	depth: m.param_depth,
	duty: m.param_duty,
	k: m.param_k,
	n: m.param_n,
	bpm: m.param_bpm,
	swing: m.param_swing,
	accent: m.param_accent,
	level: m.param_level,
	mean: m.param_mean,
	spread: m.param_spread,
	tau_s: m.param_tau_s,
	speed: m.param_speed,
	p: m.param_p,
	family: m.param_family,
	dwell_min_s: m.param_dwell_min_s,
	dwell_max_s: m.param_dwell_max_s,
	build_min_s: m.param_build_min_s,
	build_max_s: m.param_build_max_s,
	pause_min_s: m.param_pause_min_s,
	pause_max_s: m.param_pause_max_s,
	peak: m.param_peak,
	creep: m.param_creep,
	length_min: m.param_length_min,
	estim_mode: m.param_estim_mode,
	estim_level: m.param_estim_level
};

const CHOICE: Record<string, Record<string, () => string>> = {
	shape: {
		wave: m.choice_shape_wave,
		breath: m.choice_shape_breath,
		pulse: m.choice_shape_pulse,
		stroke: m.choice_shape_stroke,
		heartbeat: m.choice_shape_heartbeat
	},
	family: {
		all: m.choice_family_all,
		vibration: m.choice_family_vibration,
		combined: m.choice_family_combined
	},
	estim_mode: {
		follow: m.choice_estim_mode_follow,
		counter: m.choice_estim_mode_counter,
		steady: m.choice_estim_mode_steady,
		off: m.choice_estim_mode_off
	}
};

export interface Lanes {
	vib: number[];
	estim: number[];
	/** Seconds covered. */
	seconds: number;
}

const TICK_S = 0.05;
/** Short loops are shown repeated over at least this long, so pulses read as pulses. */
const MIN_SHOWN_S = 6;

/** At most `points` values: the largest in each bucket (a peak never disappears from a thumbnail). */
export function bucketMax(values: readonly number[], points: number): number[] {
	if (values.length <= points) return [...values];
	const out: number[] = [];
	for (let b = 0; b < points; b++) {
		const from = Math.floor((b * values.length) / points);
		const to = Math.max(from + 1, Math.floor(((b + 1) * values.length) / points));
		let mx = 0;
		for (let i = from; i < to; i++) mx = Math.max(mx, values[i]);
		out.push(mx);
	}
	return out;
}

/**
 * The waveform to draw: a shaped pattern's own lanes (each channel loops on its own), repeated to at least
 * MIN_SHOWN_S; an adjustable one as a 60-second example for the given settings and seed.
 */
export function lanesFor(
	id: string,
	points = 120,
	params: Record<string, number | string> | null = null,
	seed = 1
): Lanes {
	const d = BY_ID.get(id);
	if (!d) return { vib: [], estim: [], seconds: 0 };
	if (d.generator) {
		const pv = preview(id, 60, seed, params, Math.max(points, 240));
		return { vib: bucketMax(pv.vib, points), estim: bucketMax(pv.estim, points), seconds: pv.seconds };
	}
	const loop = Math.max(d.vib.length, d.estim.length, 1);
	const n = loop * TICK_S >= MIN_SHOWN_S ? loop : loop * Math.ceil(MIN_SHOWN_S / (loop * TICK_S));
	const tile = (lane: readonly number[]) =>
		lane.length ? Array.from({ length: n }, (_, i) => lane[i % lane.length]) : new Array<number>(n).fill(0);
	return {
		vib: bucketMax(tile(d.vib), points),
		estim: bucketMax(tile(d.estim), points),
		seconds: Math.round(n * TICK_S * 100) / 100
	};
}

/** Thumbnails for the list, computed once. */
export const THUMBS: ReadonlyMap<string, Lanes> = new Map(ITEMS.map((i) => [i.id, lanesFor(i.id, 120)]));

/** A pattern that stays at one level (no waveform to speak of). */
export const isConstant = (id: string): boolean => {
	const d = BY_ID.get(id);
	return !!d && !d.generator && new Set(d.vib).size <= 1 && new Set(d.estim).size <= 1;
};

export const presetName = (id: string): string => TEXT[id]?.[0]() ?? id;
export const presetDescription = (id: string): string => TEXT[id]?.[1]() ?? '';
export const hasText = (id: string): boolean => id in TEXT;

export const paramLabel = (p: Param): string => PARAM[p.key]?.() ?? p.label;

/** One plain line under a control whose label can't say it all. Keyed by setting, or by generator and setting
 * where the same setting means something narrower. */
const HINT: Record<string, () => string> = {
	tau_s: m.hint_tau_s,
	p: m.hint_p,
	duty: m.hint_duty,
	'shape:duty': m.hint_duty_shape,
	k: m.hint_k,
	spread: m.hint_spread,
	creep: m.hint_creep
};
export const paramHint = (item: CatalogueItem, p: Param): string =>
	(HINT[`${item.generator}:${p.key}`] ?? HINT[p.key])?.() ?? '';
export const choiceLabel = (key: string, option: string): string => CHOICE[key]?.[option]?.() ?? option;

/** A parameter value as shown next to its control. */
export function paramValue(p: Param, value: number | string): string {
	if (p.type === 'choice') return choiceLabel(p.key, String(value));
	const v = Number(value);
	if (p.unit === 's' || p.unit === 'min') return duration(p.unit === 'min' ? v * 60 : v);
	if (p.unit === 'bpm') return m.unit_bpm({ n: v });
	if (p.unit === '×') return m.unit_times({ n: v });
	if (p.integer) return String(v);
	return pct(v);
}

/** The generators that are a fixed cycle (no randomness): the same settings repeat exactly. */
const CYCLIC = new Set(['shape', 'euclid']);

/** Whether a pattern varies at random (a new seed gives a different session; it never repeats exactly). */
export const isRandom = (item: CatalogueItem): boolean => !!item.generator && !CYCLIC.has(item.generator);

/** A generator setting, or its default. */
function param(item: CatalogueItem, params: Record<string, number | string> | null | undefined, key: string) {
	return params?.[key] ?? item.schema.find((p) => p.key === key)?.default;
}

/**
 * One cycle of a fixed-cycle generator, in seconds (as packages/core computes it: shape clamps short periods
 * so full-depth pulses stay >= 100 ms; the rhythm's swing pairs two eighth notes, so an odd step count takes
 * two rounds to line up).
 */
function cycleS(item: CatalogueItem, params: Record<string, number | string> | null | undefined): number {
	if (item.generator === 'shape') {
		const shape = String(param(item, params, 'shape'));
		let ms = Math.max(0.3, Number(param(item, params, 'period_s'))) * 1000;
		if (shape === 'pulse') ms = Math.max(ms, 200);
		if (shape === 'heartbeat') ms = Math.max(ms, 850);
		return ms / 1000;
	}
	const n = Number(param(item, params, 'n'));
	const eighth = 60 / Number(param(item, params, 'bpm')) / 2;
	return (n % 2 ? 2 * n : n) * eighth;
}

/** How long it runs: repeats every …, never repeats, or ends after … */
export function lengthText(item: CatalogueItem, params?: Record<string, number | string> | null): string {
	if (isConstant(item.id)) return m.length_constant();
	if (item.loopS) return m.length_repeats({ time: duration(item.loopS) });
	if (item.generator === 'arc')
		return m.length_ends({ time: duration(Number(param(item, params, 'length_min') ?? 12) * 60) });
	if (item.generator && CYCLIC.has(item.generator))
		return m.length_repeats({ time: duration(Math.round(cycleS(item, params) * 100) / 100) });
	return m.length_never();
}
