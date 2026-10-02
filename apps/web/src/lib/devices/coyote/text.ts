// Small texts about the Coyote's patterns that several of its screens use.
import { m } from '$lib/paraglide/messages';
import { duration } from '$lib/app/format';
import { cycleS, lanesOf } from './catalogue.ts';

/** "Repeats every 2.4 sec", or "Constant strength" for a pattern that never changes. */
export function lengthText(id: string): string {
	const lanes = lanesOf(id);
	const constant = !!lanes && new Set(lanes.strength).size === 1 && lanes.rateRange[0] === lanes.rateRange[1];
	return constant ? m.coyote_length_constant() : m.length_repeats({ time: duration(cycleS(id)) });
}
