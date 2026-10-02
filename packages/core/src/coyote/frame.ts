// One 100 ms unit of Coyote output, and the frequency conversion of the protocol DG-LAB publishes.
// Ported from the reference implementation (waveform/frame.py, encode_freq / decode_freq).

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

function int(v: number): number {
	if (!Number.isFinite(v)) throw new RangeError('a frame value must be a finite number');
	return Math.trunc(v) + 0;
}

/** Frequency parameter 10..1000 → wire byte 10..240; anything outside the range gives 10. */
export function encodeFreq(v: number): number {
	if (!Number.isFinite(v)) return 10;
	v = Math.trunc(v);
	if (v >= 10 && v <= 100) return v;
	if (v > 100 && v <= 600) return Math.floor((v - 100) / 5) + 100;
	if (v > 600 && v <= 1000) return Math.floor((v - 600) / 10) + 200;
	return 10;
}

/** Wire byte 10..240 → frequency parameter 10..1000; anything outside the range gives 10. */
export function decodeFreq(b: number): number {
	if (b >= 10 && b <= 100) return b;
	if (b > 100 && b <= 200) return (b - 100) * 5 + 100;
	if (b > 200 && b <= 240) return (b - 200) * 10 + 600;
	return 10;
}

/** Four 25 ms sub-slots, each with an encoded frequency (10..240) and a strength (0..100).
 *
 * `freqs` / `strengths` may hold 1, 2 or 4 values; `bytes(scale)` expands them to the 8-byte wire layout
 * f0 f1 f2 f3 s0 s1 s2 s3. `scale` (0..1) is the warm-up factor: strengths are multiplied and rounded *up*, so
 * any non-zero strength stays audible until the scale is exactly 0. */
export class PulseFrame {
	readonly freqs: readonly number[];
	readonly strengths: readonly number[];

	constructor(freqs: readonly number[] = [10, 10, 10, 10], strengths: readonly number[] = [0, 0, 0, 0]) {
		this.freqs = freqs.map((f) => clamp(int(f), 10, 240));
		this.strengths = strengths.map((s) => clamp(int(s), 0, 100));
		if (this.freqs.length !== this.strengths.length || ![1, 2, 4].includes(this.freqs.length))
			throw new RangeError('a frame holds 1, 2 or 4 sub-slots');
	}

	/** [freqs4, strengths4] after applying `scale` (clamped to 0..1; NaN counts as 0). */
	expanded(scale = 1): [number[], number[]] {
		scale = scale > 1 ? 1 : scale > 0 ? scale : 0;
		const s = this.strengths.map((v) => Math.ceil(v * scale) + 0);
		const f = this.freqs;
		const at = (xs: readonly number[], i: number): number => xs[i] as number;
		if (f.length === 1) return [Array(4).fill(at(f, 0)), Array(4).fill(at(s, 0))];
		if (f.length === 2)
			return [
				[at(f, 0), at(f, 0), at(f, 1), at(f, 1)],
				[at(s, 0), at(s, 0), at(s, 1), at(s, 1)]
			];
		return [[...f], s];
	}

	/** The 8 wire bytes. */
	bytes(scale = 1): Uint8Array {
		const [f, s] = this.expanded(scale);
		return Uint8Array.from([...f, ...s]);
	}

	isSilent(scale = 1): boolean {
		return this.expanded(scale)[1].every((v) => v === 0);
	}

	static silent(): PulseFrame {
		return new PulseFrame([10, 10, 10, 10], [0, 0, 0, 0]);
	}

	static fromBytes(b: ArrayLike<number>): PulseFrame {
		if (b.length !== 8) throw new RangeError('expected 8 bytes');
		const v = Array.from(b);
		return new PulseFrame(v.slice(0, 4), v.slice(4));
	}
}
