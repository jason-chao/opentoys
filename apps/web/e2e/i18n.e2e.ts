import { expect, onboardPreview, strip, tab, test } from './fixtures';

// Each language, in a browser set to that language (a first visit follows the browser's language).
const locales = [
	{
		prefix: 'en',
		browser: 'en-GB',
		lang: 'en',
		welcome: 'Welcome to opentoys',
		patterns: 'Patterns',
		stop: 'Stop',
		preview: 'Preview',
		device: 'Bananasome Dragon S1',
		control: 'Control',
		estim: 'E-stim'
	},
	{
		prefix: 'zh-hant',
		browser: 'zh-TW',
		lang: 'zh-Hant',
		welcome: '歡迎使用 opentoys',
		patterns: '模式',
		stop: '停止',
		preview: '預覽',
		device: '蕉帥 馭龍 S1（Bananasome Dragon S1）',
		control: '控制',
		estim: '電擊'
	},
	{
		prefix: 'zh-hans',
		browser: 'zh-CN',
		lang: 'zh-Hans-CN',
		welcome: '欢迎使用 opentoys',
		patterns: '模式',
		stop: '停止',
		preview: '预览',
		device: '蕉帅 驭龙 S1（Bananasome Dragon S1）',
		control: '控制',
		estim: '电击'
	}
];

for (const l of locales) {
	test.describe(`in ${l.lang}`, () => {
		test.use({ locale: l.browser });
		test(`${l.prefix}: welcome, patterns and control`, async ({ page }) => {
			await page.goto(`/${l.prefix}/`);
			await expect(page.locator('html')).toHaveAttribute('lang', l.lang);
			await expect(page.getByRole('heading', { name: l.welcome })).toBeVisible();
			await onboardPreview(page, l.prefix);
			await expect(page.getByRole('heading', { level: 1, name: l.patterns })).toBeVisible();
			// The status strip names the device in full, in this language, with its state.
			await expect(strip(page, 'ring')).toContainText(l.device);
			await expect(strip(page, 'ring')).toContainText(l.preview);
			await expect(page.locator('.legend')).toContainText(l.estim);
			await page.locator('a[href$="?id=wave"]').click();
			await page.locator('.pinned .btn').click();
			await expect(page).toHaveURL(new RegExp(`/${l.prefix}/control/$`));
			await expect(page.locator('[aria-current=page]:visible')).toHaveText(l.control);
			await expect(page.getByRole('button', { name: l.stop, exact: true })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(page.getByRole('button', { name: l.stop, exact: true })).toBeHidden();
		});
	});
}

test.describe('a first visit follows the browser language', () => {
	test.use({ locale: 'zh-TW' });

	test('the bare root: zh-TW → Traditional Chinese', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/zh-hant\//);
		await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
	});

	test('an English link opens in Traditional Chinese, until English is chosen in the header', async ({
		page
	}) => {
		await page.goto('/en/welcome/');
		await expect(page).toHaveURL(/\/zh-hant\/welcome\/$/);
		await expect(page.getByRole('heading', { name: '歡迎使用 opentoys' })).toBeVisible();
		// Just viewing pages doesn't fix the language.
		await page.goto('/en/');
		await expect(page).toHaveURL(/\/zh-hant\/welcome\/$/);

		await page.getByRole('button', { name: '語言' }).click();
		await page.getByRole('link', { name: 'English' }).click();
		await expect(page).toHaveURL(/\/en\/welcome\/$/);
		await expect(page.getByRole('heading', { name: 'Welcome to opentoys' })).toBeVisible();
		// Now it stays English: on a reload, on the welcome page, and from the bare root.
		await page.reload();
		await expect(page).toHaveURL(/\/en\/welcome\/$/);
		await page.goto('/');
		await expect(page).toHaveURL(/\/en\//);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	});
});

test.describe('the bare root falls back to English', () => {
	test.use({ locale: 'fr-FR' });
	test('fr-FR → English', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/en\//);
	});
});

test('switching language keeps what is connected and what is shown', async ({ page }) => {
	await onboardPreview(page);
	await page.getByRole('tab', { name: /Adjustable/ }).click();
	await page.getByRole('button', { name: 'Language' }).click();
	await page.getByRole('link', { name: '简体中文' }).click();
	await expect(page).toHaveURL(/\/zh-hans\/\?section=generated$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans-CN');
	await expect(page.getByRole('tab', { name: /可调/ })).toHaveAttribute('aria-selected', 'true');
	await expect(strip(page, 'ring')).toContainText('预览');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'preview');
	await tab(page, 3);
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans-CN');
	// The choice is remembered for the next visit.
	await page.goto('/');
	await expect(page).toHaveURL(/\/zh-hans\//);
});
