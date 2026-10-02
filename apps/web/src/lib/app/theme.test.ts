import { describe, expect, it } from 'vitest';
import { DARK_THEMES, parseTheme, resolveTheme, THEMES } from './theme';

describe('colour modes', () => {
	it('reads a stored choice, including the names from before there were four modes', () => {
		expect(parseTheme(null)).toBe('auto');
		expect(parseTheme('junk')).toBe('auto');
		expect(parseTheme('dark')).toBe('ember');
		expect(parseTheme('light')).toBe('dawn');
		for (const t of THEMES) expect(parseTheme(t)).toBe(t);
	});

	it('resolves Auto against the system: Ember in dark, Dawn in light', () => {
		expect(resolveTheme('auto', true)).toBe('ember');
		expect(resolveTheme('auto', false)).toBe('dawn');
		expect(resolveTheme('tide', false)).toBe('tide');
		expect(resolveTheme('silk', true)).toBe('silk');
	});

	it('knows which modes are dark', () => {
		expect([...DARK_THEMES].sort()).toEqual(['ember', 'tide']);
	});
});
