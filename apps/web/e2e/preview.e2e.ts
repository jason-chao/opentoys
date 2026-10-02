import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeBluetooth, levels } from './fake-bluetooth';
import {
	closeSheet,
	deviceSettings,
	expect,
	onboardPreview,
	openMore,
	openPattern,
	readout,
	ringSetupSkipLevels,
	row,
	sheet,
	start,
	stopButton,
	strip,
	tab,
	test
} from './fixtures';

// Looking around without a device: everything plays on screen only. Nothing is felt, so nothing can be set
// up, e-stim is shown without being set up, and nothing goes into the usage history.

test('first run without a device: the 18+ tick, then one tap from the first screen to Patterns', async ({
	page
}) => {
	await page.goto('/en/control/');
	await expect(page).toHaveURL(/\/en\/welcome\/$/);
	// The language menu is in the header: no language row on the page itself.
	await expect(page.locator('main').getByRole('link', { name: '繁體中文' })).toHaveCount(0);
	// Both actions wait for the 18+ tick. Next also waits for a device to be chosen.
	const look = page.getByRole('button', { name: 'Look around without a device' });
	const next = page.getByRole('button', { name: 'Next' });
	await expect(look).toBeDisabled();
	await expect(next).toBeDisabled();
	await page.getByText('I am 18 or over.').click();
	await expect(next).toBeDisabled();
	await expect(look).toBeEnabled();
	// The Coyote is listed first.
	await expect(page.locator('.welcome .mine label strong')).toHaveText([
		'DG-LAB Coyote 3.0',
		'Bananasome Dragon S1'
	]);
	// Looking around skips the safety notes (they belong to a device's set-up) and, with no device ticked,
	// previews both.
	await look.click();
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Patterns' })).toBeVisible();
	await expect(page.getByText(/pacemaker/)).toHaveCount(0);
	await expect(sheet(page)).toHaveCount(0);
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'preview');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'preview');
	await expect(strip(page, 'ring')).toContainText('Bananasome Dragon S1');
	await expect(page.getByText('Devices marked Preview play on screen only.')).toHaveCount(1);
	await expect(page.getByText(/demo/i)).toHaveCount(0);
});

test('a preview plays on screen with e-stim, stays out of History, and cannot be set up', async ({
	page
}) => {
	await onboardPreview(page);
	await openPattern(page, 'tingle-bed');
	await expect(page.getByText('Include e-stim')).toBeVisible();
	await expect(page.getByText(/e-stim disabled/i)).toHaveCount(0);
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
	// One preview notice per screen, with the status strip.
	await expect(page.getByText('Devices marked Preview play on screen only.')).toHaveCount(1);
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	await expect.poll(() => readout(page, 1), { timeout: 8000 }).toBeGreaterThan(0);
	await page.waitForTimeout(5500);
	await stopButton(page).click();
	await expect.poll(() => readout(page, 0)).toBe(0);
	await expect(page.getByText('You stopped playback.')).toBeVisible();

	await tab(page, 2);
	await expect(page.getByText("You haven't played anything on a device yet.")).toBeVisible();

	await deviceSettings(page, 'ring');
	const connection = page.locator('#connection');
	await expect(connection.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
	await expect(connection.getByRole('button', { name: 'Connect device' })).toBeVisible();
	await expect(connection.getByRole('button', { name: 'Look around without a device' })).toHaveCount(0);
	const setup = page.locator('#setup');
	await expect(setup.getByText('Connect and wear your device to calibrate it.')).toBeVisible();
	await expect(setup.getByRole('button', { name: 'Set up', exact: true })).toBeDisabled();
	await expect(setup.getByText('Set-up needed')).toBeVisible();

	// A new visit is not a preview any more: e-stim is locked again.
	await page.goto('/en/pattern/?id=tingle-bed');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'idle');
	await expect(page.getByText('With e-stim disabled, this pattern plays vibration only.')).toBeVisible();
	await expect(page.getByText('Include e-stim')).toHaveCount(0);
});

test('connecting a device from a preview opens its set-up in place, and e-stim is locked again', async ({
	page
}) => {
	await installFakeBluetooth(page);
	await onboardPreview(page);
	await start(page, 'tingle-bed');
	await expect.poll(() => readout(page, 1), { timeout: 8000 }).toBeGreaterThan(0);

	// Still playing (on screen) while the real ring is connected from the status strip.
	await strip(page, 'ring').click();
	await sheet(page).getByRole('button', { name: 'Connect device' }).click();
	// The set-up opens where the ring was connected: its safety notes come before anything is sent to it.
	await expect(sheet(page).getByRole('heading', { name: 'Set up Bananasome Dragon S1' })).toBeVisible();
	expect((await levels(page)).every((f) => f.vib === 0 && f.estim === 0)).toBe(true);
	await ringSetupSkipLevels(page);
	await expect(page).toHaveURL(/\/control\/$/); // back where it was opened
	await expect(strip(page, 'ring')).toContainText('Connected · Battery 87%');
	await expect(stopButton(page)).toBeHidden(); // the preview's playback ended with the preview
	await expect(page.getByText('Devices marked Preview play on screen only.')).toHaveCount(0);

	await openPattern(page, 'tingle-bed');
	await expect(page.getByText('With e-stim disabled, this pattern plays vibration only.')).toBeVisible();
	await page.locator('.pinned .btn').click();
	await expect.poll(async () => (await levels(page)).at(-1)?.vib ?? 0, { timeout: 8000 }).toBeGreaterThan(0);
	await page.waitForTimeout(1500);
	await expect(row(page, 'estim')).toContainText('Disabled');
	expect((await levels(page)).every((f) => f.estim === 0)).toBe(true);
	await stopButton(page).click();
});

test('Start is pinned in view, and asks for a device when there is none', async ({ page }) => {
	await onboardPreview(page);
	await openPattern(page, 'gen-edge'); // a long page: waveform and eight settings
	const startButton = page.locator('.pinned .btn');
	await expect(startButton).toBeInViewport({ ratio: 1 });
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	await expect(page.locator('.pattern canvas')).toHaveCount(0); // the waveform is the preview: no orb here

	// Something is playing: its Stop stays reachable, above the pinned Start.
	await startButton.click();
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	await openPattern(page, 'gen-surprise');
	const bar = page.locator('.nowbar');
	await expect(bar.getByRole('button', { name: 'Stop' })).toBeInViewport({ ratio: 1 });
	await expect(startButton).toBeInViewport({ ratio: 1 });
	const [barBox, startBox] = [await bar.boundingBox(), await startButton.boundingBox()];
	expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(startBox!.y);
	await bar.getByRole('button', { name: 'Stop' }).click();
	await expect(bar).toBeHidden();

	// A new visit, not connected: Start opens the two choices, and the pattern starts once one is made.
	await page.goto('/en/pattern/?id=wave');
	await page.locator('.pinned .btn').click();
	const connect = page.getByRole('dialog', { name: 'Connect a device, or look around without one' });
	await expect(connect.getByRole('button', { name: 'Connect device' })).toBeVisible();
	await connect.getByRole('button', { name: 'Look around without a device' }).click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect(row(page, 'vibration')).toContainText('Wave');
	await stopButton(page).click();
});

test('Control shows a rolling graph of what was sent, and the orb is a display, not a dial', async ({
	page
}) => {
	await onboardPreview(page);
	await start(page, 'wave');
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	await expect(page.getByText("The light's body shows vibration, its threads e-stim.")).toBeVisible();
	// Nothing on the orb can be operated: no slider, no button.
	await expect(page.locator('.stage').getByRole('slider')).toHaveCount(0);
	await expect(page.locator('.stage button')).toHaveCount(0);
	await expect(page.locator('.stage [role=img]')).toHaveAttribute(
		'aria-label',
		'A light that shows what is playing'
	);
	// Each row has a small trace. Something has been drawn in the vibration row's.
	const painted = (selector: string) =>
		page.evaluate((sel) => {
			const c = document.querySelector<HTMLCanvasElement>(sel)!;
			const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let n = 0;
			for (let i = 3; i < data.length; i += 4) if (data[i] > 200) n++;
			return n;
		}, selector);
	await expect.poll(() => painted('.row[data-output=vibration] canvas')).toBeGreaterThan(50);
	// "More" has the full graph, with its time axis, and its own Stop.
	const more = await openMore(page, 'vibration');
	await expect(more.locator('.graph[aria-hidden=true]')).toBeVisible(); // the numbers are the readout
	await expect(more.getByText('10 sec ago')).toBeVisible();
	await expect.poll(() => painted('[role=dialog] .graph canvas')).toBeGreaterThan(50);
	await more.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(more.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
	await closeSheet(page);
	await expect(page.getByText('You stopped playback.')).toBeVisible();
});

test('More on a row: choose a pattern, intensify slowly, open the pattern page, stop the device', async ({
	page
}) => {
	await onboardPreview(page);
	await tab(page, 1);
	// Nothing is playing: the row says what to do, and opens the picker.
	const vib = row(page, 'vibration');
	await expect(vib).toContainText('Nothing playing');
	await vib.getByRole('button', { name: 'Choose a pattern' }).click();
	const more = sheet(page);
	await more.getByLabel('Pattern').selectOption('heartbeat');
	await expect(vib).toContainText('Heartbeat');
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	await more.getByRole('switch', { name: 'Intensify slowly' }).check();
	await more.getByLabel('Pattern').selectOption('tingle-bed');
	await expect(vib).toContainText('Vibration waves + steady e-stim');
	await closeSheet(page);
	// The e-stim row follows the pattern: its own value, and its switch under More.
	const estim = row(page, 'estim');
	await expect(estim.locator('.val')).toHaveText('50%');
	await estim.getByRole('button', { name: 'Higher' }).click();
	await expect(estim.locator('.val')).toHaveText('55%');
	const estimMore = await openMore(page, 'estim');
	await estimMore.getByRole('switch', { name: 'Use e-stim' }).uncheck();
	await closeSheet(page);
	await expect(estim.locator('.status')).toHaveText('Off');
	await estim.getByRole('button', { name: 'Use e-stim' }).click();
	await expect(estim.locator('.val')).toHaveText('55%');
	// The pattern's own page, for its settings.
	const again = await openMore(page, 'vibration');
	await again.getByRole('link', { name: 'Pattern details' }).click();
	await expect(page).toHaveURL(/\/pattern\/\?id=tingle-bed$/);
	await tab(page, 1);
	const last = await openMore(page, 'vibration');
	await last.getByRole('button', { name: 'Stop vibration and e-stim' }).click();
	await expect(vib).toContainText('Nothing playing');
});

test('favourites: star a pattern, find it in the Favourites tab, and it is kept', async ({ page }) => {
	await onboardPreview(page);
	const favTab = page.getByRole('tab', { name: /Favourites/ });
	await expect(page.getByRole('tab', { name: /Vibration\s*16/ })).toHaveAttribute('aria-selected', 'true');
	await favTab.click();
	await expect(page.getByText('No favourites yet. Tap the star on a pattern to add it here.')).toBeVisible();

	await page.getByRole('tab', { name: /Vibration\s*16/ }).click();
	const star = page.getByRole('button', { name: 'Add Heartbeat to favourites' });
	await expect(star).toHaveAttribute('aria-pressed', 'false');
	await star.click();
	await expect(page.getByRole('button', { name: 'Remove Heartbeat from favourites' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// Starring doesn't move you to another tab.
	await expect(page.getByRole('tab', { name: /Vibration\s*16/ })).toHaveAttribute('aria-selected', 'true');
	// The pattern page has the star too.
	await openPattern(page, 'gen-drift');
	await page.getByRole('button', { name: 'Add Smooth variation to favourites' }).click();
	await tab(page, 0);
	await expect(favTab).toContainText('2');

	// A new visit opens on Favourites.
	await page.goto('/en/');
	await expect(favTab).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('a[href$="?id=heartbeat"]')).toBeVisible();
	await expect(page.locator('a[href$="?id=gen-drift"]')).toBeVisible();
	await page.getByRole('button', { name: 'Remove Heartbeat from favourites' }).click();
	await expect(page.locator('a[href$="?id=heartbeat"]')).toHaveCount(0);
	await expect(favTab).toContainText('1');
});

test('patterns are split into section tabs, kept in the URL, and fit a narrow phone', async ({ page }) => {
	await onboardPreview(page);
	await page.setViewportSize({ width: 360, height: 740 });
	await expect(page.locator('a[href$="?id=tingle-bed"]')).toHaveCount(0);
	await page.getByRole('tab', { name: /Vibration \+ e-stim/ }).click();
	await expect(page).toHaveURL(/\?section=combined$/);
	await expect(page.locator('a[href$="?id=tingle-bed"]')).toBeVisible();
	await page.getByRole('tab', { name: /Vibration \+ e-stim/ }).press('ArrowRight');
	await expect(page.getByRole('tab', { name: /Adjustable/ })).toBeFocused();
	await expect(page.locator('a[href$="?id=gen-drift"]')).toBeVisible();
	// Four tabs side by side, none wider than the screen.
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
	const tabs = await page.getByRole('tab').all();
	expect(tabs).toHaveLength(4);
	const tops = await Promise.all(tabs.map(async (t) => (await t.boundingBox())!.y));
	expect(new Set(tops.map(Math.round)).size).toBe(1);
});

test('Back from a pattern returns to the same section, filter and scroll position', async ({ page }) => {
	await onboardPreview(page);
	// A filter in the Vibration section, scrolled down to a pattern near the end of the list.
	await page.getByRole('button', { name: 'Build-ups' }).click();
	await expect(page).toHaveURL(/\?kind=buildups$/);
	await expect(page.locator('a[href$="?id=wave"]')).toHaveCount(0);
	const link = page.locator('a[href$="?id=build"]');
	await link.scrollIntoViewIfNeeded();
	await page.evaluate(() => window.scrollBy(0, 120));
	const scrolled = await page.evaluate(() => window.scrollY);
	expect(scrolled).toBeGreaterThan(0);
	await link.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Build' })).toBeVisible();
	await page.locator('main .back').click();
	await expect(page).toHaveURL(/\/en\/\?kind=buildups$/);
	await expect(page.getByRole('button', { name: 'Build-ups' })).toHaveAttribute('aria-pressed', 'true');
	await expect(link).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);

	// The same from another section.
	await page.getByRole('tab', { name: /Adjustable/ }).click();
	await page.locator('a[href$="?id=gen-arc"]').click();
	await page.locator('main .back').click();
	await expect(page).toHaveURL(/section=generated/);
	await expect(page.getByRole('tab', { name: /Adjustable/ })).toHaveAttribute('aria-selected', 'true');

	// Opened directly (no list behind it), Back is a plain link to Patterns.
	await page.goto('/en/pattern/?id=wave');
	await page.locator('main .back').click();
	await expect(page).toHaveURL(/\/en\/$/);
	// Settings pages go back to the hub the same way.
	await tab(page, 3);
	await page.getByRole('link', { name: /Playback/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Playback' })).toBeVisible();
	await page.locator('main .back').click();
	await expect(page).toHaveURL(/\/en\/settings\/$/);
});

test('five tabs fit a 360 px phone, and the old Now playing and Manual addresses lead to Control', async ({
	page
}) => {
	await onboardPreview(page);
	await page.setViewportSize({ width: 360, height: 740 });
	const tabs = page.locator('.tabbar a');
	await expect(tabs).toHaveText(['Patterns', 'Control', 'Saved', 'Settings', 'About']);
	const boxes = await Promise.all((await tabs.all()).map(async (t) => (await t.boundingBox())!));
	expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
	for (const b of boxes) {
		expect(b.x).toBeGreaterThanOrEqual(0);
		expect(b.x + b.width).toBeLessThanOrEqual(360);
		expect(b.height).toBeGreaterThanOrEqual(44);
	}
	// No label is cut off or runs into its neighbour.
	for (const t of await tabs.locator('span').all())
		expect(await t.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
	for (const i of [0, 1, 2, 3, 4] as const) {
		await tab(page, i);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
	}
	for (const old of ['now', 'manual']) {
		await page.goto(`/en/${old}/`);
		await expect(page).toHaveURL(/\/en\/control\/$/);
		await expect(page.locator('.tabbar a[aria-current=page]')).toHaveText('Control');
	}
});

test('colour modes: each one applies, is remembered, and Auto follows the system', async ({ page }) => {
	await onboardPreview(page);
	const html = page.locator('html');
	const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	const themeColor = () => page.locator('meta[name="theme-color"]').getAttribute('content');
	const seen = new Set<string>();
	for (const [name, id] of [
		['Ember (dark)', 'ember'],
		['Dawn (light)', 'dawn'],
		['Tide (dark)', 'tide'],
		['Silk (light)', 'silk']
	]) {
		await page.getByRole('button', { name: 'Colours' }).click();
		await page.getByRole('button', { name }).click();
		await expect(html).toHaveAttribute('data-theme', id);
		seen.add(`${await bg()} ${await themeColor()}`);
	}
	expect(seen.size).toBe(4);
	// Remembered, and applied before the app starts (static/theme.js).
	await page.reload();
	await expect(html).toHaveAttribute('data-theme', 'silk');
	await page.getByRole('button', { name: 'Colours' }).click();
	await expect(page.getByRole('button', { name: 'Silk (light)' })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Auto (follows the system)' }).click();
	await expect(html).not.toHaveAttribute('data-theme', /.+/);
	await page.emulateMedia({ colorScheme: 'dark' });
	const dark = await bg();
	await page.emulateMedia({ colorScheme: 'light' });
	expect(await bg()).not.toBe(dark);
	// A choice stored by the earlier light/dark toggle still works.
	await page.evaluate(() => localStorage.setItem('opentoys.theme', 'dark'));
	await page.reload();
	await expect(html).toHaveAttribute('data-theme', 'ember');
});

test('Settings is a short hub with a page per device, and About has the safety notes', async ({ page }) => {
	await onboardPreview(page, 'en', ['ring', 'coyote']);
	await tab(page, 3);
	const hub = page.locator('.hub a');
	await expect(hub.locator('.title')).toHaveText([
		'DG-LAB Coyote 3.0',
		'Bananasome Dragon S1',
		'My devices',
		'Playback',
		'Your data'
	]);
	await expect(hub.nth(0).locator('.state')).toHaveText('Preview · Set-up needed');
	await expect(hub.nth(3).locator('.state')).toHaveText('Session limit: 1 hr');
	// The hub is short: every row is on screen without scrolling.
	await expect(hub.last()).toBeInViewport({ ratio: 1 });
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	// A device page has everything about that device, once.
	await hub.nth(0).click();
	await expect(page.locator('.settings h2')).toHaveText([
		'Connection',
		'Set-up',
		'Limits',
		'When I leave this page'
	]);
	await page.getByRole('link', { name: 'Safety notes' }).click();
	await expect(page).toHaveURL(/\/about\/#safety$/);
	// About: what it is, the legal notice, the notes of the user's devices, the own-risk line, the version.
	await expect(page.getByRole('heading', { level: 1, name: 'About opentoys' })).toBeVisible();
	await expect(
		page.getByText('opentoys is an independent, non-commercial project, unaffiliated with any device maker.')
	).toBeVisible();
	await expect(page.locator('#safety h3')).toHaveText(['DG-LAB Coyote 3.0', 'Bananasome Dragon S1']);
	// What both devices share is said once, above each device's own notes.
	for (const shared of [
		'For adults (18+) only.',
		'Do not use e-stim with a pacemaker, other implanted device, heart condition or epilepsy.',
		'If anything hurts or feels wrong, press Stop now. If output continues, switch off the device itself.',
		'You are responsible for your safety and use opentoys entirely at your own risk. Its developers accept no liability.'
	])
		await expect(page.locator('#safety').getByText(shared)).toHaveCount(1);
	await expect(
		page.getByText(
			'Never place pads on the chest, head or neck, or across the chest (for example, one on each arm).'
		)
	).toHaveCount(1);
	await expect(page.getByText(/^Version \d/)).toBeVisible();
	// My devices: one device can be taken out, never the last one.
	await tab(page, 3);
	await page.getByRole('link', { name: /My devices/ }).click();
	const boxes = page.locator('.mine input[type=checkbox]');
	await boxes.nth(0).uncheck();
	await expect(boxes.nth(1)).toBeDisabled();
	await expect(strip(page, 'coyote')).toHaveCount(0);
	await tab(page, 4);
	await expect(page.locator('#safety h3')).toHaveText(['Bananasome Dragon S1']);
});

test('the mini bar stops output from any screen', async ({ page }) => {
	await onboardPreview(page);
	await start(page, 'steady');
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	await tab(page, 2);
	const bar = page.locator('.nowbar');
	await expect(bar).toContainText('Preview');
	await bar.getByRole('button', { name: 'Stop' }).click();
	await expect(bar).toBeHidden();
});

test('free control opened while a pattern plays starts at what is being sent, and the first touch takes over', async ({
	page
}) => {
	await onboardPreview(page);
	await start(page, 'steady');
	// Steady at 80 % intensity: 82 % once the warm-up has faded in (80 % of the way from 10 % to 100 %).
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBe(82);
	const sent = 82;
	await page.getByRole('button', { name: 'Free control' }).click();
	const pad = sheet(page).getByRole('slider', { name: 'Vibration level (touch pad)' });
	// Not 0: the level the pattern is at right now.
	await expect(pad).toHaveAttribute('aria-valuenow', String(sent));
	await expect(sheet(page).getByText(`Vibration ${sent}%`)).toBeVisible();
	// Opening it changed nothing: the pattern still plays.
	await expect(row(page, 'vibration')).toContainText('Steady');
	// The first touch takes over from there, one step down.
	await pad.focus();
	await page.keyboard.press('ArrowDown');
	await expect(pad).toHaveAttribute('aria-valuenow', String(sent - 5));
	await closeSheet(page);
	await expect(row(page, 'vibration')).toContainText('Free control');
	await expect(row(page, 'vibration').locator('.val')).toHaveText(`${sent - 5}%`);
	await stopButton(page).click();
});

test('free control, recorded and saved, then played from Saved', async ({ page }) => {
	await onboardPreview(page);
	await tab(page, 1);
	await page.getByRole('button', { name: 'Free control' }).click();
	const free = sheet(page);
	const pad = free.getByRole('slider', { name: 'Vibration level (touch pad)' });
	await pad.focus();
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
	await expect(pad).toHaveAttribute('aria-valuenow', '40');
	await free.getByRole('button', { name: 'Start recording' }).click();
	await page.waitForTimeout(10_500);
	await free.getByRole('button', { name: 'Stop recording' }).click();
	await free.getByRole('textbox', { name: 'Name' }).fill('My own');
	await free.getByRole('button', { name: 'Save pattern' }).click();
	await expect(free.getByText('Saved as “My own”.')).toBeVisible();
	// Its rows on the card show the same levels, and − and + move them.
	await closeSheet(page);
	const vib = row(page, 'vibration');
	await expect(vib).toContainText('Free control');
	await expect(vib.locator('.val')).toHaveText('40%');
	await vib.getByRole('button', { name: 'Higher' }).click();
	await expect(vib.locator('.val')).toHaveText('45%');
	await stopButton(page).click();
	await tab(page, 2);
	await expect(page.getByText('My own')).toBeVisible();
	await page.getByRole('button', { name: 'Play' }).click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect(row(page, 'vibration')).toContainText('My own');
	await stopButton(page).click();
});

test('export and import round trip, and delete everything', async ({ page }) => {
	await onboardPreview(page);
	await tab(page, 2);
	await expect(page.getByText('You have no saved patterns yet.')).toBeVisible();
	await page.locator('input[type=file]').setInputFiles({
		name: 'mode.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				format: 'ring-link-mode/1',
				name: 'Imported one',
				period_ms: 100,
				vib: [0.2, 0.8],
				estim: []
			})
		)
	});
	await expect(page.getByText('Patterns added: 1')).toBeVisible();
	await expect(page.getByText('Imported one')).toBeVisible();

	await tab(page, 3);
	await page.getByRole('link', { name: /Your data/ }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export everything to a file' }).click()
	]);
	const file = await download.path();

	await page.getByRole('button', { name: 'Delete everything' }).click();
	await page.getByText('Yes, delete everything').click();
	await page.getByRole('button', { name: 'Delete now' }).click();
	await expect(page).toHaveURL(/\/en\/welcome\/$/);

	await onboardPreview(page);
	await tab(page, 3);
	await page.getByRole('link', { name: /Your data/ }).click();
	await page.locator('#data input[type=file]').setInputFiles(file);
	await expect(page.getByText('Imported 1 patterns and 0 history entries.')).toBeVisible();
	// The import did not take away the 18+ confirmation made here: the app carries on.
	await tab(page, 2);
	await expect(page).toHaveURL(/\/en\/saved\/$/);
	await expect(page.getByText('Imported one')).toBeVisible();
});

test('a lost connection is announced on every screen, with Reconnect', async ({ page }) => {
	await onboardPreview(page);
	await start(page, 'steady');
	await expect.poll(() => readout(page, 0), { timeout: 8000 }).toBeGreaterThan(0);
	// There is no button for this: the simulated ring's link is dropped by a test-only event.
	await page.evaluate(() => window.dispatchEvent(new Event('opentoys:simulate-loss')));
	const alert = page.getByRole('alert').filter({ hasText: 'Connection lost.' });
	await expect(alert).toBeVisible();
	await expect(alert).not.toContainText('may still be running'); // nothing real was running
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'lost');
	await tab(page, 0);
	await expect(alert).toBeVisible();
	await alert.getByRole('button', { name: 'Reconnect' }).click();
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'preview');
	await expect(alert).toBeHidden();
});

test('the built pages name Chrome and Edge only', async () => {
	// Every prerendered page and every script of the build (the messages of all three languages are in them).
	const build = join(process.cwd(), 'build');
	const files = (readdirSync(build, { recursive: true }) as string[]).filter((f) =>
		/\.(html|js|json)$/.test(f)
	);
	expect(files.length).toBeGreaterThan(30);
	const bad = files.filter((f) => /samsung|三星/i.test(readFileSync(join(build, f), 'utf8')));
	expect(bad).toEqual([]);
	// The supported browsers are named, in all three languages.
	const all = files.map((f) => readFileSync(join(build, f), 'utf8')).join('\n');
	expect(all).toContain('Use Chrome or Edge');
	expect(all).toContain('使用 Chrome 或 Edge');
});
