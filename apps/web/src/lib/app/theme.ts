// Colour modes: a per-viewer convenience kept in localStorage (never required: without storage the page just
// follows the system). The colours themselves are CSS tokens (styles/base.css), chosen by `data-theme` on
// <html>; with no attribute the CSS follows prefers-color-scheme (Ember in dark, Dawn in light).
// static/theme.js applies the stored choice before the first paint; keep the two in step.
export const THEMES = ['auto', 'ember', 'dawn', 'tide', 'silk'] as const;
export type ThemeChoice = (typeof THEMES)[number];
/** A theme as applied ('auto' resolved against the system). */
export type ThemeName = Exclude<ThemeChoice, 'auto'>;

export const THEME_KEY = 'opentoys.theme';

/** Dark themes (for the orb's shading and the browser's own controls). */
export const DARK_THEMES: ReadonlySet<ThemeName> = new Set(['ember', 'tide']);

/** A stored value, including the names used before there were more than two themes. */
export function parseTheme(stored: string | null): ThemeChoice {
	if (stored === 'dark') return 'ember';
	if (stored === 'light') return 'dawn';
	return (THEMES as readonly string[]).includes(stored ?? '') ? (stored as ThemeChoice) : 'auto';
}

export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): ThemeName =>
	choice === 'auto' ? (systemDark ? 'ember' : 'dawn') : choice;

export function loadTheme(): ThemeChoice {
	try {
		return parseTheme(localStorage.getItem(THEME_KEY));
	} catch {
		return 'auto';
	}
}

export function saveTheme(theme: ThemeChoice): void {
	try {
		if (theme === 'auto') localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, theme);
	} catch {
		// not kept; the page follows the system next time
	}
}

/** Set (or clear, for auto) `data-theme`, and give the browser's own bars the page's background colour. */
export function applyTheme(theme: ThemeChoice): void {
	const root = document.documentElement;
	if (theme === 'auto') delete root.dataset.theme;
	else root.dataset.theme = theme;
	const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
	if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/** A CSS colour token of the current theme, as written in base.css (e.g. '#ff9a5c'). */
export function token(name: string, el: Element = document.documentElement): string {
	return getComputedStyle(el).getPropertyValue(name).trim();
}
