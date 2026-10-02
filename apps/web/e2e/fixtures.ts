import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { installFakeBluetooth } from './fake-bluetooth';

// Every test fails on a console error or on any request that leaves the origin.
export const test = base.extend<{ watch: string[] }>({
	watch: [
		async ({ page, baseURL }, use) => {
			const origin = new URL(baseURL!).origin;
			const problems: string[] = [];
			page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
			page.on('pageerror', (e) => problems.push(`page error: ${e}`));
			page.on('request', (r) => {
				const url = new URL(r.url());
				if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== origin)
					problems.push(`external request: ${r.url()}`);
			});
			await use(problems);
			expect(problems, 'console errors or external requests').toEqual([]);
		},
		{ auto: true }
	]
});
export { expect };

export type DeviceChoice = 'ring' | 'coyote';
export const DEVICE_ID: Record<DeviceChoice, string> = { ring: 'dragon-s1', coyote: 'coyote-3' };
export const DEVICE_NAME: Record<DeviceChoice, string> = {
	ring: 'Bananasome Dragon S1',
	coyote: 'DG-LAB Coyote 3.0'
};
/** The order devices are listed in everywhere: the Coyote first. */
const DEVICE_INDEX: Record<DeviceChoice, number> = { coyote: 0, ring: 1 };

// ----- the frame around every page ---------------------------------------------------------------------------

/** A device's item in the status strip under the header. Its state is in `data-state`. */
export const strip = (page: Page, device: DeviceChoice): Locator =>
	page.locator(`.strip .item[data-device=${DEVICE_ID[device]}]`);

/** Patterns · Control · Saved · Settings · About, without reloading (a reload would start a new visit). */
export async function tab(page: Page, index: 0 | 1 | 2 | 3 | 4): Promise<void> {
	const nav = page.locator('.tabbar a');
	if (await nav.first().isVisible()) await nav.nth(index).click();
	else await page.locator('.desk-nav a').nth(index).click();
}

/** The one Stop on Control (or the one in a sheet that is open over it). */
export const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true }).last();

/** The sheet that is open over the page (More, connecting, a set-up). */
export const sheet = (page: Page) => page.getByRole('dialog');
export const closeSheet = (page: Page) => sheet(page).getByRole('button', { name: 'Close' }).click();

/** Pretend the page was hidden (another app in front) or shown again. */
export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
	await page.evaluate((s) => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);
}

/** Settings → a device's page. */
export async function deviceSettings(page: Page, device: DeviceChoice): Promise<void> {
	await tab(page, 3);
	await page.locator(`.hub a[data-device=${DEVICE_ID[device]}]`).click();
	await expect(page.getByRole('heading', { level: 1, name: DEVICE_NAME[device] })).toBeVisible();
}

// ----- welcome ---------------------------------------------------------------------------------------------------

/** Welcome: answer "Which devices do you have?". */
export async function chooseDevices(page: Page, devices: readonly DeviceChoice[]): Promise<void> {
	for (const d of devices)
		await page.locator('.welcome .mine input[type=checkbox]').nth(DEVICE_INDEX[d]).check();
}

/** Welcome, first screen: the devices and the 18+ tick. The browser's language must match `locale`. */
export async function welcome(page: Page, locale: string, devices: readonly DeviceChoice[]): Promise<void> {
	await page.goto(`/${locale}/`);
	await expect(page).toHaveURL(new RegExp(`/${locale}/welcome/$`));
	await chooseDevices(page, devices);
	await page.locator('.welcome .adult input').check();
}

/** Welcome → the connect step, for the chosen devices (the ring alone unless said otherwise). */
export async function toConnectStep(
	page: Page,
	locale = 'en',
	devices: readonly DeviceChoice[] = ['ring']
): Promise<void> {
	await welcome(page, locale, devices);
	await page.locator('.welcome .actions .btn.primary').click();
	await expect(page.locator('.welcome .connect').first()).toBeVisible();
}

/** First run without a device: "Look around" on the first screen goes straight to Patterns. */
export async function onboardPreview(
	page: Page,
	locale = 'en',
	devices: readonly DeviceChoice[] = ['ring']
): Promise<void> {
	await welcome(page, locale, devices);
	await page.locator('.welcome .actions .btn:not(.primary)').click();
	await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
	for (const d of devices) await expect(strip(page, d)).toHaveAttribute('data-state', 'preview');
}
export const onboardPreviewOf = (page: Page, devices: readonly DeviceChoice[]) =>
	onboardPreview(page, 'en', devices);

/** The tick under a device's safety notes, in its set-up. */
export const AGREE = 'I have read and accept these safety notes, and none of the exclusions applies to me.';

// ----- the ring ----------------------------------------------------------------------------------------------------

/** Press and release + (or −) in the open set-up `times` times. */
async function press(setup: Locator, name: 'Higher' | 'Lower', times: number): Promise<void> {
	await taps(setup.getByRole('button', { name, exact: true }), times);
}

/**
 * Many single steps on a − or + button, as a keyboard would give them (a click that no pointer made): one
 * step each, without the pointer's travel, so a long way doesn't take the test long. Pressing and holding
 * with a pointer is tested where it matters.
 */
export async function taps(button: Locator, times: number): Promise<void> {
	await expect(button).toBeVisible();
	for (let i = 0; i < times; i++) {
		await expect(button).toBeEnabled();
		await button.dispatchEvent('click', { detail: 0 });
	}
}

/**
 * The ring's set-up as it opens at its first connection: agree to its safety notes, skip the vibration levels
 * (the defaults do) and leave e-stim for later.
 */
export async function ringSetupSkipLevels(page: Page): Promise<void> {
	const setup = page.locator('.setup');
	await setup.getByText(AGREE).click();
	await setup.getByRole('button', { name: 'Next' }).click();
	await setup.getByRole('button', { name: 'Skip, use the defaults' }).click();
	await setup.getByRole('button', { name: 'Not now' }).click();
	await setup.getByRole('button', { name: 'Done' }).click();
	await expect(setup).toHaveCount(0);
}

/**
 * First run with the (fake) ring: connect, agree to its safety notes, skip the levels. Lands on Patterns.
 * Call before anything else: the fake has to be installed before the page loads.
 */
export async function onboardDevice(page: Page, locale = 'en'): Promise<void> {
	await installFakeBluetooth(page);
	await toConnectStep(page, locale, ['ring']);
	await page.locator('.welcome .connect .btn.primary').click();
	await ringSetupSkipLevels(page);
	await expect(page).toHaveURL(new RegExp(`/${locale}/$`));
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'connected');
}

/**
 * The e-stim part of the ring's set-up, once it is open at its safety notes: the lowest level felt (4 %), the
 * maximum (24 %), and the button that enables it.
 */
export async function ringSetupEstim(page: Page): Promise<void> {
	const setup = page.locator('.setup');
	await setup.getByText(AGREE).click();
	await setup.getByRole('button', { name: 'Next' }).click();
	await setup.getByRole('button', { name: 'Start', exact: true }).click();
	await press(setup, 'Higher', 4);
	await setup.getByRole('button', { name: 'I can feel it now' }).click();
	await press(setup, 'Higher', 20);
	await setup.getByRole('button', { name: 'This is my maximum' }).click();
	await expect(setup.getByText('Your e-stim range is 4% to 24%.')).toBeVisible();
	await setup.getByRole('button', { name: 'Enable e-stim' }).click();
	await expect(setup).toHaveCount(0);
}

/** Settings → the ring → "Set up e-stim", all the way through (needs a real ring, already agreed). */
export async function setUpEstim(page: Page): Promise<void> {
	await deviceSettings(page, 'ring');
	await page.getByRole('button', { name: 'Set up e-stim' }).click();
	await ringSetupEstim(page);
	await expect(page.getByText('E-stim is enabled.')).toBeVisible();
}

/** Open one of the ring's built-in patterns from Patterns, choosing its section tab first. */
export async function openPattern(page: Page, id: string): Promise<void> {
	await tab(page, 0);
	await expect(page.getByRole('heading', { level: 1, name: 'Patterns' })).toBeVisible();
	// With several devices: the ring's patterns.
	if (await deviceSwitch(page).count())
		await deviceSwitch(page).getByRole('button', { name: DEVICE_NAME.ring }).click();
	await expect(page.getByRole('tablist')).toBeVisible();
	const link = page.locator(`a[href$="?id=${id}"]`);
	for (const sectionTab of await page.getByRole('tab').all()) {
		if (await link.count()) break;
		await sectionTab.click();
		await expect(sectionTab).toHaveAttribute('aria-selected', 'true');
	}
	await link.click();
	await expect(page).toHaveURL(new RegExp(`\\?id=${id}$`));
}

/** Start one of the ring's patterns with the pinned Start; lands on Control. */
export async function start(page: Page, id: string): Promise<void> {
	await openPattern(page, id);
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
}

/** A row on Control: one output of a device ('vibration', 'estim', 'a', 'b'). */
export const row = (page: Page, output: 'vibration' | 'estim' | 'a' | 'b'): Locator =>
	page.locator(`.row[data-output=${output}]`);

/** The ring's level being sent now, as shown on its row (0 when the row shows none). */
export async function readout(page: Page, channel: 0 | 1): Promise<number> {
	const live = row(page, channel === 0 ? 'vibration' : 'estim').locator('.live');
	if (!(await live.count())) return 0;
	const n = parseInt(((await live.textContent()) ?? '').replace(/[^0-9]/g, ''), 10);
	return Number.isFinite(n) ? n : 0;
}

/** "More" on a row: the sheet with what belongs to that output. */
export async function openMore(page: Page, output: 'vibration' | 'estim' | 'a' | 'b'): Promise<Locator> {
	await row(page, output).getByRole('button', { name: /^More/ }).click();
	await expect(sheet(page)).toBeVisible();
	return sheet(page);
}

// ----- the Coyote 3.0 -----------------------------------------------------------------------------------------------

/** One channel's row on Control. */
export const channel = (page: Page, ch: 'a' | 'b') => row(page, ch);

/** The intensity shown for a channel. */
export async function intensity(page: Page, ch: 'a' | 'b'): Promise<number> {
	return Number((await row(page, ch).locator('.val').textContent()) ?? Number.NaN);
}

/** Press + (or −) on a channel's row `times` times. */
export async function stepIntensity(
	page: Page,
	ch: 'a' | 'b',
	times: number,
	name = 'Higher'
): Promise<void> {
	await taps(row(page, ch).getByRole('button', { name, exact: true }), times);
}

/**
 * The Coyote's set-up, once it is open at its safety notes: agree, step each channel up to the given maximum
 * (0 = "I don't use this channel"), and enable it. Needs the fake Coyote connected.
 */
export async function setUpCoyote(page: Page, maxA = 30, maxB = 40, agree = true): Promise<void> {
	const setup = page.locator('.setup');
	if (agree) {
		await setup.getByText(AGREE).click();
		await setup.getByRole('button', { name: 'Next' }).click();
	}
	for (const [name, max] of [
		['Channel A', maxA],
		['Channel B', maxB]
	] as const) {
		if (max === 0) {
			await setup.getByRole('button', { name: `I don't use ${name}` }).click();
			continue;
		}
		await setup.getByRole('button', { name: `Start ${name}` }).click();
		await press(setup, 'Higher', max);
		await expect(setup.locator('.val')).toHaveText(String(max));
		await setup.getByRole('button', { name: 'This is my maximum' }).click();
	}
	await setup.getByRole('button', { name: 'Enable device' }).click();
	await expect(setup).toHaveCount(0);
}

/**
 * First run with the (fake) Coyote alone: connect, then its set-up (or close it with `setUp: false`). Lands
 * on Patterns. Call before anything else.
 */
export async function onboardCoyote(
	page: Page,
	opts: { setUp?: boolean; maxA?: number; maxB?: number } = {}
): Promise<void> {
	await installFakeBluetooth(page);
	await toConnectStep(page, 'en', ['coyote']);
	await page.locator('.welcome .connect .btn.primary').click();
	await expect(sheet(page).getByRole('heading', { name: 'Set up DG-LAB Coyote 3.0' })).toBeVisible();
	if (opts.setUp === false) await closeSheet(page);
	else await setUpCoyote(page, opts.maxA, opts.maxB);
	await expect(page).toHaveURL(/\/en\/$/);
}

/**
 * First run with both (fake) devices connected: the Coyote is set up, the ring's notes are agreed to and its
 * levels skipped. Lands on Patterns, with the Coyote shown.
 */
export async function onboardBoth(page: Page): Promise<void> {
	await installFakeBluetooth(page);
	await toConnectStep(page, 'en', ['ring', 'coyote']);
	const connect = page.locator('.welcome .connect');
	await connect.nth(0).getByRole('button', { name: 'Connect device' }).click();
	await setUpCoyote(page);
	await expect(connect.nth(0).getByText('Connected. Battery 76%')).toBeVisible();
	await connect.nth(1).getByRole('button', { name: 'Connect device' }).click();
	await ringSetupSkipLevels(page);
	await expect(connect.nth(1).getByText('Connected. Battery 87%')).toBeVisible();
	await page.getByRole('button', { name: 'Continue' }).click();
	await expect(page).toHaveURL(/\/en\/$/);
}

/** The device switch at the top of Patterns (only there with several devices). */
export const deviceSwitch = (page: Page) => page.locator('.switch[role=group]');

/** Open one of the Coyote's patterns from Patterns (with both devices: after switching to the Coyote). */
export async function openCoyotePattern(page: Page, id: string): Promise<void> {
	await tab(page, 0);
	await expect(page.getByRole('heading', { level: 1, name: 'Patterns' })).toBeVisible();
	if (await deviceSwitch(page).count())
		await deviceSwitch(page).getByRole('button', { name: DEVICE_NAME.coyote }).click();
	await page.locator(`a[href$="device=coyote-3&id=${id}"]`).click();
	await expect(page).toHaveURL(new RegExp(`id=${id}$`));
}

/** Start one of the Coyote's patterns on a channel (or both) with the pinned Start; lands on Control. */
export async function startCoyote(
	page: Page,
	id: string,
	where: 'Channel A' | 'Channel B' | 'Both channels' = 'Channel A'
): Promise<void> {
	await openCoyotePattern(page, id);
	await page.locator('.seg').getByText(where, { exact: true }).click();
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
}
