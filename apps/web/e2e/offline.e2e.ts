import { expect, test } from '@playwright/test';

// The service worker precaches the site: once installed, the app opens with no network at all. (A browser set
// to Chinese, so the welcome page stays in the language of its URL.)
test.describe('offline', () => {
	test.use({ locale: 'zh-CN' });
	test('works offline after the first visit', async ({ page, context }) => {
		await page.goto('/zh-hans/');
		await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.ready;
			return reg.active?.state;
		});
		await context.setOffline(true);
		await page.goto('/zh-hans/welcome/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans-CN');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await context.setOffline(false);
	});
});

test('the manifest makes it installable', async ({ page, request }) => {
	await page.goto('/en/');
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(href).toBeTruthy();
	const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
	expect(manifest.name).toBe('opentoys');
	expect(manifest.display).toBe('standalone');
	expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
});
