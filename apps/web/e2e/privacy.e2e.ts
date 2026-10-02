import { expect, onboardPreview, test } from './fixtures';

test('no request leaves the origin on any page', async ({ page }) => {
	// The fixture fails the test on external requests and console errors (e.g. CSP violations).
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await onboardPreview(page);
	for (const path of [
		'/en/',
		'/en/pattern/?id=wave',
		'/en/control/',
		'/zh-hans/now/',
		'/en/saved/',
		'/en/about/',
		'/en/welcome/',
		'/zh-hans/settings/device/?id=coyote-3',
		'/en/settings/devices/',
		'/en/settings/playback/',
		'/en/settings/data/',
		'/zh-hant/settings/'
	]) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
});

test('pages carry a same-origin CSP', async ({ page }) => {
	await page.goto('/en/');
	const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("connect-src 'self'");
});
