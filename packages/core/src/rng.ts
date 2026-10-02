// The portable seeded RNG shared with the reference implementation (rng.py), so a seed means the same session in both apps.
// Defined exactly, method by method:
//
// * state: a uint32, set to seed mod 2^32 (any integer seed).
// * nextU32(): mulberry32 (Tommy Ettinger), all arithmetic mod 2^32:
//       state = state + 0x6D2B79F5
//       t = (state ^ (state >>> 15)) * (state | 1)
//       t = t ^ (t + (t ^ (t >>> 7)) * (t | 61))
//       return t ^ (t >>> 14)
// * random(): nextU32() / 2^32, in [0, 1).
// * uniform(a, b): a + (b - a) * random().
// * gauss(mu, sigma): Box–Muller from two fresh draws per call (the second value is never cached):
//   u1 = 1 - random() (in (0, 1], so log(u1) is finite), u2 = random(),
//   mu + sigma * (sqrt(-2 * log(u1)) * cos(2 * pi * u2)), evaluated in that order.
// * choice(seq): seq[floor(random() * seq.length)]; an empty sequence is an error.
// * randint(lo, hi): lo + floor(random() * (hi - lo + 1)), an integer in lo..hi (both included); used by the
//   Coyote engine, whose fixtures from the reference implementation define it the same way.
//
// New seeds come from crypto.getRandomValues (1..999999); this generator is for reproducible output only, never
// for anything secret. log and cos come from the JS engine's libm, Python's from the C library: they agree to the
// last ulp at worst, which the 1 % quantisation of generator output absorbs.

export class Rng {
	state: number;

	constructor(seed: number) {
		if (!Number.isInteger(seed)) throw new RangeError('the seed must be an integer');
		this.state = Number(BigInt.asUintN(32, BigInt(seed)));
	}

	nextU32(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
		return (t ^ (t >>> 14)) >>> 0;
	}

	random(): number {
		return this.nextU32() / 4294967296;
	}

	uniform(a: number, b: number): number {
		return a + (b - a) * this.random();
	}

	gauss(mu = 0, sigma = 1): number {
		const u1 = 1 - this.random();
		const u2 = this.random();
		return mu + sigma * (Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
	}

	randint(lo: number, hi: number): number {
		return lo + Math.floor(this.random() * (hi - lo + 1));
	}

	choice<T>(seq: readonly T[]): T {
		if (seq.length === 0) throw new RangeError('cannot choose from an empty sequence');
		return seq[Math.floor(this.random() * seq.length)] as T;
	}
}

/** A fresh seed, 1..999999, from the platform's CSPRNG (the reference implementation uses random.SystemRandom). */
export function randomSeed(): number {
	const buf = new Uint32Array(1);
	const limit = 4294967296 - (4294967296 % 999999); // rejection keeps it uniform
	for (;;) {
		crypto.getRandomValues(buf);
		const x = buf[0] as number;
		if (x < limit) return 1 + (x % 999999);
	}
}
