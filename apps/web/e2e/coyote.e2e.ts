import type { Page } from '@playwright/test';
import {
	coyoteFrames,
	coyoteState,
	installFakeBluetooth,
	isZeroFrame,
	lastLevels,
	levels,
	turnDial
} from './fake-bluetooth';
import {
	AGREE,
	channel,
	closeSheet,
	deviceSettings,
	deviceSwitch,
	expect,
	intensity,
	onboardBoth,
	onboardCoyote,
	onboardPreview,
	onboardPreviewOf,
	openCoyotePattern,
	openMore,
	row,
	setUpCoyote,
	setUpEstim,
	setVisibility,
	sheet,
	start,
	startCoyote,
	stepIntensity,
	stopButton,
	strip,
	tab,
	taps,
	test,
	toConnectStep
} from './fixtures';

// The DG-LAB Coyote 3.0, alone and next to the Dragon S1, against the GATT-level stand-in for Web Bluetooth
// (fake-bluetooth.ts): what the app writes to each device is checked frame by frame.

/** What was written after the last frame that carried any output: after a stop, only zero frames. */
async function sinceLastOutput(page: Page) {
	const all = await coyoteFrames(page);
	const last = all.findLastIndex((f) => f.a > 0 || f.b > 0 || f.strengthA > 0 || f.strengthB > 0);
	return all.slice(last + 1);
}

/** The frames that set an intensity on channel A (numbered SET frames), oldest first. */
const setsOnA = async (page: Page) => (await coyoteFrames(page)).filter((f) => f.typeA === 3);

test.describe('which devices do you have?', () => {
	test('the Coyote alone: its own safety notes, and no vibration anywhere', async ({ page }) => {
		await installFakeBluetooth(page);
		await toConnectStep(page, 'en', ['coyote']);
		await expect(
			page.getByText('For DG-LAB Coyote 3.0, choose the Bluetooth name starting with 47L121000.')
		).toBeVisible();
		await expect(page.getByText('YLS01')).toHaveCount(0);
		await page.getByRole('button', { name: 'Look around without a device' }).click();
		await expect(page).toHaveURL(/\/en\/$/);

		// Every screen, in a preview: nothing speaks of vibration, and there is no device switch.
		const noVibration = async () => {
			await expect(page.locator('body')).not.toContainText(/vibrat/i);
			await expect(page.locator('body')).not.toContainText(/the ring/i);
			await expect(deviceSwitch(page)).toHaveCount(0);
			await expect(page.locator('.strip .item')).toHaveCount(1);
		};
		await expect(page.getByRole('heading', { level: 1, name: 'Patterns' })).toBeVisible();
		await expect(page.locator('.list .row')).toHaveCount(12);
		// A device with a single section has no tab row.
		await expect(page.getByRole('tablist')).toHaveCount(0);
		await noVibration();
		await page.locator('a[href$="device=coyote-3&id=tide"]').click();
		await expect(page.getByRole('heading', { level: 1, name: 'Tide' })).toBeVisible();
		await expect(page.getByText('It starts at 0. Raise the intensity when you are ready.')).toBeVisible();
		await noVibration();
		await page.locator('.pinned .btn').click();
		await expect(page).toHaveURL(/\/control\/$/);
		await expect(stopButton(page)).toBeVisible();
		await expect(page.locator('.device h2')).toHaveText(['DG-LAB Coyote 3.0']);
		await expect(page.getByText("The light's threads show e-stim.")).toBeVisible();
		await noVibration();
		for (const i of [2, 3, 4] as const) {
			await tab(page, i);
			await expect(page.locator('main h1')).toBeVisible();
			await noVibration();
		}
		// About has the Coyote's notes, and only them.
		await expect(page.getByText('Never place pads on the chest, head or neck')).toBeVisible();
		await expect(page.getByText('Use e-stim below the waist only.')).toHaveCount(0);
		await expect(page.locator('#safety h3')).toHaveText(['DG-LAB Coyote 3.0']);
	});

	test('the ring alone: nothing of the Coyote, until it is added in Settings', async ({ page }) => {
		await onboardPreviewOf(page, ['ring']);
		await expect(deviceSwitch(page)).toHaveCount(0);
		await expect(page.getByRole('tab')).toHaveCount(4);
		await expect(page.locator('.legend')).toContainText('Vibration');
		for (const i of [0, 1, 2] as const) {
			await tab(page, i);
			await expect(page.locator('main')).not.toContainText(/channel a/i);
			await expect(page.locator('main')).not.toContainText(/coyote/i);
			await expect(page.locator('.strip .item')).toHaveCount(1);
		}
		await tab(page, 1);
		await expect(page.locator('.device h2')).toHaveText(['Bananasome Dragon S1']);
		// Settings → My devices is where the Coyote is added: it then appears everywhere, listed first.
		await tab(page, 3);
		await page.getByRole('link', { name: /My devices/ }).click();
		await page.locator('.mine input[type=checkbox]').nth(0).check();
		await expect(page.locator('.strip .item .name')).toHaveText([
			'DG-LAB Coyote 3.0',
			'Bananasome Dragon S1'
		]);
		await tab(page, 0);
		await expect(deviceSwitch(page)).toBeVisible();
	});

	test('both: the Coyote first everywhere, full names, a device switch on Patterns', async ({ page }) => {
		await onboardPreviewOf(page, ['ring', 'coyote']);
		await expect(page.locator('.strip .item .name')).toHaveText([
			'DG-LAB Coyote 3.0',
			'Bananasome Dragon S1'
		]);
		const sw = deviceSwitch(page);
		await expect(sw.getByRole('button')).toHaveText(['DG-LAB Coyote 3.0', 'Bananasome Dragon S1']);
		await expect(sw.getByRole('button', { name: 'DG-LAB Coyote 3.0' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.locator('a[href$="device=coyote-3&id=tide"]')).toBeVisible();
		await sw.getByRole('button', { name: 'Bananasome Dragon S1' }).click();
		await expect(page.locator('a[href$="?id=wave"]')).toBeVisible();
		await expect(page.locator('a[href$="device=coyote-3&id=tide"]')).toHaveCount(0);
		// Back from a pattern returns to the same device's list.
		await page.locator('a[href$="?id=wave"]').click();
		await page.locator('main .back').click();
		await expect(sw.getByRole('button', { name: 'Bananasome Dragon S1' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		// Control shows every output of both devices, with the same row anatomy.
		await tab(page, 1);
		await expect(page.locator('.device h2')).toHaveText(['DG-LAB Coyote 3.0', 'Bananasome Dragon S1']);
		await expect(page.locator('.row .name')).toHaveText(['Channel A', 'Channel B', 'Vibration', 'E-stim']);
		for (const output of ['a', 'b', 'vibration', 'estim'] as const)
			await expect(row(page, output).getByRole('button', { name: /^More/ })).toBeVisible();
		await tab(page, 3);
		await expect(page.locator('.hub a .title').first()).toHaveText('DG-LAB Coyote 3.0');
	});
});

test('first run with the Coyote: connect, set up in place, start on A, raise, burst, Stop', async ({
	page
}) => {
	await installFakeBluetooth(page);
	await toConnectStep(page, 'en', ['coyote']);
	await expect(
		page.getByText('opentoys is an independent, non-commercial project, unaffiliated with any device maker.')
	).toBeVisible();
	await page.getByRole('button', { name: 'Connect device' }).click();
	// The set-up opens where the Coyote was connected. Connecting leaves the device silent. Its own caps are
	// never 0 (they persist on the device and bound its wheels): until it is set up they are the general
	// limit, and the app's own lock is what holds.
	const setup = sheet(page);
	await expect(setup.getByRole('heading', { name: 'Set up DG-LAB Coyote 3.0' })).toBeVisible();
	expect((await coyoteFrames(page)).every((f) => f.a === 0 && f.b === 0)).toBe(true);
	expect((await coyoteState(page)).caps).toEqual([100, 100]);

	// One flow: the safety notes with a single agreement (and the own-risk line), then each channel raised
	// from 0 on the device.
	await expect(
		setup.getByText(
			'You are responsible for your safety and use opentoys entirely at your own risk. Its developers accept no liability.'
		)
	).toBeVisible();
	const next = setup.getByRole('button', { name: 'Next' });
	await expect(next).toBeDisabled();
	await setup.getByText(AGREE).click();
	await next.click();
	await setup.getByRole('button', { name: 'Start Channel A' }).click();
	await expect(setup.locator('.val')).toHaveText('0');
	await expect(setup.getByRole('button', { name: 'This is my maximum' })).toBeDisabled();
	// Press and hold raises it steadily. Single taps finish the job.
	const higher = setup.getByRole('button', { name: 'Higher' });
	await higher.hover();
	await page.mouse.down();
	await expect.poll(async () => Number(await setup.locator('.val').textContent())).toBeGreaterThanOrEqual(8);
	await page.mouse.up();
	const held = Number(await setup.locator('.val').textContent());
	expect(held).toBeLessThan(30);
	await taps(higher, 30 - held);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([30, 0]);
	expect((await coyoteState(page)).caps).toEqual([100, 100]);
	await setup.getByRole('button', { name: 'This is my maximum' }).click();
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	await setup.getByRole('button', { name: "I don't use Channel B" }).click();
	await expect(setup.getByText('Channel maximums: A 30 · B not used.')).toBeVisible();
	await setup.getByRole('button', { name: 'Enable device' }).click();
	await expect(setup).toHaveCount(0);
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(strip(page, 'coyote')).toContainText('Connected · Battery 76%');
	await expect.poll(async () => (await coyoteState(page)).caps).toEqual([30, 100]);

	// A pattern on channel A. Channel B has no maximum, so it can't be chosen.
	await openCoyotePattern(page, 'steady');
	await expect(page.locator('.seg input[value=b]')).toBeDisabled();
	await expect(page.locator('.seg input[value=both]')).toBeDisabled();
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect(stopButton(page)).toBeFocused();
	await expect(channel(page, 'a')).toContainText('Steady');
	await expect(channel(page, 'b').locator('.status')).toHaveText('Not used');
	await expect.poll(() => intensity(page, 'a')).toBe(0);
	const before = (await coyoteFrames(page)).length;
	await page.waitForTimeout(600);
	// It plays at intensity 0: nothing is set above 0 until the user raises it.
	expect((await coyoteFrames(page)).slice(before).every((f) => f.a === 0 && f.b === 0)).toBe(true);

	// + raises the intensity byte of the B0 frame, one step a press.
	await stepIntensity(page, 'a', 5);
	await expect.poll(() => intensity(page, 'a')).toBe(5);
	await expect.poll(async () => (await setsOnA(page)).at(-1)?.a).toBe(5);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([5, 0]);
	// The pattern's strength is in the frames (it fades in from the start).
	await expect.poll(async () => (await coyoteFrames(page)).at(-1)?.strengthA ?? 0).toBeGreaterThan(0);

	// The burst is under More: 10 above while held, back when let go.
	const more = await openMore(page, 'a');
	const burst = more.locator('.burst');
	await burst.hover();
	await page.mouse.down();
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(15);
	await page.mouse.up();
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(5);
	await closeSheet(page);

	// Never above the maximum, however long + is held. The burst stops there too.
	const plus = channel(page, 'a').getByRole('button', { name: 'Higher', exact: true });
	await plus.hover();
	await page.mouse.down();
	await expect(plus).toBeDisabled({ timeout: 10000 });
	await page.mouse.up();
	await expect.poll(() => intensity(page, 'a')).toBe(30);
	const again = await openMore(page, 'a');
	await again.locator('.burst').hover();
	await page.mouse.down();
	await page.waitForTimeout(400);
	await page.mouse.up();
	await closeSheet(page);
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(30);
	const frames = await coyoteFrames(page);
	expect(Math.max(...frames.map((f) => f.a))).toBe(30);
	expect(Math.max(...frames.map((f) => f.b))).toBe(0);

	// Stop: zero frames go out, the device is at 0 and so is the readout.
	await stopButton(page).click();
	await expect(stopButton(page)).toBeHidden();
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	await expect(channel(page, 'a')).toContainText('Nothing playing'); // the readout is gone with the pattern
	await expect(page.getByText('You stopped playback.')).toBeVisible();
	const after = await sinceLastOutput(page);
	expect(after.length).toBeGreaterThan(0);
	expect(after.every(isZeroFrame)).toBe(true);
	// Nothing follows the zero frames.
	const settled = (await coyoteFrames(page)).length;
	await page.waitForTimeout(1500);
	expect((await coyoteFrames(page)).slice(settled).every(isZeroFrame)).toBe(true);

	// It is in the history, under its pattern's name and its device's full name.
	await tab(page, 2);
	await expect(page.locator('.history li')).toHaveCount(1);
	await expect(page.locator('.history li')).toContainText('Steady');
	await expect(page.locator('.history li')).toContainText('DG-LAB Coyote 3.0');
	// Its page in Settings shows the device with its battery and firmware, and that it is enabled.
	await deviceSettings(page, 'coyote');
	await expect(page.locator('#connection').getByText('Connected. Battery 76%')).toBeVisible();
	await expect(page.locator('#connection').getByText('Firmware 7')).toBeVisible();
	await expect(page.locator('#setup').getByText('Enabled', { exact: true })).toBeVisible();
});

test('a locked Coyote says "Set up to start", and that opens the set-up in place', async ({ page }) => {
	await onboardCoyote(page, { setUp: false });
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'setup');
	await expect(strip(page, 'coyote')).toContainText('Set-up needed');
	await expect(page.getByText('Set up DG-LAB Coyote 3.0 to play these patterns.')).toBeVisible();
	// Its patterns can be looked at.
	await page.locator('a[href$="device=coyote-3&id=tide"]').click();
	await expect(page.getByRole('heading', { level: 1, name: 'Tide' })).toBeVisible();
	const startButton = page.locator('.pinned .btn');
	await expect(startButton).toHaveText('Set up to start');
	await startButton.click();
	await expect(sheet(page).getByRole('heading', { name: 'Set up DG-LAB Coyote 3.0' })).toBeVisible();
	await closeSheet(page);
	await expect(page).toHaveURL(/id=tide$/); // closed without setting up: nothing starts

	// Control shows its rows, locked the same way.
	await tab(page, 1);
	// The card says it once, with the one action. The rows don't repeat it, and they can't be stepped.
	const card = page.locator('.device[data-device=coyote-3]');
	await expect(card.getByRole('button', { name: 'Set up to start' })).toHaveCount(1);
	for (const ch of ['a', 'b'] as const) {
		await expect(channel(page, ch).getByRole('button', { name: 'Higher', exact: true })).toBeDisabled();
		await expect(channel(page, ch).locator('.val')).toHaveText('–');
		await expect(channel(page, ch).locator('.status')).toHaveText('');
	}
	// The device's wheel still works (its caps are not 0), but the app sends nothing to feel: no frame sets an
	// intensity above 0 or carries any strength.
	expect((await coyoteState(page)).caps).toEqual([100, 100]);
	await turnDial(page, 'a', 50);
	await page.waitForTimeout(800);
	const sent = await coyoteFrames(page);
	expect(sent.every((f) => f.a === 0 && f.b === 0 && f.strengthA === 0 && f.strengthB === 0)).toBe(true);

	// From the pattern again, this time through the set-up: afterwards the pattern is still there, ready.
	// Nothing starts by itself: Start is the user's to press, and it starts at 0.
	await openCoyotePattern(page, 'tide');
	await page.locator('.pinned .btn').click();
	await setUpCoyote(page);
	await expect(page).toHaveURL(/id=tide$/);
	await expect(page.locator('.pinned .btn')).toHaveText('Start');
	await page.waitForTimeout(1500); // the set-up's own stop has gone out
	const afterSetup = (await coyoteFrames(page)).length;
	await page.waitForTimeout(1500);
	expect((await coyoteFrames(page)).slice(afterSetup).every(isZeroFrame)).toBe(true);
	expect((await coyoteState(page)).intensity).toEqual([0, 0]);
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect(channel(page, 'a')).toContainText('Tide');
	await expect.poll(() => intensity(page, 'a')).toBe(0);
	await expect(stopButton(page)).toBeVisible();
	expect((await coyoteState(page)).intensity).toEqual([0, 0]);
	await stopButton(page).click();
});

test("connecting later, from a pattern's Start: connect, set up in place, and the pattern is ready", async ({
	page
}) => {
	// Looked around first, then came back another day with the device.
	await installFakeBluetooth(page);
	await onboardPreview(page, 'en', ['coyote']);
	await page.goto('/en/pattern/?device=coyote-3&id=knock');
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'idle');
	await page.locator('.seg').getByText('Channel B', { exact: true }).click();
	await page.locator('.pinned .btn').click();
	const connect = page.getByRole('dialog', { name: 'Connect a device, or look around without one' });
	await connect.getByRole('button', { name: 'Connect device' }).click();
	// Connected: its set-up opens over the same screen, the first time it connects.
	await expect(sheet(page).getByRole('heading', { name: 'Set up DG-LAB Coyote 3.0' })).toBeVisible();
	await expect(page).toHaveURL(/id=knock$/);
	await setUpCoyote(page, 20, 25);
	// Done: back on the pattern that was chosen, with the channel that was chosen. Start plays it, from 0.
	await expect(page).toHaveURL(/id=knock$/);
	await expect(page.locator('.seg input[value=b]')).toBeChecked();
	await page.locator('.pinned .btn').click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect(channel(page, 'b')).toContainText('Knock');
	await expect(channel(page, 'a')).toContainText('Nothing playing');
	await expect.poll(() => intensity(page, 'b')).toBe(0);
	await stepIntensity(page, 'b', 3);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 3]);
	await stopButton(page).click();
	// The same from the status strip, with nothing waiting: the set-up does not open again.
	await deviceSettings(page, 'coyote');
	await page.locator('#connection').getByRole('button', { name: 'Disconnect' }).click();
	await strip(page, 'coyote').click();
	await sheet(page).getByRole('button', { name: 'Connect device' }).click();
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'connected');
	await expect(sheet(page)).toHaveCount(0);
});

test('a Coyote in update mode is recognised and refused in plain words', async ({ page }) => {
	await installFakeBluetooth(page);
	await page.addInitScript(() => (window.__coyote.name = '47L121000_O3'));
	await toConnectStep(page, 'en', ['coyote']);
	await page.getByRole('button', { name: 'Connect device' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'DG-LAB Coyote 3.0 is in update mode. Switch it off and on, then reconnect.'
	);
	expect(await page.evaluate(() => window.__coyote.connects)).toBe(0);
});

test("a turn of the device's wheel shows in the readout, within the maximum", async ({ page }) => {
	await onboardCoyote(page);
	await startCoyote(page, 'steady');
	await stepIntensity(page, 'a', 8);
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(8);
	await page.waitForTimeout(600); // the app's own change has been acknowledged
	await turnDial(page, 'a', 21);
	await expect.poll(() => intensity(page, 'a')).toBe(21);
	const more = await openMore(page, 'a');
	await expect(more.getByText('Changed on the device to 21.')).toBeVisible();
	await closeSheet(page);
	// The device's own cap is the user's maximum: the wheel can't go above it.
	await turnDial(page, 'a', 120);
	await expect.poll(() => intensity(page, 'a')).toBe(30);
	expect((await coyoteState(page)).intensity[0]).toBe(30);
	// − from there.
	await stepIntensity(page, 'a', 1, 'Lower');
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(29);
});

test('leaving the page stops the Coyote, and it stays off until it is started again', async ({ page }) => {
	await onboardCoyote(page);
	await startCoyote(page, 'tide', 'Both channels');
	await stepIntensity(page, 'a', 10);
	await stepIntensity(page, 'b', 12);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([10, 12]);
	await setVisibility(page, 'hidden');
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	await setVisibility(page, 'visible');
	await expect(page.getByRole('alert')).toContainText(
		"Playback ended in opentoys when you left. It won't resume automatically."
	);
	await expect(stopButton(page)).toBeHidden();
	await page.waitForTimeout(1500);
	const after = await sinceLastOutput(page);
	expect(after.length).toBeGreaterThan(0);
	expect(after.every(isZeroFrame)).toBe(true);
	// Starting again is the user's call, and it starts at 0.
	await page.getByRole('button', { name: 'Start again' }).click();
	await expect(stopButton(page)).toBeVisible();
	await expect.poll(() => intensity(page, 'a')).toBe(0);
	await expect.poll(() => intensity(page, 'b')).toBe(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('both devices connected and playing: one Stop stops both', async ({ page }) => {
	await onboardBoth(page);
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'connected');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'connected');
	await start(page, 'wave');
	await expect.poll(async () => (await lastLevels(page)).vib).toBeGreaterThan(0);
	await startCoyote(page, 'knock');
	await stepIntensity(page, 'a', 9);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([9, 0]);

	// One card per device on Control, each with its full name, the Coyote first.
	await expect(page.locator('.device h2')).toHaveText(['DG-LAB Coyote 3.0', 'Bananasome Dragon S1']);
	await expect(row(page, 'vibration')).toContainText('Wave');
	await expect(row(page, 'a')).toContainText('Knock');
	// Both play at the same time.
	const ringBefore = (await levels(page)).length;
	const coyoteBefore = (await coyoteFrames(page)).length;
	await page.waitForTimeout(800);
	expect((await levels(page)).length).toBeGreaterThan(ringBefore);
	expect((await coyoteFrames(page)).length).toBeGreaterThan(coyoteBefore);
	// The bar on other screens names both, with the one Stop.
	await tab(page, 2);
	await expect(page.locator('.nowbar')).toContainText('Wave');
	await expect(page.locator('.nowbar')).toContainText('Knock');
	await expect(page.locator('.nowbar')).toContainText('A 9 · B 0');

	await page.locator('.nowbar .stop-mini').click();
	await expect(page.locator('.nowbar')).toBeHidden();
	// The ring: a zero frame, then its stop command. The Coyote: zero frames, and it reports 0.
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(0);
	await expect
		.poll(async () => (await page.evaluate(() => window.__ble.frames)).at(-1))
		.toEqual([0x56, 0x05, 0x01, 0x01, 0x01, 0x5e]);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	await page.waitForTimeout(1200);
	const after = await sinceLastOutput(page);
	expect(after.length).toBeGreaterThan(0);
	expect(after.every(isZeroFrame)).toBe(true);
	// Both are in the history, each under its device's full name.
	await expect(page.locator('.history li')).toHaveCount(2);
	await expect(page.locator('.history')).toContainText('Bananasome Dragon S1');
	await expect(page.locator('.history')).toContainText('DG-LAB Coyote 3.0');

	// Esc does the same from any screen.
	await start(page, 'wave');
	await startCoyote(page, 'knock');
	await stepIntensity(page, 'a', 4);
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(4);
	await page.keyboard.press('Escape');
	await expect(stopButton(page)).toBeHidden();
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(0);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	// After a stop each device can be started again by itself, named in full.
	await expect(page.getByRole('button', { name: 'Start DG-LAB Coyote 3.0 again' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start Bananasome Dragon S1 again' })).toBeVisible();
});

test('leaving the page with both: the ring keeps vibrating, its e-stim and the Coyote stop', async ({
	page
}) => {
	await onboardBoth(page);
	await setUpEstim(page);
	await start(page, 'tingle-bed');
	await expect.poll(async () => (await lastLevels(page)).estim, { timeout: 15000 }).toBeGreaterThan(0);
	await startCoyote(page, 'steady', 'Both channels');
	await stepIntensity(page, 'a', 7);
	await stepIntensity(page, 'b', 11);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([7, 11]);

	await setVisibility(page, 'hidden');
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([0, 0]);
	await expect.poll(async () => (await lastLevels(page)).estim).toBe(0);
	await setVisibility(page, 'visible');
	// Vibration goes on, and nothing of the other two comes back by itself.
	const mark = (await levels(page)).length;
	const coyoteMark = (await coyoteFrames(page)).length;
	await page.waitForTimeout(2500);
	const since = (await levels(page)).slice(mark);
	expect(since.some((f) => f.vib > 0)).toBe(true);
	expect(since.every((f) => f.estim === 0)).toBe(true);
	expect((await coyoteFrames(page)).slice(coyoteMark).every((f) => f.a === 0 && f.b === 0)).toBe(true);
	// Each device says what happened to it.
	await expect(page.getByText('opentoys paused e-stim when you left and kept vibration on.')).toBeVisible();
	await expect(
		page.getByText("Playback ended in opentoys when you left. It won't resume automatically.")
	).toBeVisible();
	await expect(stopButton(page)).toBeVisible();
});

test('one device loses its connection while the other keeps playing', async ({ page }) => {
	await onboardBoth(page);
	await start(page, 'wave');
	await startCoyote(page, 'knock');
	await stepIntensity(page, 'a', 6);
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(6);

	await page.evaluate(() => window.__coyote.drop());
	const alert = page.locator('div.lost[role=alert]');
	await expect(alert).toHaveCount(1);
	await expect(alert).toContainText('DG-LAB Coyote 3.0');
	await expect(alert).toContainText(
		'If output continues after connection loss, switch off the device itself.'
	);
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'lost');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'connected');
	// The ring plays on, and Stop is still there for it.
	const mark = (await levels(page)).length;
	await page.waitForTimeout(1000);
	expect((await levels(page)).slice(mark).some((f) => f.vib > 0)).toBe(true);
	await expect(stopButton(page)).toBeVisible();
	// Reconnecting is the user's call, without the chooser, and nothing restarts by itself.
	await alert.getByRole('button', { name: 'Reconnect' }).click();
	await expect(alert).toHaveCount(0);
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'connected');
	await page.waitForTimeout(800);
	expect((await coyoteState(page)).intensity).toEqual([0, 0]);

	// The other way round: the ring drops, the Coyote plays on.
	await startCoyote(page, 'knock');
	await stepIntensity(page, 'a', 6);
	await expect.poll(async () => (await coyoteState(page)).intensity[0]).toBe(6);
	await page.evaluate(() => window.__ble.drop());
	await expect(alert).toContainText('Bananasome Dragon S1');
	await expect(alert).toContainText('The device may still be running. Switch it off directly.');
	const coyoteMark = (await coyoteFrames(page)).length;
	await page.waitForTimeout(800);
	expect((await coyoteFrames(page)).length).toBeGreaterThan(coyoteMark);
	expect((await coyoteState(page)).intensity[0]).toBe(6);
});

test('a preview of the Coyote plays on screen without the set-up, and stays out of the history', async ({
	page
}) => {
	await installFakeBluetooth(page);
	await onboardPreviewOf(page, ['coyote']);
	await expect(strip(page, 'coyote')).toContainText('Preview');
	await startCoyote(page, 'slow-breath', 'Both channels');
	await expect(page.getByText('Devices marked Preview play on screen only.')).toHaveCount(1);
	await stepIntensity(page, 'a', 12);
	await stepIntensity(page, 'b', 3);
	await expect.poll(() => intensity(page, 'a')).toBe(12);
	await expect.poll(() => intensity(page, 'b')).toBe(3);
	// Channel B off alone, under More: A plays on.
	const more = await openMore(page, 'b');
	await more.getByRole('button', { name: 'Turn Channel B off' }).click();
	await closeSheet(page);
	await expect(channel(page, 'b')).toContainText('Nothing playing');
	await expect(stopButton(page)).toBeVisible();
	await expect.poll(() => intensity(page, 'a')).toBe(12);
	// Another pattern for B, straight from its row.
	await channel(page, 'b').getByRole('button', { name: 'Choose a pattern' }).click();
	await sheet(page).getByLabel('Pattern').selectOption('knock');
	// Random pauses and slow increase are there too, each with its explanation.
	await expect(sheet(page).getByRole('switch', { name: 'Random pauses' })).toBeEnabled();
	await expect(sheet(page).getByRole('switch', { name: 'Slow increase' })).toBeEnabled();
	await closeSheet(page);
	await expect(channel(page, 'b')).toContainText('Knock');
	await stepIntensity(page, 'b', 2);
	await expect.poll(() => intensity(page, 'b')).toBe(2);
	await stopButton(page).click();
	await expect(stopButton(page)).toBeHidden();
	await expect(channel(page, 'a')).toContainText('Nothing playing');
	await expect(channel(page, 'b')).toContainText('Nothing playing');
	// Nothing was written to a device, and nothing is in the history.
	expect(await page.evaluate(() => window.__coyote.writes.length)).toBe(0);
	await tab(page, 2);
	await expect(page.getByText("You haven't played anything on a device yet.")).toBeVisible();
	// A favourite is kept: first in its list, and listed under Saved.
	await openCoyotePattern(page, 'tide');
	await page.getByRole('button', { name: 'Add Tide to favourites' }).click();
	await page.locator('main .back').click();
	await expect(page.locator('.list .row .name').first()).toHaveText('Tide');
	await tab(page, 2);
	await expect(page.getByRole('heading', { name: 'Favourites (DG-LAB Coyote 3.0)' })).toBeVisible();
	await expect(page.locator('a[href$="device=coyote-3&id=tide"]')).toBeVisible();
	// The set-up needs the device.
	await deviceSettings(page, 'coyote');
	await expect(page.locator('#setup').getByRole('button', { name: 'Set up', exact: true })).toBeDisabled();
});

test('both devices playing: every row is on screen above Stop on a phone, and one Stop stops both', async ({
	page
}) => {
	await onboardPreviewOf(page, ['ring', 'coyote']);
	await tab(page, 1);
	await expect(page.locator('.row')).toHaveCount(4);
	await start(page, 'tingle-bed');
	await startCoyote(page, 'tide', 'Both channels');
	await stepIntensity(page, 'a', 5);
	await expect(page.locator('.device')).toHaveCount(2);
	await expect.poll(() => intensity(page, 'a')).toBe(5);
	await expect(row(page, 'vibration').locator('.live')).not.toHaveText('now 0%');
	// On a phone, at both sizes: without scrolling, the last row of the last card ends above the Stop bar, and
	// every row's controls are fully in view.
	const fits = async (size: { width: number; height: number }, higher: string, more: RegExp) => {
		await page.setViewportSize(size);
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(page.locator('.tabbar')).toBeVisible();
		const at = `${size.width}×${size.height} (${higher})`;
		const bar = (await page.locator('.stopbar').boundingBox())!;
		const last = (await page.locator('.device').last().locator('.row').last().boundingBox())!;
		expect(last.y + last.height, `last row above Stop at ${at}`).toBeLessThanOrEqual(bar.y);
		for (const output of ['a', 'b', 'vibration', 'estim'] as const) {
			await expect(row(page, output).getByRole('button', { name: higher, exact: true })).toBeInViewport({
				ratio: 1
			});
			await expect(row(page, output).getByRole('button', { name: more })).toBeInViewport({ ratio: 1 });
		}
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
		// Stop keeps its description for assistive technology, without the long line under it.
		await expect(page.locator('.stopbar .stop')).toHaveAttribute('aria-describedby', 'stop-hint');
	};
	await fits({ width: 412, height: 915 }, 'Higher', /^More/);
	await fits({ width: 360, height: 740 }, 'Higher', /^More/);
	// The same in Traditional Chinese on the small phone. (The language changes in place: it all plays on.)
	await page.getByRole('button', { name: 'Language' }).click();
	await page.getByRole('link', { name: '繁體中文' }).click();
	await expect(page).toHaveURL(/\/zh-hant\/control\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
	await expect(page.locator('.row .live')).not.toHaveCount(0);
	await fits({ width: 360, height: 740 }, '提高', /更多/);
	await page.getByRole('button', { name: '語言' }).click();
	await page.getByRole('link', { name: 'English' }).click();
	await expect(page).toHaveURL(/\/en\/control\/$/);
	// On a wide screen the cards sit side by side.
	await page.setViewportSize({ width: 1280, height: 720 });
	const [a, b] = await Promise.all(
		(await page.locator('.device').all()).map(async (d) => (await d.boundingBox())!)
	);
	expect(Math.abs(a.y - b.y)).toBeLessThan(2);
	await stopButton(page).click();
	await expect(stopButton(page)).toBeHidden();
	await expect(row(page, 'a')).toContainText('Nothing playing');
	await expect(row(page, 'vibration')).toContainText('Nothing playing');
	await expect(row(page, 'vibration').locator('.live')).toHaveCount(0);
});

test("the Coyote's maximum: lowered in Limits, raised only by setting up again, and a file never enables it", async ({
	page
}) => {
	await onboardCoyote(page);
	expect((await coyoteState(page)).caps).toEqual([30, 40]);
	await deviceSettings(page, 'coyote');
	const limits = page.locator('#limits');
	const maxA = limits.getByLabel('Maximum on Channel A');
	// The slider ends at the maximum that was set up: it can only go down.
	await expect(maxA).toHaveAttribute('max', '30');
	await expect(
		limits.getByText(
			"DG-LAB Coyote 3.0 retains each enabled channel's maximum for its wheel too, until an app changes it."
		)
	).toBeVisible();
	await maxA.fill('20');
	await maxA.dispatchEvent('change');
	await expect(maxA).toHaveAttribute('max', '20');
	await expect.poll(async () => (await coyoteState(page)).caps).toEqual([20, 40]);

	// Allowing more than 100 raises no maximum by itself: it is what the set-up may go up to.
	await limits.getByRole('button', { name: 'Allow a maximum above 100' }).click();
	const confirm = limits.getByRole('button', { name: 'Allow above 100' });
	await expect(confirm).toBeDisabled();
	await limits.getByText('I accept the risks of a maximum above 100.').click();
	await confirm.click();
	await expect(limits.getByText('A maximum above 100 is allowed.')).toBeVisible();
	await expect(maxA).toHaveAttribute('max', '20');
	await page.waitForTimeout(300);
	expect((await coyoteState(page)).caps).toEqual([20, 40]);

	// Raising goes through the set-up again, from 0, where it is felt. The notes were agreed to already.
	await page.getByRole('button', { name: 'Set up again' }).click();
	const setup = page.locator('.setup');
	await expect(setup.getByText('no higher than 200')).toBeVisible();
	await setup.getByRole('button', { name: 'Start Channel A' }).click();
	await expect(setup.locator('.val')).toHaveText('0');
	await expect.poll(async () => (await coyoteState(page)).caps).toEqual([200, 40]);
	const higher = setup.getByRole('button', { name: 'Higher' });
	await taps(higher, 26);
	await expect.poll(async () => (await coyoteState(page)).intensity).toEqual([26, 0]);
	await setup.getByRole('button', { name: 'This is my maximum' }).click();
	await setup.getByRole('button', { name: "I don't use Channel B" }).click();
	await setup.getByRole('button', { name: 'Enable device' }).click();
	await expect(maxA).toHaveAttribute('max', '26');
	// Channel B is not used now: on the device it has the general limit, never 0.
	await expect.poll(async () => (await coyoteState(page)).caps).toEqual([26, 200]);

	// Export, then import the same file: the Coyote is not enabled any more, its safety notes are not agreed
	// to, and the limit is back at 100.
	await tab(page, 3);
	await page.getByRole('link', { name: /Your data/ }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export everything to a file' }).click();
	const path = await (await download).path();
	await page.locator('#data input[type=file]').setInputFiles(path);
	await expect(page.getByText('Imported 0 patterns and 0 history entries.')).toBeVisible();
	await expect(strip(page, 'coyote')).toHaveAttribute('data-state', 'setup');
	await expect.poll(async () => (await coyoteState(page)).caps).toEqual([100, 100]);
	await deviceSettings(page, 'coyote');
	await expect(page.locator('#setup').getByText('Disabled', { exact: true })).toBeVisible();
	await expect(limits.getByRole('button', { name: 'Allow a maximum above 100' })).toBeVisible();
	// Setting it up again starts with the safety notes.
	await page.getByRole('button', { name: 'Set up', exact: true }).click();
	await expect(sheet(page).getByText(AGREE)).toBeVisible();
});
