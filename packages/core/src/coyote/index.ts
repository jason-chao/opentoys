// DG-LAB Coyote 3.0: waveform model and renderer, the built-in waveforms, and the two-channel pulse engine with
// its safety stages (warm-up from zero, comfort ceiling, absolute cap, session maximum).
// Ported from the reference implementation; kept identical to it through the conformance fixtures
// (test/fixtures/coyote). Waveforms use opentoys' own format with real values: no vendor table is needed.

export { PulseFrame, decodeFreq, encodeFreq } from './frame.ts';
export {
	DURATION_MAX,
	FREQ_MAX,
	FREQ_MIN,
	REST_TIME_MAX,
	WaveformError,
	frames,
	parseWaveform,
	playDurationS,
	previewWaveform,
	samples,
	validateWaveform,
	type Waveform,
	type WaveformMode,
	type WaveformPreview,
	type WaveformSection,
	type WaveformSpeed
} from './waveform.ts';
export { WAVEFORMS, WAVEFORM_IDS, waveformById, type BuiltinWaveform } from './library.ts';
export { CoyoteLimits, DEVICE_MAX, type CoyoteLimitValues } from './limits.ts';
export { PLAY_MODES, Player, type PlayMode } from './player.ts';
export { Fire } from './fire.ts';
export { Tease } from './tease.ts';
export { AutoIncrease } from './autoincr.ts';
export { ComfortLimit, type ComfortSettings } from './comfort.ts';
export { PROTECTED, Warmup, type WarmupSettings } from './warmup.ts';
export { CoyoteChannel, SILENT_TICKS_FOR_IDLE, type CoyoteChannelOut } from './channel.ts';
export { CoyoteSession, type ChannelName, type CoyoteEngine, type CoyoteOut } from './session.ts';
