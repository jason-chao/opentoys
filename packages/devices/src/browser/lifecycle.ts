// Page lifecycle → the controllers' safety chain, with document/window/navigator injected (testable in Node).
// One set of handlers serves every controller (ring and Coyote together), each applying its own rule.
//
// * visibilitychange → hidden: each device's background policy (Dragon S1: e-stim 0 at once, vibration keeps
//   running; Coyote: a full stop), or a full stop for all when the user set "stop everything when I leave the
//   page". Chrome throttles timers on hidden pages; the ring holds its last level, so a changing pattern may
//   slow down or freeze.
// * pagehide: the same; then the browser drops the GATT connections and the devices stop by themselves.
// * One Screen Wake Lock while any controller is active; re-acquired when the page is visible again, released
//   when the last one stops.
import type { BackgroundOutcome, LeaveTrigger } from '../controller/controller.ts';
import { type WakeLockLike, WakeLockKeeper } from './wake-lock.ts';

type Handler = (e: Event) => void;

interface EventSource {
	addEventListener(type: string, listener: Handler): void;
	removeEventListener(type: string, listener: Handler): void;
}

export interface LifecycleDocument extends EventSource {
	readonly visibilityState: string;
}

/** The parts of a controller the glue uses (Controller and CoyoteController both fit). */
export interface LifecycleController {
	readonly active: boolean;
	leavePage(trigger: LeaveTrigger, opts?: { stopEverything?: boolean }): BackgroundOutcome;
	on(type: 'active', fn: (payload: { active: boolean }) => void): () => void;
}

export interface LifecycleOptions {
	/** A single controller (the original form). */
	controller?: LifecycleController;
	/** Several controllers under one set of handlers and one wake lock. */
	controllers?: readonly LifecycleController[];
	document: LifecycleDocument;
	/** Where pagehide fires (window). */
	window: EventSource;
	navigator?: { wakeLock?: WakeLockLike };
	/** The user setting "stop everything when I leave the page" (read at the moment of leaving). */
	stopEverythingOnLeave?: () => boolean;
	onWakeLockError?: (e: unknown) => void;
}

export interface Lifecycle {
	readonly wakeLock: WakeLockKeeper;
	/** Put another controller under the same handlers and wake lock; returns the function that removes it. */
	add(controller: LifecycleController): () => void;
	detach(): void;
}

export function attachLifecycle(opts: LifecycleOptions): Lifecycle {
	const { document: doc, window: win } = opts;
	const stopEverything = opts.stopEverythingOnLeave ?? (() => false);
	const wakeLock = new WakeLockKeeper(
		opts.navigator?.wakeLock,
		() => doc.visibilityState === 'visible',
		opts.onWakeLockError
	);
	const controllers = new Map<LifecycleController, () => void>();

	const syncWakeLock = (): void => {
		void wakeLock.set([...controllers.keys()].some((c) => c.active));
	};
	const add = (controller: LifecycleController): (() => void) => {
		if (!controllers.has(controller)) controllers.set(controller, controller.on('active', syncWakeLock));
		syncWakeLock();
		return () => {
			controllers.get(controller)?.();
			controllers.delete(controller);
			syncWakeLock();
		};
	};
	const leave = (trigger: LeaveTrigger): void => {
		const all = stopEverything();
		for (const c of [...controllers.keys()]) {
			try {
				c.leavePage(trigger, { stopEverything: all });
			} catch (e) {
				console.error('leavePage failed', e); // the other devices must still get theirs
			}
		}
	};
	const onVisibility: Handler = () => {
		if (doc.visibilityState === 'hidden') leave('hidden');
		else if (doc.visibilityState === 'visible') void wakeLock.visible();
	};
	const onPageHide: Handler = () => leave('pagehide');

	doc.addEventListener('visibilitychange', onVisibility);
	win.addEventListener('pagehide', onPageHide);
	if (opts.controller) add(opts.controller);
	for (const c of opts.controllers ?? []) add(c);
	syncWakeLock();

	return {
		wakeLock,
		add,
		detach() {
			doc.removeEventListener('visibilitychange', onVisibility);
			win.removeEventListener('pagehide', onPageHide);
			for (const off of controllers.values()) off();
			controllers.clear();
			void wakeLock.set(false);
		}
	};
}
