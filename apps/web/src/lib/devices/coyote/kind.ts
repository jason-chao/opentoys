// The DG-LAB Coyote 3.0 as a kind of device: its id and names, its settings block, its patterns, the texts the
// shared parts of the app need about it, and its session. Its screens are in lib/devices/screens.ts.
import { m } from '$lib/paraglide/messages';
import { errorText, stopReason } from '$lib/app/text';
import type { DeviceKind, DeviceSession } from '$lib/app/devices/types';
import { patternById, patternName } from './catalogue.ts';
import { CoyoteDeviceSession } from './session.svelte.ts';
import {
	CHANNELS,
	COYOTE_ID,
	coyoteNotAbove,
	lockedCoyote,
	sanitizeCoyote,
	type Channel,
	type CoyoteSettings
} from './settings.ts';

const coyote = (session: DeviceSession) => session as CoyoteDeviceSession;

export const channelName = (channel: Channel): string =>
	channel === 'a' ? m.coyote_channel_a() : m.coyote_channel_b();

/** What a history entry played: the names of its patterns. */
export function whatText(what: string): string {
	return what.split(',').filter(Boolean).map(patternName).join(m.list_separator());
}

/** The Coyote's own wording where the shared one names the ring. */
const STOP: Record<string, () => string> = {
	connected: m.coyote_stop_connected,
	disconnect: m.coyote_stop_disconnect,
	link_lost: m.coyote_stop_link_lost,
	device_not_answering: m.coyote_stop_not_answering,
	write_failed: m.coyote_stop_write_failed,
	page_hidden: m.coyote_stop_page_hidden
};
const ERROR: Record<string, () => string> = {
	'connect-failed': m.coyote_error_connect_failed,
	'not-identified': m.coyote_error_not_supported,
	'missing-characteristic': m.coyote_error_not_supported,
	'recovery-mode': m.coyote_error_recovery
};

export const COYOTE: DeviceKind = {
	id: COYOTE_ID,
	name: () => m.coyote_name(),
	settings: {
		key: 'coyote',
		sanitize: (stored) => sanitizeCoyote(stored),
		locked: (block) => lockedCoyote(block as CoyoteSettings),
		notAbove: (block, current) => coyoteNotAbove(block as CoyoteSettings, current as CoyoteSettings)
	},
	hasPattern: (id) => patternById(id) !== undefined,
	describe: (what) => whatText(what),
	connectHints: () => [m.coyote_supported(), m.coyote_connect_hint()],
	// It stops by itself when the connection is lost: say so, so nobody wonders.
	lostAdvice: () => m.coyote_lost_advice(),
	stopText: (code) => (STOP[code] ?? (() => stopReason(code)))(),
	errorText: (code) => (ERROR[code] ?? (() => errorText(code)))(),
	unsupportedTitle: () => m.unsupported_title_device(),
	connectedDetail: (session) => {
		const fw = coyote(session).firmware;
		return fw === null ? null : m.coyote_firmware({ version: fw });
	},
	about: () => m.coyote_about(),
	nowPlaying: (session) => {
		const s = coyote(session);
		const on = CHANNELS.filter((ch) => s[ch].pattern !== null);
		const names = [...new Set(on.map((ch) => patternName(s[ch].pattern!)))];
		return {
			name: names.join(m.list_separator()),
			readout: m.coyote_readout_short({ a: s.a.intensity, b: s.b.intensity })
		};
	},
	// The set-up has its own Stop, right where the intensity is stepped up.
	showsOwnStop: (session) => coyote(session).setup !== null,
	// Nothing can be started until it is set up: the set-up opens whenever it connects without one.
	setupOnConnect: (session) => !coyote(session).usable,
	summary: (session) => {
		const s = coyote(session).coyote;
		if (!s.agreed || !s.enabled) return m.setup_needed();
		const max = (v: number) => (v > 0 ? String(v) : m.coyote_not_used());
		return m.coyote_summary({ a: max(s.maxA), b: max(s.maxB) });
	},
	createSession: (host) => new CoyoteDeviceSession(COYOTE, host)
};
