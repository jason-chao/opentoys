import type { Page } from '@playwright/test';
import { frames, installFakeBluetooth, lastLevels, levels, STOP_FRAME, ZERO_FRAME } from './fake-bluetooth';
import {
	AGREE,
	chooseDevices,
	closeSheet,
	deviceSettings,
	expect,
	onboardDevice,
	openMore,
	openPattern,
	readout,
	ringSetupEstim,
	ringSetupSkipLevels,
	row,
	setUpEstim,
	setVisibility,
	sheet,
	start,
	stopButton,
	strip,
	tab,
	taps,
	test,
	toConnectStep
} from './fixtures';

// The real connect path, against a stand-in for Web Bluetooth at GATT level (fake-bluetooth.ts): what the app
// writes to the ring is checked frame by frame.

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What was written after the last levels frame that had any output: must be the stop sequence. */
async function afterLastOutput(page: Page): Promise<number[][]> {
	const all = await frames(page);
	const last = all.findLastIndex((f) => f[1] === 0x02 && f.length === 9 && (f[3] > 0 || f[7] > 0));
	return all.slice(last + 1);
}

test('first run with a device: connect, then its set-up opens in place with the vibration levels', async ({
	page
}) => {
	await installFakeBluetooth(page);
	await page.goto('/en/');
	await chooseDevices(page, ['ring']);
	await page.getByText('I am 18 or over.').click();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText('For Bananasome Dragon S1, choose YLS01 in the Bluetooth list.')).toBeVisible();
	await expect(page.getByText('The device briefly vibrates on every connection.')).toBeVisible();
	await expect(
		page.getByText('opentoys is an independent, non-commercial project, unaffiliated with any device maker.')
	).toBeVisible();
	await page.getByRole('button', { name: 'Connect device' }).click();

	// The handshake: the ring is silent until written to; the app asks (01) and then silences it.
	const setup = sheet(page);
	await expect(setup.getByRole('heading', { name: 'Set up Bananasome Dragon S1' })).toBeVisible();
	const hello = await frames(page);
	expect(hello[0]).toEqual([0x01]);
	expect(hello.some((f) => same(f, STOP_FRAME))).toBe(true);

	// One flow: the safety notes with a single agreement (and the own-risk line), then the levels.
	await expect(
		setup.getByText(
			'You are responsible for your safety and use opentoys entirely at your own risk. Its developers accept no liability.'
		)
	).toBeVisible();
	const next = setup.getByRole('button', { name: 'Next' });
	await expect(next).toBeDisabled();
	await setup.getByText(AGREE).click();
	await next.click();
	await setup.getByRole('button', { name: 'Start', exact: true }).click();
	const higher = setup.getByRole('button', { name: 'Higher' });
	await taps(higher, 8);
	await setup.getByRole('button', { name: 'I can feel it now' }).click();
	await expect(setup.getByText('Lowest felt: 8%. Raise to a comfortable maximum, up to 100%.')).toBeVisible();
	await taps(higher, 30);
	// 38 % on the wire: trunc(0.38 × 255) = 96, once the warm-up has faded in.
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBe(96);
	expect((await levels(page)).every((f) => f.estim === 0)).toBe(true);
	await setup.getByRole('button', { name: 'This is my maximum' }).click();
	const end = await afterLastOutput(page);
	expect(end[0]).toEqual(ZERO_FRAME);
	expect(end[1]).toEqual(STOP_FRAME);
	// "Also set up e-stim?" is part of the same flow, and can wait.
	await expect(setup.getByRole('heading', { name: 'Also set up e-stim?' })).toBeVisible();
	await setup.getByRole('button', { name: 'Not now' }).click();
	await expect(setup.getByText('Vibration calibrated from 8% (lowest felt) to 38% (maximum).')).toBeVisible();
	await expect(setup.getByText('E-stim is disabled.')).toBeVisible();
	await setup.getByRole('button', { name: 'Done' }).click();
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(strip(page, 'ring')).toContainText('Bananasome Dragon S1');
	await expect(strip(page, 'ring')).toContainText('Connected · Battery 87%');

	// The strip leads to the ring's page in Settings: everything about it, once.
	await strip(page, 'ring').click();
	await expect(page).toHaveURL(/\/settings\/device\/\?id=dragon-s1$/);
	await expect(page.getByText('Vibration calibrated from 8% (lowest felt) to 38% (maximum).')).toBeVisible();
	const connection = page.locator('#connection');
	await expect(connection.getByText('Connected. Battery 87%')).toBeVisible();
	await connection.getByRole('button', { name: 'Disconnect' }).click();
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'idle');
	await expect(strip(page, 'ring')).toContainText('Connect');
	expect(await page.evaluate(() => window.__ble.connected)).toBe(false);
});

test("the ring's vibration levels can be skipped, its safety agreement cannot", async ({ page }) => {
	await installFakeBluetooth(page);
	await toConnectStep(page, 'en', ['ring']);
	await page.locator('.welcome .connect .btn.primary').click();
	await expect(sheet(page)).toBeVisible();
	// Closing the set-up without agreeing: the ring is connected, and locked.
	await closeSheet(page);
	await expect(page).toHaveURL(/\/en\/$/);
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'setup');
	await expect(strip(page, 'ring')).toContainText('Set-up needed');

	// Start says so, and opens the set-up in place. Nothing was sent meanwhile.
	await openPattern(page, 'steady');
	const startButton = page.locator('.pinned .btn');
	await expect(startButton).toHaveText('Set up to start');
	await startButton.click();
	await expect(sheet(page).getByRole('heading', { name: 'Set up Bananasome Dragon S1' })).toBeVisible();
	expect((await levels(page)).every((f) => f.vib === 0 && f.estim === 0)).toBe(true);

	// Agree, skip the levels: back on the pattern that was chosen, which is ready. Nothing starts by itself.
	await ringSetupSkipLevels(page);
	await expect(page).toHaveURL(/\/pattern\/\?id=steady$/);
	await expect(startButton).toHaveText('Start');
	await page.waitForTimeout(800);
	expect((await levels(page)).every((f) => f.vib === 0 && f.estim === 0)).toBe(true);
	// Start is the user's to press, and it plays on the default levels.
	await startButton.click();
	await expect(page).toHaveURL(/\/control\/$/);
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	await expect(row(page, 'vibration')).toContainText('Steady');
	await stopButton(page).click();
	// It is not offered again by itself, and More on the vibration row offers the levels later.
	const more = await openMore(page, 'vibration');
	await expect(more.getByRole('button', { name: 'Set vibration levels' })).toBeVisible();
	await closeSheet(page);
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'connected');
});

test('closing the chooser is not an error, and a preview carries on', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'bluetooth', {
			value: {
				getAvailability: async () => true,
				requestDevice: async () => {
					throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
				}
			}
		});
	});
	await toConnectStep(page, 'en', ['ring']);
	await page.getByRole('button', { name: 'Connect device' }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(sheet(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'Look around without a device' }).click();
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'preview');
	// The strip offers to connect for real. Closing the chooser again changes nothing.
	await strip(page, 'ring').click();
	await sheet(page).getByRole('button', { name: 'Connect device' }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await closeSheet(page);
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'preview');
});

test('the session limit follows the clock, pauses included, and ends with the stop sequence', async ({
	page
}) => {
	await onboardDevice(page);
	await start(page, 'slow-pulse'); // off half the time: the limit must not run at half speed
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	await expect(page.getByText('Session limit: 1 hr')).toBeVisible();
	// One hour later, by the clock.
	await page.evaluate(() => {
		const now = Date.now.bind(Date);
		Date.now = () => now() + 3_600_000;
	});
	await expect(page.getByText('Session limit reached. Playback ended in opentoys.')).toBeVisible();
	await expect.poll(async () => (await afterLastOutput(page)).some((f) => same(f, STOP_FRAME))).toBe(true);
	const end = await afterLastOutput(page);
	// A zero frame, then the stop command. (When the limit falls in the pulse's off half, the pattern's own
	// zero frame comes before the stop's.)
	const stopAt = end.findIndex((f) => same(f, STOP_FRAME));
	expect(end[0]).toEqual(ZERO_FRAME);
	expect(end[stopAt - 1]).toEqual(ZERO_FRAME);
	expect(end.slice(0, stopAt).every((f) => same(f, ZERO_FRAME) || f[1] !== 0x02)).toBe(true);
	expect(end.every((f) => same(f, ZERO_FRAME) || same(f, STOP_FRAME) || f[1] !== 0x02)).toBe(true);
});

test('Stop writes a zero frame, then the stop command, and the session is in History', async ({ page }) => {
	await onboardDevice(page);
	await start(page, 'steady');
	await expect(stopButton(page)).toBeFocused();
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	await expect.poll(() => readout(page, 0)).toBeGreaterThan(0);
	await expect(page.getByText('Devices marked Preview play on screen only.')).toHaveCount(0);
	await page.waitForTimeout(5500);
	await stopButton(page).click();
	await expect(page.getByText('You stopped playback.')).toBeVisible();
	await expect.poll(async () => (await afterLastOutput(page)).length).toBeGreaterThanOrEqual(2);
	const end = await afterLastOutput(page);
	expect(end[0]).toEqual(ZERO_FRAME);
	expect(end[1]).toEqual(STOP_FRAME);
	// Nothing but stop sequences (and battery polls) after that.
	expect(end.every((f) => same(f, ZERO_FRAME) || same(f, STOP_FRAME) || f[1] !== 0x02)).toBe(true);
	await expect(page.getByRole('dialog')).toHaveCount(0);

	// Esc stops too.
	await page.getByRole('button', { name: 'Start again' }).click();
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	await page.keyboard.press('Escape');
	await expect(stopButton(page)).toBeHidden();
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(0);

	await tab(page, 2);
	const history = page.locator('.history li');
	await expect(history).toHaveCount(2);
	await expect(history.first()).toContainText('Steady');
	await expect(history.first()).toContainText('Bananasome Dragon S1'); // the device, in full
	await expect(history.first()).toContainText('You stopped playback.');
});

test('the rows on Control: − and + change the intensity in steps of 5 %, and hold repeats', async ({
	page
}) => {
	await onboardDevice(page);
	await start(page, 'steady');
	const vib = row(page, 'vibration');
	await expect(vib.locator('.val')).toHaveText('80%');
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBe(209); // 80 % of the way from the lowest level felt (10 %) to the maximum
	await vib.getByRole('button', { name: 'Lower' }).click();
	await vib.getByRole('button', { name: 'Lower' }).click();
	await expect(vib.locator('.val')).toHaveText('70%');
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(186);
	// Press and hold +: it keeps going, and stops at 100 %.
	await vib.getByRole('button', { name: 'Higher' }).hover();
	await page.mouse.down();
	await expect(vib.locator('.val')).toHaveText('100%', { timeout: 8000 });
	await page.mouse.up();
	await expect(vib.getByRole('button', { name: 'Higher' })).toBeDisabled();
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(255);
	await stopButton(page).click();
	await expect.poll(async () => (await lastLevels(page)).vib).toBe(0);
});

test('e-stim: locked until set up on the device, then enabled; the maximum goes above 80 % only after confirming', async ({
	page
}) => {
	await onboardDevice(page);
	// Locked: a combined pattern sends vibration only.
	await start(page, 'tingle-bed');
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	await page.waitForTimeout(1000);
	expect((await levels(page)).every((f) => f.estim === 0)).toBe(true);
	const estim = row(page, 'estim');
	await expect(estim).toContainText('Disabled');
	// Free control has it disabled too.
	await page.getByRole('button', { name: 'Free control' }).click();
	await expect(sheet(page).getByRole('slider', { name: 'E-stim' })).toBeDisabled();
	await closeSheet(page);
	await stopButton(page).click();

	// "Set up to start" on the row opens the set-up in place, at its safety notes. E-stim goes out while its
	// levels are found, rising slowly.
	await estim.getByRole('button', { name: 'Set up to start' }).click();
	await expect(
		sheet(page).getByText(
			'Do not use e-stim with a pacemaker, other implanted device, heart condition or epilepsy.'
		)
	).toBeVisible();
	await ringSetupEstim(page);
	const seen = (await levels(page)).map((f) => f.estim);
	expect(Math.max(...seen)).toBeGreaterThan(0);
	expect(Math.max(...seen)).toBeLessThanOrEqual(Math.trunc(0.24 * 255));
	await expect(estim).not.toContainText('Disabled');
	await deviceSettings(page, 'ring');
	await expect(page.getByText('E-stim is enabled.')).toBeVisible();
	await expect(page.getByText('Its range is 4% to 24%.')).toBeVisible();

	// The maximum: 80 % unless the confirmation is given.
	const limits = page.locator('#limits');
	const cap = limits.getByRole('slider', { name: 'Highest e-stim' });
	await expect(cap).toHaveAttribute('max', '0.8');
	await limits.getByRole('button', { name: 'Allow e-stim above 80 %' }).click();
	const confirm = limits.getByRole('button', { name: 'Allow above 80 %' });
	await expect(confirm).toBeDisabled();
	await expect(limits.getByText('Above 80 %, e-stim is much stronger.')).toBeVisible();
	await limits.getByText('I accept the risks of e-stim above 80 %.').click();
	await confirm.click();
	await expect(limits.getByText('E-stim above 80 % is allowed.')).toBeVisible();
	await expect(cap).toHaveAttribute('max', '1');
	await cap.fill('0.95');
	await expect(limits.locator('.field').filter({ hasText: 'Highest e-stim' }).locator('.out')).toHaveText(
		'95%'
	);
	// Kept across a visit; and it can be switched back.
	await page.reload();
	await expect(cap).toHaveValue('0.95');
	await limits.getByRole('button', { name: 'Restore 80 % limit' }).click();
	await expect(cap).toHaveAttribute('max', '0.8');
	await expect(cap).toHaveValue('0.8');
});

test('leaving the page: e-stim goes to 0 at once and vibration keeps its level; or everything stops', async ({
	page
}) => {
	await onboardDevice(page);
	await setUpEstim(page);
	await start(page, 'split-pulse'); // steady e-stim with vibration pulses on top
	await expect.poll(async () => (await lastLevels(page)).estim, { timeout: 10000 }).toBeGreaterThan(0);
	await expect.poll(() => readout(page, 1)).toBeGreaterThan(0);

	// In one step inside the page (nothing else can be written in between): note the last frame, hide the
	// page, and collect what is written next.
	const { last, after } = await page.evaluate(async () => {
		const sent = () =>
			window.__ble.frames
				.filter((f) => f[1] === 0x02 && f.length === 9)
				.map((f) => ({ vib: f[3], estim: f[7] }));
		const before = sent();
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		document.dispatchEvent(new Event('visibilitychange'));
		await new Promise((r) => setTimeout(r, 1200));
		return { last: before[before.length - 1], after: sent().slice(before.length) };
	});
	expect(last.estim).toBeGreaterThan(0);
	// The very next frame: e-stim byte 0, vibration byte as it was.
	expect(after[0]).toEqual({ vib: last.vib, estim: 0 });
	// And it stays that way: e-stim off, vibration still running.
	expect(after.every((f) => f.estim === 0)).toBe(true);
	expect(after.some((f) => f.vib > 0)).toBe(true);

	await setVisibility(page, 'visible');
	// Said once, with its action: the e-stim row only shows that it is off.
	const held = page.getByRole('alert').filter({
		hasText: 'opentoys paused e-stim when you left and kept vibration on.'
	});
	await expect(held).toHaveCount(1);
	await expect(row(page, 'estim').locator('.status')).toHaveText('Off');
	await expect(page.getByRole('button', { name: 'Turn e-stim back on' })).toHaveCount(1);
	await held.getByRole('button', { name: 'Turn e-stim back on' }).click();
	await expect.poll(async () => (await lastLevels(page)).estim, { timeout: 10000 }).toBeGreaterThan(0);
	await stopButton(page).click();

	// With "Stop everything": a full stop.
	await deviceSettings(page, 'ring');
	await page.getByText('Stop vibration and e-stim', { exact: true }).click();
	await start(page, 'split-pulse');
	await expect.poll(async () => (await lastLevels(page)).estim, { timeout: 10000 }).toBeGreaterThan(0);
	await setVisibility(page, 'hidden');
	const end = await afterLastOutput(page);
	expect(end[0]).toEqual(ZERO_FRAME);
	expect(end[1]).toEqual(STOP_FRAME);
	await setVisibility(page, 'visible');
	await expect(stopButton(page)).toBeHidden();
	await expect(page.getByText('Leaving the page ended playback in opentoys.')).toBeVisible();
	expect(await readout(page, 0)).toBe(0);
});

test('a lost link says the ring may still be running, and reconnects without the chooser', async ({
	page
}) => {
	await onboardDevice(page);
	await start(page, 'steady');
	await expect.poll(async () => (await lastLevels(page)).vib, { timeout: 8000 }).toBeGreaterThan(0);
	// The test-only event is for the preview: it does nothing to a real connection.
	await page.evaluate(() => window.dispatchEvent(new Event('opentoys:simulate-loss')));
	await page.waitForTimeout(300);
	await expect(page.getByRole('alert')).toHaveCount(0);

	await page.evaluate(() => window.__ble.drop());
	const alert = page.getByRole('alert').filter({ hasText: 'Connection lost.' });
	await expect(alert).toContainText('Bananasome Dragon S1');
	await expect(alert).toContainText('The device may still be running. Switch it off directly.');
	await expect(strip(page, 'ring')).toHaveAttribute('data-state', 'lost');
	await expect(stopButton(page)).toBeHidden();
	await deviceSettings(page, 'ring');
	await expect(alert).toBeVisible();
	// One warning with the advice and Reconnect: the device's own page only says the state.
	await expect(page.locator('#connection')).toContainText('Connection lost');
	await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(1);
	await expect(page.getByText('The device may still be running. Switch it off directly.')).toHaveCount(1);
	const connects = await page.evaluate(() => window.__ble.connects);
	await alert.getByRole('button', { name: 'Reconnect' }).click();
	await expect(strip(page, 'ring')).toContainText('Connected · Battery 87%');
	await expect(alert).toBeHidden();
	expect(await page.evaluate(() => window.__ble.connects)).toBe(connects + 1);
	// Reconnecting does not open the set-up again: it was agreed to, and offered.
	await expect(sheet(page)).toHaveCount(0);
});
