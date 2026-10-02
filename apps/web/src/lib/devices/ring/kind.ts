// The Bananasome Dragon S1 as a kind of device: its id and names, its settings block, its patterns, the texts
// the shared parts of the app need about it, and its session. Its screens are in lib/devices/screens.ts (kept
// apart, so that logic and tests don't load components).
import { BY_ID } from '@opentoys/core';
import { m } from '$lib/paraglide/messages';
import { presetName } from '$lib/app/catalogue';
import { pct } from '$lib/app/format';
import { errorText, stopReason } from '$lib/app/text';
import type { DeviceKind, DeviceSession } from '$lib/app/devices/types';
import { RingSession, type Playing } from './session.svelte.ts';
import { lockedRing, RING_ID, ringNotAbove, sanitizeRing, type RingSettings } from './settings.ts';

/** What a history entry played: a pattern name, manual control, or a saved pattern. */
export function whatText(what: string, savedName: (id: number) => string | undefined): string {
	if (what === 'manual') return m.what_manual();
	if (what.startsWith('mode:')) return savedName(Number(what.slice(5))) ?? m.what_saved_deleted();
	return presetName(what);
}

/** The name of what is playing (or was started last). */
export function playingName(current: Playing | { kind: 'preset'; id: string } | null): string {
	if (!current) return '';
	if (current.kind === 'preset') return presetName(current.id);
	if (current.kind === 'manual') return m.what_manual();
	return current.name;
}

const ring = (session: DeviceSession) => session as RingSession;

export const RING: DeviceKind = {
	id: RING_ID,
	name: () => m.device_name(),
	settings: {
		key: 'ring',
		sanitize: sanitizeRing,
		locked: (block) => lockedRing(block as RingSettings),
		notAbove: (block, current) => ringNotAbove(block as RingSettings, current as RingSettings)
	},
	hasPattern: (id) => BY_ID.has(id),
	describe: whatText,
	connectHints: () => [m.device_supported(), m.connect_buzz_hint()],
	lostAdvice: (session) => (session.mayBeRunning ? m.lost_running() : null),
	stopText: stopReason,
	errorText,
	unsupportedTitle: () => m.unsupported_title(),
	about: () => m.device_about(),
	nowPlaying: (session) => {
		const s = ring(session);
		return {
			name: playingName(s.current),
			readout: m.readout_short({
				vib: pct(s.output.vibration),
				estim: s.estimInUse ? pct(s.output.estim) : m.readout_off()
			})
		};
	},
	// The set-up has its own Stop, right where the levels are found.
	showsOwnStop: (session) => !!ring(session).calibrating,
	// The safety notes must be agreed to. The vibration levels are offered once, and can be skipped.
	setupOnConnect: (session) => {
		const s = ring(session).ring;
		return !s.agreed || !s.setupOffered;
	},
	summary: (session) => {
		const s = ring(session).ring;
		if (!s.agreed) return m.setup_needed();
		return s.estimUnlocked ? m.ring_summary_estim_on() : m.ring_summary_estim_off();
	},
	createSession: (host) => new RingSession(RING, host)
};
