// The preset catalogue (reference spec §6.2 and §6.4): shaped presets rendered from the envelope language in
// library/*.json, plus live generators (programs.ts). The engine plays them; the app shows the same catalogue and
// previews, computed by the same code.
//
// Only our own designs: the reference implementation's three vendor originals (original.json: raw device levels, Level X1–X3, constant
// e-stim) are not part of opentoys, and neither is the code that only served them (the "raw" mapping, LEVEL_STEP).

import { PyValueError, pyFloorDiv, pyInt, pyMod, pyRound, truthy } from '../py.ts';
import { Rng, randomSeed } from '../rng.ts';
import { sha256Hex } from '../sha256.ts';
import combinedLib from './library/combined.json';
import vibrationLib from './library/vibration.json';
import {
	GENERATORS,
	LaneProgram,
	WanderGen,
	validate,
	type GeneratorName,
	type Param,
	type Params,
	type PoolItem,
	type Program
} from './programs.ts';
import { TICK_MS, maxRisePctS, renderChannel, type ChannelSpec } from './render.ts';

export * from './programs.ts';
export * from './render.ts';

export const CATEGORIES = ['vibration', 'combined', 'generated'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface PresetDef {
	readonly id: string;
	readonly label: string;
	readonly category: Category;
	readonly description: string;
	readonly tags: readonly string[];
	/** shaped presets: one value per 50 ms tick, looping per channel */
	readonly vib: readonly number[];
	readonly estim: readonly number[];
	readonly generator: GeneratorName | null;
	readonly schema: readonly Param[];
	readonly hasEstim: boolean;
	/** the fastest e-stim rise the preset needs, % of the range per second (generators: 100) */
	readonly estimRisePctS: number;
	/** one loop in seconds (generators: null) */
	readonly loopS: number | null;
}

function define(
	d: Omit<PresetDef, 'hasEstim' | 'estimRisePctS' | 'loopS'> & { generator: GeneratorName | null }
): PresetDef {
	const gen = d.generator !== null;
	return {
		...d,
		hasEstim: gen || d.estim.some((x) => x > 0),
		estimRisePctS: d.estim.length ? maxRisePctS(d.estim) : gen ? 100 : 0,
		loopS: gen ? null : pyRound((Math.max(d.vib.length, d.estim.length) * TICK_MS) / 1000, 2)
	};
}

// [id, label, generator, description, tags]
const GENERATED: [string, string, GeneratorName, string, string[]][] = [
	[
		'gen-shape',
		'Adjustable shape',
		'shape',
		'Wave, breath, pulse, stroke or heartbeat, with the period and depth you choose.',
		['repeating', 'adjustable']
	],
	[
		'gen-rhythm',
		'Rhythm maker',
		'euclid',
		'Evenly spread beats (Euclidean rhythms) at your tempo, with swing and an accent.',
		['repeating', 'rhythm']
	],
	[
		'gen-drift',
		'Drift',
		'drift',
		'Wanders smoothly around a level, never the same twice.',
		['never repeats', 'smooth']
	],
	[
		'gen-pink',
		'Natural texture',
		'pink',
		'1/f fluctuation, the kind of variation found in music and speech.',
		['never repeats', 'texture']
	],
	[
		'gen-surprise',
		'Surprise',
		'surprise',
		'A steady pulse that now and then accents, skips a beat or pauses.',
		['never repeats', 'rhythm']
	],
	[
		'gen-wander',
		'Wander',
		'wander',
		'Moves between the presets here, staying 20–60 s on each, with smooth crossfades.',
		['never repeats', 'medley']
	],
	[
		'gen-edge',
		'Edge',
		'edge',
		'Builds, hovers near the top, then stops completely; lengths vary and the peak creeps up.',
		['never repeats', 'edging']
	],
	[
		'gen-arc',
		'Session arc',
		'arc',
		'A whole session: warm-up, build, plateau, peaks and cool-down, then it ends by itself.',
		['never repeats', 'session']
	]
];

interface LibraryPreset {
	id: string;
	label: string;
	category: string;
	description?: string;
	tags?: string[];
	vib: unknown;
	estim?: unknown;
}

function load(): PresetDef[] {
	const defs: PresetDef[] = [];
	for (const lib of [vibrationLib, combinedLib] as unknown as { presets: LibraryPreset[] }[]) {
		for (const p of lib.presets) {
			const vib = renderChannel(p.vib as ChannelSpec);
			const estim = truthy(p.estim) ? renderChannel(p.estim as ChannelSpec, vib) : [];
			defs.push(
				define({
					id: p.id,
					label: p.label,
					category: p.category as Category,
					description: p.description ?? '',
					tags: [...(p.tags ?? [])],
					vib,
					estim,
					generator: null,
					schema: []
				})
			);
		}
	}
	for (const [id, label, gen, description, tags] of GENERATED) {
		defs.push(
			define({
				id,
				label,
				category: 'generated',
				description,
				tags,
				vib: [],
				estim: [],
				generator: gen,
				schema: GENERATORS[gen].SCHEMA
			})
		);
	}
	if (new Set(defs.map((d) => d.id)).size !== defs.length) throw new Error('duplicate preset id');
	return defs;
}

export const PRESETS: readonly PresetDef[] = load();
export const BY_ID: ReadonlyMap<string, PresetDef> = new Map(PRESETS.map((d) => [d.id, d]));
export const IDS: readonly string[] = PRESETS.map((d) => d.id);

function wanderPool(family: string): PoolItem[] {
	return PRESETS.filter((d) => d.generator === null && (family === 'all' || d.category === family)).map(
		(d) => [d.id, d.label, [...d.vib], [...d.estim]]
	);
}

export interface MadeProgram {
	program: Program;
	/** validated parameters (defaults filled in) */
	params: Params;
	/** the seed actually used (null for shaped presets) */
	seed: number | null;
}

/** A fresh program for a preset, with validated parameters and the seed actually used. */
export function makeProgram(
	defn: PresetDef,
	params?: Record<string, unknown> | null,
	seed?: number | null
): MadeProgram {
	if (defn.generator === null) {
		if (truthy(params)) throw new PyValueError('this preset has no parameters');
		return { program: new LaneProgram(defn.vib, defn.estim), params: {}, seed: null };
	}
	const clean = validate(defn.schema, params);
	const used = pyMod(pyInt(seed ?? randomSeed()), 1_000_000) || 1;
	const rng = new Rng(used);
	const program =
		defn.generator === 'wander'
			? new WanderGen(clean, rng, wanderPool)
			: new (GENERATORS[defn.generator] as new (p: Params, r: Rng) => Program)(clean, rng);
	return { program, params: clean, seed: used };
}

export interface Preview {
	id: string;
	seconds: number;
	stepMs: number;
	vib: number[];
	estim: number[];
	params: Params;
	seed: number | null;
}

function get(id: string): PresetDef {
	const d = BY_ID.get(id);
	if (!d) throw new PyValueError(`unknown preset ${id}`);
	return d;
}

/** Pattern values (not mapped) for a graph: at most `points` samples over `seconds` (or one loop). */
export function preview(
	presetId: string,
	seconds = 60,
	seed = 1,
	params: Record<string, unknown> | null = null,
	points = 240
): Preview {
	const d = get(presetId);
	if (points < 1) throw new RangeError('points must be at least 1');
	if (d.generator === null) seconds = Math.min(seconds, d.loopS || seconds);
	const { program, params: clean, seed: used } = makeProgram(d, params, d.generator ? seed : null);
	const n = Math.max(1, Math.trunc((seconds * 1000) / TICK_MS));
	const every = Math.max(1, Math.trunc(pyFloorDiv(n, points)));
	const vib: number[] = [];
	const estim: number[] = [];
	for (let i = 0; i < n; i++) {
		const [v, e] = program.sample(TICK_MS);
		if (i % every === 0) {
			vib.push(pyRound(v, 3));
			estim.push(pyRound(e, 3));
		}
		if (program.done) break;
	}
	return {
		id: presetId,
		seconds: pyRound((vib.length * every * TICK_MS) / 1000, 2),
		stepMs: every * TICK_MS,
		vib,
		estim,
		params: clean,
		seed: used
	};
}

export interface CatalogueItem {
	id: string;
	label: string;
	category: Category;
	description: string;
	tags: string[];
	hasEstim: boolean;
	estimRisePctS: number;
	loopS: number | null;
	generator: GeneratorName | null;
	schema: Param[];
	thumb?: { vib: number[]; estim: number[]; seconds: number };
}

export function catalogue(thumbs = true): CatalogueItem[] {
	return PRESETS.map((d) => {
		const item: CatalogueItem = {
			id: d.id,
			label: d.label,
			category: d.category,
			description: d.description,
			tags: [...d.tags],
			hasEstim: d.hasEstim,
			estimRisePctS: d.estimRisePctS,
			loopS: d.loopS,
			generator: d.generator,
			schema: [...d.schema]
		};
		if (thumbs) {
			const pv = preview(d.id, 60, 1, null, 120);
			item.thumb = { vib: pv.vib, estim: pv.estim, seconds: pv.seconds };
		}
		return item;
	});
}

// JSON with sorted keys and no spaces (Python: json.dumps(sort_keys=True, separators=(',', ':'))).
function canonical(x: unknown): string {
	if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
	if (x !== null && typeof x === 'object') {
		const o = x as Record<string, unknown>;
		const keys = Object.keys(o).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
	}
	return JSON.stringify(x);
}

/** The catalogue version: sha256 of the canonical JSON of [[id, vib, estim, generator, schema], ...], first 10
 * hex digits. the reference implementation's fixture exporter computes the same over the same presets. */
export const VERSION: string = sha256Hex(
	canonical(PRESETS.map((d) => [d.id, d.vib, d.estim, d.generator, d.schema]))
).slice(0, 10);
