// What the orb is fed with: every session's live output, in the shape lib/orb/levels.ts maps (kept apart from
// that mapping, which knows nothing about sessions).
import type { DeviceSession } from '$lib/app/devices/types';
import type { ChannelInput, OrbInput } from '$lib/orb/levels';
import type { CoyoteDeviceSession } from './coyote/session.svelte';
import { COYOTE_ID } from './coyote/settings';
import type { RingSession } from './ring/session.svelte';
import { RING_ID } from './ring/settings';

export function orbInput(sessions: readonly DeviceSession[], t: number, breath = 0): OrbInput {
	const ring = sessions.find((s) => s.kind.id === RING_ID) as RingSession | undefined;
	const coyote = sessions.find((s) => s.kind.id === COYOTE_ID) as CoyoteDeviceSession | undefined;
	const channel = (c: CoyoteDeviceSession, ch: 'a' | 'b'): ChannelInput => ({
		strength: c[ch].strength,
		intensity: c[ch].intensity,
		max: c.maxima[ch],
		rate: c[ch].rate
	});
	return {
		t,
		ring: ring ? { vibration: ring.output.vibration, estim: ring.output.estim } : null,
		coyote: coyote ? { a: channel(coyote, 'a'), b: channel(coyote, 'b') } : null,
		breath
	};
}
