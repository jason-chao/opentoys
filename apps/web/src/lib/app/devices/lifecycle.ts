// Page lifecycle (visibilitychange, pagehide, the screen wake lock) for every device at once.
//
// @opentoys/devices' attachLifecycle serves several controllers under one set of handlers and one wake lock.
// Each device session goes in as its own controller: it is "active" by itself, and leaving the page reaches
// it directly, so each applies its own rule (the ring keeps vibrating and drops e-stim, or stops if the user
// chose that; the Coyote always stops) and notes what it did for its screens.
import {
	attachLifecycle,
	type BackgroundOutcome,
	type LeaveTrigger,
	type LifecycleController,
	type WakeLockLike
} from '@opentoys/devices';

/** What the lifecycle needs from a device session. */
export interface LifecycleSession {
	readonly active: boolean;
	leavePage(trigger: LeaveTrigger): BackgroundOutcome;
}

/**
 * `onActive` subscribes to "some session's active changed" (the manager tells): the wake lock is held while
 * any session is active.
 */
export function attachPageLifecycle(
	sessions: readonly LifecycleSession[],
	onActive: (fn: () => void) => () => void
): () => void {
	const controllers = sessions.map((session): LifecycleController => ({
		get active() {
			return session.active;
		},
		// No stopEverything from here: that choice belongs to the device it is about (the ring's settings).
		leavePage: (trigger) => session.leavePage(trigger),
		on: (_type, fn) => onActive(() => fn({ active: session.active }))
	}));
	const lifecycle = attachLifecycle({
		controllers,
		document,
		window,
		navigator: navigator as unknown as { wakeLock?: WakeLockLike }
	});
	return () => lifecycle.detach();
}
