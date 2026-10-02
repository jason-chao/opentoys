// Time and timers, injectable so tests (and the demo) can drive them. Times are milliseconds on a monotonic
// clock (performance.now in the browser); only differences are meaningful.

export type TimerHandle = unknown;

export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): TimerHandle;
	clearTimeout(handle: TimerHandle): void;
}

/** Runs a callback every `ms` (setInterval in the browser); returns a function that cancels it. */
export interface Scheduler {
	every(ms: number, fn: () => void): () => void;
}

// Looked up on each call, so fake timers installed after import still apply.
export const systemClock: Clock = {
	now: () => globalThis.performance.now(),
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export const intervalScheduler: Scheduler = {
	every(ms, fn) {
		const h = globalThis.setInterval(fn, ms);
		return () => globalThis.clearInterval(h);
	}
};

export function sleep(clock: Clock, ms: number): Promise<void> {
	return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

/** Resolves with the promise's value, or rejects with `onTimeout()` after `ms`. */
export function withTimeout<T>(clock: Clock, p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const h = clock.setTimeout(() => reject(onTimeout()), ms);
		p.then(
			(v) => {
				clock.clearTimeout(h);
				resolve(v);
			},
			(e: unknown) => {
				clock.clearTimeout(h);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		);
	});
}
