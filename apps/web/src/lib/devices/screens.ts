// Each kind of device's screens: what it puts on Patterns, the pattern page, Control, Saved, its Settings page,
// and its set-up. The pages under routes/ are hosts: they pick the device(s) from My devices and render that
// kind's screen. Kept apart from the registry (lib/app/devices/registry.ts) so logic and tests don't load
// components. Adding a device: its kind in the registry, its entry here.
import type { Component } from 'svelte';
import type { DeviceSession } from '$lib/app/devices/types';
import { COYOTE_ID } from './coyote/settings';
import CoyotePatterns from './coyote/Patterns.svelte';
import CoyotePattern from './coyote/Pattern.svelte';
import CoyoteCard from './coyote/Card.svelte';
import CoyoteSaved from './coyote/Saved.svelte';
import CoyoteSettings from './coyote/Settings.svelte';
import CoyoteSetup from './coyote/Setup.svelte';
import CoyoteSafetyNotes from './coyote/SafetyNotes.svelte';
import { RING_ID } from './ring/settings';
import RingPatterns from './ring/Patterns.svelte';
import RingPattern from './ring/Pattern.svelte';
import RingCard from './ring/Card.svelte';
import RingSaved from './ring/Saved.svelte';
import RingSettings from './ring/Settings.svelte';
import RingSetup from './ring/Setup.svelte';
import RingSafetyNotes from './ring/SafetyNotes.svelte';

type Screen<Extra = object> = Component<{ session: DeviceSession } & Extra>;

export interface DeviceScreens {
	/** The device's patterns (the whole Patterns page for this device). */
	Patterns: Screen;
	/** One pattern (?id=…): what it does, its settings, Start. */
	Pattern: Screen;
	/** Its card on Control: one row per output (the shared OutputRow), and what "More" opens for each. */
	Card: Screen;
	/** What is saved for it on Saved (the ring: recorded and imported patterns; the Coyote: its favourites). */
	Saved?: Screen;
	/** Its page in Settings: connection, set-up, limits, leaving the page. */
	Settings: Screen;
	/**
	 * Its set-up, one flow: safety notes and agreement, levels, summary. Opened over the current screen
	 * (components/Overlays.svelte). `part` begins somewhere in it, in the device's own terms.
	 */
	Setup: Screen<{ part?: string; ondone: () => void }>;
	/** Its safety notes: the complete list (its set-up), or with `own` only what is not shared (About). */
	SafetyNotes: Component<{ own?: boolean }>;
}

export const SCREENS: Readonly<Record<string, DeviceScreens>> = {
	[COYOTE_ID]: {
		Patterns: CoyotePatterns,
		Pattern: CoyotePattern,
		Card: CoyoteCard,
		Saved: CoyoteSaved,
		Settings: CoyoteSettings,
		Setup: CoyoteSetup,
		SafetyNotes: CoyoteSafetyNotes
	},
	[RING_ID]: {
		Patterns: RingPatterns,
		Pattern: RingPattern,
		Card: RingCard,
		Saved: RingSaved,
		Settings: RingSettings,
		Setup: RingSetup,
		SafetyNotes: RingSafetyNotes
	}
};

export const screensOf = (session: DeviceSession): DeviceScreens => SCREENS[session.kind.id];
