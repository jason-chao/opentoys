// The last few seconds of what was actually sent, for the rolling graphs on Control.

export interface Sample {
	/** When it was sent (ms, any monotonic clock). */
	t: number;
	vib: number;
	estim: number;
}

export class Trace {
	private samples: Sample[] = [];

	constructor(
		/** How far back the graph looks. */
		readonly windowMs = 10_000,
		/** Samples closer together than this replace each other (keeps the buffer small on fast ticks). */
		readonly minGapMs = 20
	) {}

	get length(): number {
		return this.samples.length;
	}

	push(t: number, vib: number, estim: number): void {
		const s = this.samples;
		const last = s[s.length - 1];
		if (last && t < last.t) return; // a clock that went backwards: ignore
		if (last && t - last.t < this.minGapMs) s[s.length - 1] = { t: last.t, vib, estim };
		else s.push({ t, vib, estim });
		this.trim(t);
	}

	/** Drop what is older than the window, keeping one sample before it so the left edge stays drawn. */
	private trim(now: number): void {
		const s = this.samples;
		const from = now - this.windowMs;
		let drop = 0;
		while (drop + 1 < s.length && s[drop + 1].t <= from) drop++;
		if (drop) s.splice(0, drop);
	}

	/**
	 * The samples to draw for the window ending at `now`, oldest first: the last one before the window (so the
	 * line starts at the left edge), everything inside it, and the current level held up to `now` (the ring
	 * holds its level between writes).
	 */
	window(now: number): Sample[] {
		this.trim(now);
		const s = this.samples;
		if (!s.length) return [];
		const from = now - this.windowMs;
		const out = s.filter((x) => x.t <= now).map((x) => (x.t < from ? { ...x, t: from } : x));
		const last = out[out.length - 1];
		if (last && last.t < now) out.push({ ...last, t: now });
		return out;
	}

	clear(): void {
		this.samples = [];
	}
}
