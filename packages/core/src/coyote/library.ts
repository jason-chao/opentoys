// The built-in Coyote waveforms: the reference implementation's twelve own designs, converted once to opentoys' format (real
// frequencies and durations). Names are English ids for the catalogue; the app shows its own translated names.

import raw from './library/waveforms.json';
import { parseWaveform, type Waveform } from './waveform.ts';

export interface BuiltinWaveform {
	readonly id: string;
	readonly name: string;
	readonly tags: readonly string[];
	readonly waveform: Waveform;
}

function load(): BuiltinWaveform[] {
	const list = (raw as { id: string; name: string; tags?: string[]; waveform: unknown }[]).map((w) => ({
		id: w.id,
		name: w.name,
		tags: [...(w.tags ?? [])],
		waveform: parseWaveform(w.waveform)
	}));
	if (new Set(list.map((w) => w.id)).size !== list.length) throw new Error('duplicate waveform id');
	return list;
}

export const WAVEFORMS: readonly BuiltinWaveform[] = load();
export const WAVEFORM_IDS: readonly string[] = WAVEFORMS.map((w) => w.id);
const BY_ID: ReadonlyMap<string, BuiltinWaveform> = new Map(WAVEFORMS.map((w) => [w.id, w]));

/** The built-in waveform with this id, or undefined. */
export function waveformById(id: string): BuiltinWaveform | undefined {
	return BY_ID.get(id);
}
