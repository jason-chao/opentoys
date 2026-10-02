// What the orb draws, from everything that is playing: one mapping, kept pure so it can be tested. The orb is
// a display only. Its body follows the ring's vibration. Threads of light carry e-stim, in three sets with a
// colour each: the ring's e-stim, Coyote channel A, Coyote channel B. With nothing playing it rests, breathing
// calmly.

/** One Coyote channel as it is being sent. */
export interface ChannelInput {
	/** The pattern's strength right now, 0..1. */
	strength: number;
	/** The intensity being sent, in the device's own number. */
	intensity: number;
	/** The channel's maximum (what the intensity is measured against). */
	max: number;
	/** Pulses per second (0 when nothing is sent). */
	rate: number;
}

export interface OrbInput {
	/** A clock in seconds (any origin): the resting breath follows it. */
	t: number;
	/** The ring's levels as sent, 0..1, or null when there is no ring to show. */
	ring: { vibration: number; estim: number } | null;
	/** The Coyote's channels, or null when there is no Coyote to show. */
	coyote: { a: ChannelInput; b: ChannelInput } | null;
	/** A breath led from outside (the three breaths before a pattern starts), 0..1. */
	breath?: number;
}

/** The three thread sets, in this order everywhere (uniforms, colours, the caption). */
export const THREADS = ['ring', 'a', 'b'] as const;
export type Thread = (typeof THREADS)[number];

export interface OrbLevels {
	/** How far the body swells and ripples, 0..1 (the ring's vibration). */
	body: number;
	/** A slow swell of the whole orb, 0..1: the resting breath, or one led from outside. */
	breath: number;
	/** How bright each thread set is, 0..1. */
	threads: [ring: number, a: number, b: number];
	/** How fast each set shimmers, in cycles per second. */
	flicker: [ring: number, a: number, b: number];
}

/**
 * The shimmer stays slow: at most 3 cycles a second (what is safe to show anyone), however fast the pulses
 * are. 1 pulse a second shimmers slowest, 100 fastest, evenly spaced on a log scale in between.
 */
export const FLICKER_MIN = 0.6;
export const FLICKER_MAX = 3;
/** The ring's e-stim has no pulse rate to show: a steady, unhurried shimmer. */
export const FLICKER_RING = 1.2;
/** One resting breath takes this long, in seconds, and swells this far. */
export const REST_PERIOD_S = 8;
export const REST_DEPTH = 0.35;
/** A thread that carries anything at all is at least this bright, so a low intensity is still seen. */
export const THREAD_FLOOR = 0.18;

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Pulses per second → shimmer speed. */
export function flickerFor(rate: number): number {
	if (!(rate > 0)) return FLICKER_MIN;
	const pos = unit(Math.log10(Math.min(100, Math.max(1, rate))) / 2);
	return FLICKER_MIN + (FLICKER_MAX - FLICKER_MIN) * pos;
}

/** A Coyote channel's brightness: its pattern's strength, scaled by how far up its maximum the intensity is. */
function channelLevel(c: ChannelInput): number {
	if (!(c.max > 0) || !(c.intensity > 0) || !(c.strength > 0)) return 0;
	const x = unit(c.strength) * unit(c.intensity / c.max);
	return x > 0 ? THREAD_FLOOR + (1 - THREAD_FLOOR) * x : 0;
}

export function orbLevels(input: OrbInput): OrbLevels {
	const body = unit(input.ring?.vibration ?? 0);
	const threads: OrbLevels['threads'] = [
		unit(input.ring?.estim ?? 0),
		input.coyote ? channelLevel(input.coyote.a) : 0,
		input.coyote ? channelLevel(input.coyote.b) : 0
	];
	const flicker: OrbLevels['flicker'] = [
		FLICKER_RING,
		flickerFor(input.coyote?.a.rate ?? 0),
		flickerFor(input.coyote?.b.rate ?? 0)
	];
	// A breath led from outside wins. Otherwise the body breathes by itself while it has nothing else to do:
	// with no vibration the threads lead, and with nothing at all it rests.
	const resting = REST_DEPTH * (0.5 - 0.5 * Math.cos((2 * Math.PI * input.t) / REST_PERIOD_S));
	const breath =
		input.breath !== undefined && input.breath > 0 ? unit(input.breath) : body < 0.02 ? resting : 0;
	return { body, breath, threads, flicker };
}

/** What the orb shows with nothing connected (Welcome): at rest. */
export const restingLevels = (t: number): OrbLevels => orbLevels({ t, ring: null, coyote: null });
