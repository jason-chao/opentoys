// Translated text for codes the runtime reports (stop reasons, connection errors), and the Patterns labels.
import { m } from '$lib/paraglide/messages';
import type { Kind, Section } from './catalogue.ts';

const STOP: Record<string, () => string> = {
	user: m.stop_user,
	connected: m.stop_connected,
	disconnect: m.stop_disconnect,
	page_hidden: m.stop_page_hidden,
	page_closed: m.stop_page_closed,
	link_lost: m.stop_link_lost,
	ring_not_answering: m.stop_not_answering,
	device_not_answering: m.stop_not_answering,
	write_failed: m.stop_write_failed,
	session_max: m.stop_session_max,
	finished: m.stop_finished
};
/** Why playback ended, as a whole sentence ("Playback stopped because the connection was lost."). */
export const stopReason = (code: string): string => (STOP[code] ?? m.stop_other)();

const ERROR: Record<string, () => string> = {
	unsupported: m.error_unsupported,
	blocked: m.error_blocked,
	'request-failed': m.error_request_failed,
	'connect-failed': m.error_connect_failed,
	'not-identified': m.error_not_identified,
	'legacy-firmware': m.error_legacy_firmware,
	'missing-characteristic': m.error_missing_characteristic
};
export const errorText = (code: string): string => (ERROR[code] ?? m.error_unknown)();

export const KIND_LABEL: Record<Kind, () => string> = {
	steady: m.kind_steady,
	pulses: m.kind_pulses,
	waves: m.kind_waves,
	rhythms: m.kind_rhythms,
	buildups: m.kind_buildups
};

export const SECTION_TEXT: Record<Section, { title: () => string; line: () => string }> = {
	vibration: { title: m.section_vibration, line: m.section_vibration_line },
	combined: { title: m.section_combined, line: m.section_combined_line },
	generated: { title: m.section_generated, line: m.section_generated_line }
};
