// Engine (sources, limits, calibrated mapping, warm-up, e-stim rise limit, session max), presets (envelope
// renderer, library, generators), the portable seeded RNG and the ring-link-mode/1 format.
// Ported from the reference implementation; kept identical to it through the conformance fixtures (test/fixtures).
// The DG-LAB Coyote 3.0 engine and waveforms live in ./coyote (the `coyote` namespace), ported from the reference implementation.

export { level } from './level.ts';
export { Rng, randomSeed } from './rng.ts';
export {
	DEFAULT_CAPS,
	HardCaps,
	Limits,
	MAX_CAPS,
	REFERENCE_CAPS,
	clamp01,
	type LimitValues
} from './engine/limits.ts';
export { MAX_S, MIN_S, PERIOD_MS, Recorder, type Recording } from './engine/recorder.ts';
export {
	DEFAULT_INTENSITY,
	MAX_SAMPLES,
	Manual,
	ORDERS,
	Pattern,
	PatternItem,
	Preset,
	type Order,
	type PatternItemInput,
	type PresetOptions,
	type Source
} from './engine/sources.ts';
export {
	CREEP_FULL_MS,
	CREEP_MAX,
	CREEP_RESET_MS,
	ESTIM_FADE_PER_S,
	Session,
	TICK_MS,
	type Out
} from './engine/session.ts';
export * as presets from './presets/index.ts';
export {
	BY_ID,
	CATEGORIES,
	IDS,
	PRESETS,
	VERSION,
	catalogue,
	makeProgram,
	preview,
	type CatalogueItem,
	type Category,
	type Param,
	type Params,
	type PresetDef,
	type Preview
} from './presets/index.ts';
export {
	EXPORT_FORMAT,
	FORMAT,
	ModeError,
	NAME_MAX,
	exportModes,
	fromVendor,
	importAny,
	normalize,
	type ExportJson,
	type Mode,
	type ModeJson
} from './modes.ts';
export * as coyote from './coyote/index.ts';
export type {
	BuiltinWaveform,
	ChannelName as CoyoteChannelName,
	CoyoteChannelOut,
	CoyoteEngine,
	CoyoteLimitValues,
	CoyoteOut,
	PlayMode as CoyotePlayMode,
	Waveform as CoyoteWaveform,
	WaveformPreview as CoyoteWaveformPreview,
	WaveformSection as CoyoteWaveformSection
} from './coyote/index.ts';
export { CoyoteChannel, CoyoteLimits, CoyoteSession } from './coyote/index.ts';
