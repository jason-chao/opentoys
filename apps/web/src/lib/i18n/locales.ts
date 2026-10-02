import { baseLocale, isLocale, locales, type Locale } from '$lib/paraglide/runtime';

/** BCP 47 tag for `<html lang>`: tells the browser which CJK glyph forms and fonts to use. */
export const htmlLang: Record<Locale, string> = {
	en: 'en',
	'zh-Hant': 'zh-Hant',
	'zh-Hans': 'zh-Hans-CN'
};

/** Each language's name in itself, so it can always be recognised; never translated. */
export const endonyms: Record<Locale, string> = {
	en: 'English',
	'zh-Hant': '繁體中文',
	'zh-Hans': '简体中文'
};

/** A short form of each endonym for tight spaces (the language button in the header); never translated. */
export const shortNames: Record<Locale, string> = {
	en: 'EN',
	'zh-Hant': '繁',
	'zh-Hans': '简'
};

const STORAGE_KEY = 'opentoys.locale';

/** Map the browser's preferred languages (navigator.languages) to one of ours. */
export function detectLocale(preferred: readonly string[]): Locale {
	for (const tag of preferred) {
		const [language, ...rest] = tag.toLowerCase().split('-');
		if (language === 'en') return 'en';
		if (language === 'zh') {
			// Script subtag first (zh-Hant-HK, zh-Hans-SG), then the region.
			if (rest.includes('hant')) return 'zh-Hant';
			if (rest.includes('hans')) return 'zh-Hans';
			if (rest.some((r) => r === 'tw' || r === 'hk' || r === 'mo')) return 'zh-Hant';
			return 'zh-Hans';
		}
	}
	return baseLocale;
}

export function rememberLocale(locale: Locale): void {
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// Storage can be unavailable (private mode, blocked site data); the choice just isn't kept.
	}
}

export function recallLocale(): Locale | undefined {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored && isLocale(stored) ? stored : undefined;
	} catch {
		return undefined;
	}
}

export { locales };
