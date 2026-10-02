import { describe, expect, it } from 'vitest';
import { backUsesHistory } from './back';

describe('Back to the list a page was opened from', () => {
	it('goes back in history when the user came from that list (so it is as they left it)', () => {
		expect(backUsesHistory('/en/', '/en/')).toBe(true);
		// The list's section and filter are in its URL, and scroll is the browser's: only the path matters.
		expect(backUsesHistory('/en/?section=combined&kind=waves', '/en/')).toBe(true);
		expect(backUsesHistory('/zh-hant/settings/', '/zh-hant/settings/')).toBe(true);
		expect(backUsesHistory('/en/settings', '/en/settings/')).toBe(true);
	});

	it('is a plain link when they came from somewhere else, or from nowhere', () => {
		expect(backUsesHistory(null, '/en/')).toBe(false); // opened directly, or after a reload
		expect(backUsesHistory(undefined, '/en/')).toBe(false);
		expect(backUsesHistory('/en/control/', '/en/')).toBe(false); // Control's link to the pattern's page
		expect(backUsesHistory('/en/', '/en/settings/')).toBe(false);
		expect(backUsesHistory('/zh-hant/', '/en/')).toBe(false); // after a language switch
	});
});
