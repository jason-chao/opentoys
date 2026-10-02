// Small things about the ring's patterns that several of its screens need.
import type { CatalogueItem } from '@opentoys/core';

/** Whether a pattern, with these settings, has e-stim in it. */
export function usesEstim(
	item: CatalogueItem | undefined,
	params: Record<string, number | string> | null
): boolean {
	if (!item) return false;
	if (item.category === 'combined') return true;
	const mode = item.schema.find((p) => p.key === 'estim_mode');
	return !!mode && (params?.estim_mode ?? mode.default) !== 'off';
}

/** A pattern's settings as they are before anyone changes them. */
export function defaultParams(item: CatalogueItem): Record<string, number | string> | null {
	if (!item.generator) return null;
	const out: Record<string, number | string> = {};
	for (const p of item.schema) out[p.key] = p.default;
	return out;
}
