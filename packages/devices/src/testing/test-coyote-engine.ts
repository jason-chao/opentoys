// A stand-in for core's CoyoteSession in the device-layer tests: per channel a base intensity, a cap and an
// optional payload that plays until stopped. Not a safety pipeline: the app uses packages/core.
import type { CoyoteChannelOut, CoyoteEngine, CoyoteOut } from '../controller/coyote-controller.ts';
import type { CoyoteChannel } from '../coyote/model.ts';

/** Frequency 30, strength 100 in every slot. */
export const TEST_PAYLOAD: Uint8Array = Uint8Array.of(30, 30, 30, 30, 100, 100, 100, 100);

class Channel {
	base = 0;
	payload: Uint8Array | null = null;
	private lastIntensity = 0;
	cap: number;

	constructor(cap: number) {
		this.cap = cap;
	}

	tick(): CoyoteChannelOut {
		const intensity = Math.min(this.base, this.cap);
		const changed = intensity !== this.lastIntensity;
		this.lastIntensity = intensity;
		const payload = this.payload;
		const silent = payload === null || payload.subarray(4).every((s) => s === 0);
		return { intensity, changed, payload, silent, scale: 1, cap: this.cap };
	}
}

export class TestCoyoteEngine implements CoyoteEngine {
	readonly a: Channel;
	readonly b: Channel;
	stopped: string | null = null;
	outputMs = 0;
	sessionMaxMs: number;
	readonly dts: number[] = [];

	constructor(opts: { cap?: number; sessionMaxMs?: number } = {}) {
		this.a = new Channel(opts.cap ?? 200);
		this.b = new Channel(opts.cap ?? 200);
		this.sessionMaxMs = opts.sessionMaxMs ?? Infinity;
	}

	channel(ch: CoyoteChannel): Channel {
		return ch === 'a' ? this.a : this.b;
	}

	/** The user's intent: it clears an earlier stop, as core's session does. */
	setIntensity(ch: CoyoteChannel, value: number): void {
		this.resume();
		this.channel(ch).base = value;
	}

	play(ch: CoyoteChannel, payload: Uint8Array = TEST_PAYLOAD): void {
		this.resume();
		this.channel(ch).payload = payload;
	}

	get busy(): boolean {
		return [this.a, this.b].some((c) => c.payload !== null || c.base > 0);
	}

	stop(reason: string): void {
		for (const c of [this.a, this.b]) {
			c.base = 0;
			c.payload = null;
		}
		this.stopped = reason;
	}

	resume(): void {
		if (this.stopped === null) return;
		this.stopped = null;
		this.outputMs = 0;
	}

	adoptDevice(channel: CoyoteChannel, value: number): number {
		const c = this.channel(channel);
		c.base = Math.min(Math.max(value, 0), c.cap);
		return c.base;
	}

	tick(dtMs: number): CoyoteOut {
		this.dts.push(dtMs);
		let a = this.a.tick();
		let b = this.b.tick();
		if (!(a.silent && b.silent)) {
			this.outputMs += dtMs;
			if (this.outputMs >= this.sessionMaxMs && this.stopped === null) {
				this.stop('session_max');
				a = this.a.tick();
				b = this.b.tick();
			}
		}
		return { a, b, stopped: this.stopped, anyOutput: !(a.silent && b.silent) };
	}
}
