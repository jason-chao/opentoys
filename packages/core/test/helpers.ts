// Shared by the conformance tests: fixture loading, the reference implementation's snake_case keys → camelCase, and a deep compare.
import { readFileSync } from 'node:fs';

// Fixtures are plain JSON exported by the reference implementation; the tests read them as untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export function fixture(name: string): Json {
	return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

export const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Keys camelCased recursively, except inside `params` / `clean` (generator parameter keys stay snake_case). */
export function camelize(x: Json, keep: ReadonlySet<string> = new Set(['params', 'clean'])): Json {
	if (Array.isArray(x)) return x.map((v) => camelize(v, keep));
	if (x !== null && typeof x === 'object')
		return Object.fromEntries(
			Object.entries(x).map(([k, v]) => [camel(k), keep.has(k) ? v : camelize(v, keep)])
		);
	return x;
}

/** The first difference between two JSON-like values, or null. Numbers must be equal (0 and -0 count as equal),
 * or within `tol` when one is given. */
export function diff(actual: Json, expected: Json, tol = 0, path = '$'): string | null {
	if (typeof expected === 'number' && typeof actual === 'number') {
		if (actual === expected || (tol > 0 && Math.abs(actual - expected) <= tol)) return null;
		return `${path}: ${actual} !== ${expected}`;
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return `${path}: not an array`;
		if (actual.length !== expected.length) return `${path}: length ${actual.length} !== ${expected.length}`;
		for (let i = 0; i < expected.length; i++) {
			const d = diff(actual[i], expected[i], tol, `${path}[${i}]`);
			if (d) return d;
		}
		return null;
	}
	if (expected !== null && typeof expected === 'object') {
		if (actual === null || typeof actual !== 'object') return `${path}: not an object`;
		const ka = Object.keys(actual).sort();
		const ke = Object.keys(expected).sort();
		if (ka.join() !== ke.join()) return `${path}: keys ${ka} !== ${ke}`;
		for (const k of ke) {
			const d = diff(actual[k], expected[k], tol, `${path}.${k}`);
			if (d) return d;
		}
		return null;
	}
	return actual === expected ? null : `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`;
}

/** Runs fn and returns {ok} or {error: message}. */
export function attempt<T>(fn: () => T): { ok: T } | { error: string } {
	try {
		return { ok: fn() };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
