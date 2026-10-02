import { describe, expect, it } from 'vitest';
import { detectLocale } from './locales';

describe('detectLocale', () => {
	it.each([
		[['zh-TW'], 'zh-Hant'],
		[['zh-HK', 'en'], 'zh-Hant'],
		[['zh-MO'], 'zh-Hant'],
		[['zh-Hant-SG'], 'zh-Hant'],
		[['zh-CN'], 'zh-Hans'],
		[['zh-SG'], 'zh-Hans'],
		[['zh'], 'zh-Hans'],
		[['zh-Hans-HK'], 'zh-Hans'],
		[['en-GB', 'zh-TW'], 'en'],
		[['fr-FR', 'zh-HK'], 'zh-Hant'],
		[['fr-FR', 'de'], 'en'],
		[[], 'en']
	] as const)('%j → %s', (preferred, expected) => {
		expect(detectLocale(preferred)).toBe(expected);
	});
});
