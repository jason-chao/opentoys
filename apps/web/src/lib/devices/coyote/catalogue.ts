// The Coyote's patterns: the twelve built-in waveforms (packages/core), with their names and descriptions in
// the page's language and what is drawn of them (strength and pulse rate over one pass).
import { coyote } from '@opentoys/core';
import { m } from '$lib/paraglide/messages';

export type Pattern = coyote.BuiltinWaveform;

export const PATTERNS: readonly Pattern[] = coyote.WAVEFORMS;
export const patternById = (id: string): Pattern | undefined => coyote.waveformById(id);

const TEXT: Record<string, [name: () => string, desc: () => string]> = {
	steady: [m.cw_steady_name, m.cw_steady_desc],
	'slow-breath': [m.cw_slow_breath_name, m.cw_slow_breath_desc],
	knock: [m.cw_knock_name, m.cw_knock_desc],
	'double-tap': [m.cw_double_tap_name, m.cw_double_tap_desc],
	'rising-tone': [m.cw_rising_tone_name, m.cw_rising_tone_desc],
	'falling-tone': [m.cw_falling_tone_name, m.cw_falling_tone_desc],
	tremble: [m.cw_tremble_name, m.cw_tremble_desc],
	'step-in': [m.cw_step_in_name, m.cw_step_in_desc],
	staircase: [m.cw_staircase_name, m.cw_staircase_desc],
	surge: [m.cw_surge_name, m.cw_surge_desc],
	flutter: [m.cw_flutter_name, m.cw_flutter_desc],
	tide: [m.cw_tide_name, m.cw_tide_desc]
};

/** Every built-in pattern has its texts (checked in the tests). */
export const hasText = (id: string): boolean => id in TEXT;
export const patternName = (id: string): string => TEXT[id]?.[0]() ?? patternById(id)?.name ?? id;
export const patternDescription = (id: string): string => TEXT[id]?.[1]() ?? '';

export interface Lanes {
	/** Strength 0..1 per 25 ms, over one pass. */
	strength: number[];
	/** The pulse rate per 25 ms, placed on 0..1 (a log scale: 1, 10 and 100 pulses a second are evenly
	 * spaced). */
	rate: number[];
	/** The slowest and fastest pulse rate in the pattern, in pulses per second (where it has any strength). */
	rateRange: [number, number];
	seconds: number;
}

/**
 * The protocol's "frequency" value (10..1000) is the time between pulses in milliseconds: 10 is a pulse every
 * 10 ms, which is 100 pulses a second, and 1000 is one a second. A bigger value means slower pulses. The app
 * shows the pulse rate, never the raw value.
 */
export const pulsesPerSecond = (value: number): number => 1000 / Math.min(1000, Math.max(10, value));

/** The lowest and highest pulse rate there is (the ends of the lane). */
export const RATE_MIN = 1;
export const RATE_MAX = 100;
const ratePos = (perSecond: number): number => Math.log10(perSecond) / 2;

/** The pulse rate of every 25 ms slot that has any strength, in order (a silent slot has no pulses). */
export function ratesOf(id: string): number[] {
	const p = patternById(id);
	if (!p) return [];
	const pv = coyote.previewWaveform(p.waveform);
	const audible = pv.freq.filter((_, i) => pv.strength[i]! > 0);
	return (audible.length ? audible : pv.freq).map(pulsesPerSecond);
}

/** What a pattern's text may claim about its pulse rate over one pass. */
export type RateDirection = 'slows' | 'speeds';

/**
 * The patterns whose name or description says that the pulses slow down or speed up. The tests work the
 * direction out from the waveform itself and fail if it disagrees, or if a pattern that does change one way
 * is missing here.
 */
export const RATE_DIRECTION: Readonly<Record<string, RateDirection>> = {
	'rising-tone': 'slows', // the value rises 10 → 100: from 100 pulses a second down to 10
	'falling-tone': 'speeds', // the value falls 100 → 10: from 10 pulses a second up to 100
	'step-in': 'slows' // the value steps 10 → 50: from 100 pulses a second down to 20
};

const LANES = new Map<string, Lanes>();

/** What one pass of a pattern looks like (cached: the patterns never change). */
export function lanesOf(id: string): Lanes | undefined {
	const hit = LANES.get(id);
	if (hit) return hit;
	const p = patternById(id);
	if (!p) return undefined;
	const pv = coyote.previewWaveform(p.waveform);
	// A pass shorter than half a second is drawn a few times over, so its rhythm shows.
	const repeat = pv.durationS < 0.5 ? Math.ceil(0.8 / pv.durationS) : 1;
	const times = <T>(xs: T[]): T[] => Array.from({ length: repeat }, () => xs).flat();
	const heard = ratesOf(id);
	const lanes: Lanes = {
		strength: times(pv.strength.map((s) => s / 100)),
		rate: times(pv.freq.map((f) => ratePos(pulsesPerSecond(f)))),
		rateRange: [Math.min(...heard), Math.max(...heard)],
		seconds: pv.durationS * repeat
	};
	LANES.set(id, lanes);
	return lanes;
}

/** How long one pass lasts, in seconds (a constant pattern has no cycle to speak of). */
export const cycleS = (id: string): number => {
	const p = patternById(id);
	return p ? coyote.playDurationS(p.waveform) : 0;
};
