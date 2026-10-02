// Python semantics the port depends on, so every value matches the reference implementation bit for bit (or, after transcendental
// functions, to the last ulp). Only what the ported code needs; each helper names the Python it stands for.

export class PyValueError extends Error {
	override name = 'ValueError';
}

// round(x) with no digits: to the nearest integer, exact ties to even (Math.round sends ties up).
function roundInt(x: number): number {
	const r = Math.round(x);
	return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// format(x, f'.{n}f'): correctly rounded from the exact binary value, exact ties to even. toFixed is correctly
// rounded too but sends exact ties away from zero; an exact tie has at most n + 1 decimals (x·2·10^n is then an
// odd integer, so x = j / 2^(n+1)), which toFixed(n + 30) shows exactly.
export function pyFixed(x: number, n: number): string {
	if (!Number.isFinite(x)) return x !== x ? 'nan' : x > 0 ? 'inf' : '-inf';
	const s = x.toFixed(n);
	const long = x.toFixed(Math.min(100, n + 30));
	const cut = long.length - 30;
	if (long[cut] === '5' && /^0*$/.test(long.slice(cut + 1))) {
		let trunc = long.slice(0, cut); // toward zero
		if (trunc.endsWith('.')) trunc = trunc.slice(0, -1);
		const last = Number(trunc[trunc.length - 1]);
		if (last % 2 === 0) return trunc;
	}
	return s;
}

/** round(x, n): Python's correctly rounded, half-even rounding; round(x) for n = 0. */
export function pyRound(x: number, n = 0): number {
	if (!Number.isFinite(x)) return x;
	if (n === 0) return roundInt(x);
	return Number(pyFixed(x, n));
}

/** format(x, 'g'): 6 significant digits, trailing zeros dropped (used in phase labels). */
export function pyFormatG(x: number): string {
	if (!Number.isFinite(x)) return pyFixed(x, 0);
	if (x === 0) return Object.is(x, -0) ? '-0' : '0';
	let e = Math.floor(Math.log10(Math.abs(x)));
	if (10 ** e > Math.abs(x)) e -= 1;
	else if (10 ** (e + 1) <= Math.abs(x)) e += 1;
	let s = pyFixed(x, Math.max(0, 5 - e));
	if (Math.abs(Number(s)) >= 10 ** (e + 1)) {
		e += 1;
		s = pyFixed(x, Math.max(0, 5 - e));
	}
	if (e < -4 || e >= 6) {
		const [m = '', ex = '0'] = x.toExponential(5).split('e');
		const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
		const exn = Number(ex);
		return `${mant}e${exn < 0 ? '-' : '+'}${String(Math.abs(exn)).padStart(2, '0')}`;
	}
	return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** a % b with the sign of b. */
export function pyMod(a: number, b: number): number {
	const m = a % b;
	return m !== 0 && m < 0 !== b < 0 ? m + b : m;
}

/** a // b for floats, as CPython computes it (float_floor_div). */
export function pyFloorDiv(a: number, b: number): number {
	const mod = a % b;
	let div = (a - mod) / b;
	if (mod && b < 0 !== mod < 0) div -= 1;
	if (div) {
		let fl = Math.floor(div);
		if (div - fl > 0.5) fl += 1;
		return fl;
	}
	return 0 * Math.sign(a / b);
}

/** min(a, b, ...) with Python's NaN behaviour (keeps the earlier value unless a later one compares smaller). */
export function pmin(...xs: number[]): number {
	let m = xs[0] as number;
	for (let i = 1; i < xs.length; i++) if ((xs[i] as number) < m) m = xs[i] as number;
	return m;
}

/** max(a, b, ...) with Python's NaN behaviour. */
export function pmax(...xs: number[]): number {
	let m = xs[0] as number;
	for (let i = 1; i < xs.length; i++) if ((xs[i] as number) > m) m = xs[i] as number;
	return m;
}

const FLOAT_RE = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i;

/** float(x): numbers, booleans and numeric strings; anything else throws (TypeError/ValueError in Python). */
export function pyFloat(x: unknown): number {
	if (typeof x === 'number') return x;
	if (typeof x === 'boolean') return x ? 1 : 0;
	if (typeof x === 'string') {
		const s = x.trim();
		if (FLOAT_RE.test(s)) return Number(s.replace(/_/g, ''));
		const m = SPECIAL_RE.exec(s);
		if (m) return m[2]?.toLowerCase() === 'nan' ? NaN : m[1] === '-' ? -Infinity : Infinity;
		throw new PyValueError(`could not convert string to float: '${x}'`);
	}
	throw new PyValueError('float() argument must be a string or a real number');
}

const INT_RE = /^[+-]?\d(?:_?\d)*$/;

/** int(x): truncates numbers, parses integer strings; anything else throws. */
export function pyInt(x: unknown): number {
	if (typeof x === 'number') {
		if (!Number.isFinite(x)) throw new PyValueError('cannot convert float to integer');
		return Math.trunc(x) + 0;
	}
	if (typeof x === 'boolean') return x ? 1 : 0;
	if (typeof x === 'string') {
		const s = x.trim();
		if (INT_RE.test(s)) return Number(s.replace(/_/g, ''));
		throw new PyValueError(`invalid literal for int() with base 10: '${x}'`);
	}
	throw new PyValueError('int() argument must be a string or a real number');
}

/** Python truthiness of a JSON value. */
export function truthy(x: unknown): boolean {
	if (Array.isArray(x)) return x.length > 0;
	if (x !== null && typeof x === 'object') return Object.keys(x).length > 0;
	return Boolean(x);
}

/** str(x) for the JSON values a name may hold. */
export function pyStr(x: unknown): string {
	if (typeof x === 'string') return x;
	if (typeof x === 'boolean') return x ? 'True' : 'False';
	if (x === null || x === undefined) return 'None';
	if (typeof x === 'number') return String(x);
	return JSON.stringify(x);
}

/** repr() of a string. */
export function pyReprStr(s: string): string {
	const q = s.includes("'") && !s.includes('"') ? '"' : "'";
	const body = s.replace(/\\/g, '\\\\').replace(q === "'" ? /'/g : /"/g, `\\${q}`);
	return `${q}${body}${q}`;
}

/** Iterating a JSON value as Python would (list items, string characters, object keys). */
export function pyIter(x: unknown): unknown[] {
	if (Array.isArray(x)) return x;
	if (typeof x === 'string') return Array.from(x);
	if (x !== null && typeof x === 'object') return Object.keys(x);
	throw new PyValueError('object is not iterable');
}

/** (n & -n).bit_length() - 1: the number of trailing zero bits of a positive integer. */
export function trailingZeros(n: number): number {
	let k = 0;
	while (n > 0 && n % 2 === 0) {
		n /= 2;
		k += 1;
	}
	return k;
}

/** dict equality for JSON values (1 == 1.0 holds, as in Python). */
export function pyEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => pyEqual(x, b[i]));
	if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		return (
			ka.length === kb.length &&
			ka.every(
				(k) =>
					Object.hasOwn(b, k) && pyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
			)
		);
	}
	return false;
}
