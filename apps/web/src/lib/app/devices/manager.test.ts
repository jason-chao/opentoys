import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeSettings, type Settings } from '../settings';
import type { SessionEnd } from './types';
import { DeviceManager } from './manager.svelte';
import { Registry } from './registry';
import { fakeKind, type FakeSession } from './testing';

// Two made-up devices, each with its own session, under one manager.
function setup(over: Partial<Settings> = {}) {
	const a = fakeKind('a', { patterns: ['one'] });
	const b = fakeKind('b', { patterns: ['two'] });
	const registry = new Registry([a.kind, b.kind]);
	let settings: Settings = { ...sanitizeSettings({ devices: ['a', 'b'] }, registry), ...over };
	const logged: SessionEnd[] = [];
	const saved: [string, Record<string, unknown>][] = [];
	const devices = new DeviceManager(registry, {
		settings: () => settings,
		saveDeviceSettings: (key, patch) => saved.push([key, patch]),
		addDevice: (id) => {
			if (!settings.devices.includes(id)) settings = { ...settings, devices: [...settings.devices, id] };
		},
		logged: (end) => logged.push(end)
	});
	const [sa, sb] = devices.sessions as unknown as [FakeSession, FakeSession];
	return {
		devices,
		sa,
		sb,
		logged,
		saved,
		set: (s: Partial<Settings>) => (settings = { ...settings, ...s })
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('the device manager, with two devices', () => {
	it('has one session per kind', () => {
		const { devices, sa, sb } = setup();
		expect(devices.sessions).toHaveLength(2);
		expect(devices.session('a')).toBe(sa);
		expect(devices.session('b')).toBe(sb);
		expect(devices.session('nope')).toBeUndefined();
		expect(devices.kindOf('b')).toBe(sb.kind);
		expect(devices.kindOf(undefined)).toBe(sa.kind);
	});

	it('is active if either device is', async () => {
		const { devices, sa, sb } = setup();
		await sa.connectBluetooth();
		await sb.connectBluetooth();
		expect(devices.anyActive).toBe(false);
		sb.play();
		expect(devices.anyActive).toBe(true);
		expect(devices.active).toEqual([sb]);
		sa.play();
		expect(devices.active).toEqual([sa, sb]);
		sb.stop();
		expect(devices.anyActive).toBe(true);
		sa.stop();
		expect(devices.anyActive).toBe(false);
	});

	it('Stop all stops both', async () => {
		const { devices, sa, sb, logged } = setup();
		await sa.connectBluetooth();
		await sb.connectBluetooth();
		sa.play();
		sb.play();
		devices.stopAll();
		expect(sa.playing).toBe(false);
		expect(sb.playing).toBe(false);
		expect(sa.log.at(-1)).toBe('stop:user');
		expect(sb.log.at(-1)).toBe('stop:user');
		expect(devices.anyActive).toBe(false);
		expect(logged.map((e) => [e.device, e.ended])).toEqual([
			['a', 'user'],
			['b', 'user']
		]);
	});

	it('Stop all reaches a device that is not playing too (a stop is always sent)', () => {
		const { devices, sa, sb } = setup();
		sa.play();
		devices.stopAll();
		expect(sb.log).toEqual(['stop:user']);
	});

	it('the session limit stops both, by the clock, from when the first one started', async () => {
		const { sa, sb, logged } = setup({ sessionMaxMin: 10 });
		await sa.connectBluetooth();
		await sb.connectBluetooth();
		sa.play();
		vi.advanceTimersByTime(6 * 60_000);
		sb.play(); // joins six minutes in: it does not get ten minutes of its own
		sb.tick();
		expect(sb.playing).toBe(true);
		vi.advanceTimersByTime(3 * 60_000 + 59_000);
		sa.tick();
		expect(sa.playing).toBe(true);
		vi.advanceTimersByTime(1000);
		sb.tick(); // whichever device ticks first
		expect(sa.playing).toBe(false);
		expect(sb.playing).toBe(false);
		expect(logged.map((e) => [e.device, e.ended])).toEqual([
			['a', 'session_max'],
			['b', 'session_max']
		]);
	});

	it('one device stopping does not restart the clock while the other plays on', () => {
		const { devices, sa, sb } = setup({ sessionMaxMin: 10 });
		sa.play();
		vi.advanceTimersByTime(5 * 60_000);
		sb.play();
		sa.stop();
		vi.advanceTimersByTime(5 * 60_000);
		devices.keepTime();
		expect(sb.playing).toBe(false);
		expect(sb.log.at(-1)).toBe('stop:session_max');
	});

	it('the clock starts again once everything has stopped', () => {
		const { devices, sa } = setup({ sessionMaxMin: 10 });
		sa.play();
		vi.advanceTimersByTime(9 * 60_000);
		devices.stopAll();
		sa.play();
		vi.advanceTimersByTime(9 * 60_000);
		sa.tick();
		expect(sa.playing).toBe(true);
		vi.advanceTimersByTime(60_000);
		sa.tick();
		expect(sa.playing).toBe(false);
	});

	it('a changed session limit applies to what is playing', () => {
		const { sa, set } = setup({ sessionMaxMin: 60 });
		sa.play();
		vi.advanceTimersByTime(20 * 60_000);
		sa.tick();
		expect(sa.playing).toBe(true);
		set({ sessionMaxMin: 15 });
		sa.tick();
		expect(sa.playing).toBe(false);
	});

	it('leaving the page reaches both, each with its own rule', () => {
		const { devices, sa, sb } = setup();
		sa.onLeave = 'estim-off'; // like the ring: part of it goes on
		sb.onLeave = 'stop';
		sa.play();
		sb.play();
		expect(devices.leavePage('hidden')).toBe('stop');
		expect(sa.log.at(-1)).toBe('leave:hidden');
		expect(sa.playing).toBe(true);
		expect(sb.playing).toBe(false);
		expect(sb.log).toContain('leave:hidden');
		expect(sb.log.at(-1)).toBe('stop:page_hidden');
		expect(devices.leavePage('pagehide')).toBe('estim-off');
		expect(sb.log.at(-1)).toBe('leave:pagehide');
		sa.stop();
		expect(devices.leavePage('hidden')).toBe('none');
	});

	it('tells when "any device is active" changes, once per change (the wake lock follows it)', () => {
		const { devices, sa, sb } = setup();
		const seen: boolean[] = [];
		const off = devices.onActive(({ active }) => seen.push(active));
		sa.play();
		sb.play();
		sa.stop();
		expect(devices.anyActive).toBe(true);
		expect(seen).toEqual([true]);
		sb.stop();
		expect(seen).toEqual([true, false]);
		off();
		sa.play();
		expect(seen).toEqual([true, false]);
	});

	it('only what played on a real device goes into the history', async () => {
		const { devices, sa, sb, logged } = setup();
		await sa.connectPreview();
		await sb.connectBluetooth();
		sa.play();
		sb.play();
		devices.stopAll();
		expect(logged.map((e) => e.device)).toEqual(['b']);
	});

	it('a device that connects for real joins My devices, a preview does not', async () => {
		const { devices, sa, sb, set } = setup();
		set({ devices: ['a'] });
		expect(devices.mine).toEqual([sa]);
		expect(devices.several).toBe(false);
		await sb.connectPreview();
		expect(devices.mine).toEqual([sa]);
		await sb.connectBluetooth();
		expect(devices.mine).toEqual([sa, sb]);
		expect(devices.several).toBe(true);
	});

	it('shows the first of My devices until another is chosen', () => {
		const { devices, sa, sb, set } = setup();
		expect(devices.shown).toBe(sa);
		devices.show('b');
		expect(devices.shown).toBe(sb);
		set({ devices: ['a'] }); // the chosen one is no longer mine
		expect(devices.shown).toBe(sa);
		set({ devices: [] });
		expect(devices.shown).toBe(sa);
	});

	it('looking around previews My devices that are not really connected', async () => {
		const { devices, sa, sb } = setup();
		await sa.connectBluetooth();
		expect(devices.previewOnly).toBe(false);
		expect(await devices.lookAround()).toBe(true);
		expect(sa.preview).toBe(false);
		expect(sb.preview).toBe(true);
		expect(devices.anyConnected).toBe(true);
		expect(devices.previewOnly).toBe(false);
		await sa.disconnect();
		expect(devices.previewOnly).toBe(true);
		await devices.disconnectAll();
		expect(devices.anyConnected).toBe(false);
	});

	it('reports a lost link per device', async () => {
		const { devices, sa, sb } = setup();
		await sa.connectPreview();
		await sb.connectPreview();
		sa.play();
		sa.simulateLoss();
		expect(devices.lost).toEqual([sa]);
		sa.dismissLoss();
		expect(devices.lost).toEqual([]);
		expect(sb.connection).toBe('connected');
	});

	it("hands new settings to every session, and a device's own changes to the app", () => {
		const { devices, sa, sb, saved } = setup();
		const next = devices.settings();
		devices.applySettings(next);
		expect(sa.settingsSeen).toBe(next);
		expect(sb.settingsSeen).toBe(next);
		devices.saveDeviceSettings('a', { level: 2 });
		expect(saved).toEqual([['a', { level: 2 }]]);
	});
});
