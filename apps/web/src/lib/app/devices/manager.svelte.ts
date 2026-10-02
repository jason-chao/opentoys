// The app's devices: one session per kind of device, and everything that is shared across them. One Stop (the
// button, Esc, the now-playing bar), "is anything active", the session limit by the clock, leaving the page,
// the wake lock, and looking around without a device. Each session keeps its own connection, engine and
// controls (lib/devices/<kind>/); it reports here through SessionHost.
import type { BackgroundOutcome, LeaveTrigger } from '@opentoys/devices';
import { bluetoothSupport } from '@opentoys/web-ble';
import type { Settings } from '../settings.ts';
import { attachPageLifecycle } from './lifecycle.ts';
import type { Registry } from './registry.ts';
import type { DeviceKind, DeviceSession, SessionEnd, SessionHost } from './types.ts';

export type BluetoothState = 'available' | 'unavailable' | 'unsupported' | 'unknown';

/** Tests only: drops the simulated devices' links, as when a phone goes out of range. Acts in preview only. */
export const SIMULATE_LOSS_EVENT = 'opentoys:simulate-loss';

/** What the manager needs from the app around it. */
export interface ManagerHooks {
	settings(): Settings;
	/** Store a change to one device's own settings block. */
	saveDeviceSettings(key: string, patch: Record<string, unknown>): void;
	/** A device was connected for real: it belongs to My devices from now on. */
	addDevice(id: string): void;
	/** Playback on a real device ended (usage history). */
	logged(end: SessionEnd): void;
}

type ActiveListener = (payload: { active: boolean }) => void;

export class DeviceManager implements SessionHost {
	/** One session per registered kind, for the life of the app. */
	readonly sessions: readonly DeviceSession[];
	bluetooth = $state<BluetoothState>('unknown');
	/** The device shown on Patterns and Manual, when there are several (null: the first of My devices). */
	private chosen = $state<string | null>(null);

	/** When playback began, on whichever device started first; 0 while nothing is playing. */
	private clockStart = 0;
	private wasActive = false;
	private activeListeners: ActiveListener[] = [];

	constructor(
		readonly registry: Registry,
		private readonly hooks: ManagerHooks
	) {
		this.sessions = registry.kinds.map((kind) => kind.createSession(this));
	}

	// ----- the sessions -----------------------------------------------------------------------------------------

	session(id: string): DeviceSession | undefined {
		return this.sessions.find((s) => s.kind.id === id);
	}

	/** The sessions of My devices, in the order of that list. */
	get mine(): DeviceSession[] {
		return this.hooks
			.settings()
			.devices.map((id) => this.session(id))
			.filter((s): s is DeviceSession => !!s);
	}

	/** There is more than one device to choose between (the device switch is only shown then). */
	get several(): boolean {
		return this.mine.length > 1;
	}

	/** The device whose patterns and manual controls are shown. */
	get shown(): DeviceSession {
		const mine = this.mine;
		return mine.find((s) => s.kind.id === this.chosen) ?? mine[0] ?? this.sessions[0];
	}

	show(id: string): void {
		this.chosen = id;
	}

	/** A kind by id; entries from before devices were recorded belong to the first kind. */
	kindOf(id: string | undefined | null): DeviceKind {
		return this.registry.of(id);
	}

	// ----- shared state -----------------------------------------------------------------------------------------

	get anyActive(): boolean {
		return this.sessions.some((s) => s.active);
	}

	get anyConnected(): boolean {
		return this.sessions.some((s) => s.connection === 'connected');
	}

	/** Every connection there is, is a preview (looking around without a device). */
	get previewOnly(): boolean {
		const connected = this.sessions.filter((s) => s.connection === 'connected');
		return connected.length > 0 && connected.every((s) => s.preview);
	}

	get active(): DeviceSession[] {
		return this.sessions.filter((s) => s.active);
	}

	get lost(): DeviceSession[] {
		return this.sessions.filter((s) => s.connection === 'lost');
	}

	// ----- one Stop -----------------------------------------------------------------------------------------------

	/** Stop every device's output now. */
	stopAll(reason = 'user'): void {
		for (const s of this.sessions) s.stop(reason);
	}

	// ----- the session limit, by the clock, across devices ------------------------------------------------------

	/**
	 * Playback stops on every device once the session limit has passed since it began (on whichever device
	 * started first), however many devices are playing and whether or not their patterns were silent in between.
	 * The clock starts again when everything has stopped.
	 */
	keepTime(now = Date.now()): void {
		if (!this.clockStart) return;
		if (!this.sessions.some((s) => s.playing)) {
			this.clockStart = 0;
			return;
		}
		if ((now - this.clockStart) / 1000 >= this.hooks.settings().sessionMaxMin * 60)
			this.stopAll('session_max');
	}

	// ----- SessionHost ------------------------------------------------------------------------------------------

	settings(): Settings {
		return this.hooks.settings();
	}

	saveDeviceSettings(key: string, patch: Record<string, unknown>): void {
		this.hooks.saveDeviceSettings(key, patch);
	}

	began(): void {
		if (!this.clockStart) this.clockStart = Date.now();
	}

	ticked(): void {
		this.keepTime();
	}

	activeChanged(): void {
		const active = this.anyActive;
		if (active === this.wasActive) return;
		this.wasActive = active;
		for (const fn of this.activeListeners) fn({ active });
	}

	ended(_session: DeviceSession, end: SessionEnd | null): void {
		if (!this.sessions.some((s) => s.playing)) this.clockStart = 0;
		if (end) this.hooks.logged(end);
	}

	connected(session: DeviceSession): void {
		this.hooks.addDevice(session.kind.id);
	}

	// ----- settings ---------------------------------------------------------------------------------------------

	applySettings(settings: Settings): void {
		for (const s of this.sessions) s.applySettings(settings);
	}

	// ----- connections ------------------------------------------------------------------------------------------

	/** Look around without a device: a preview of every one of My devices that isn't connected for real. */
	async lookAround(): Promise<boolean> {
		let any = false;
		for (const s of this.mine) {
			if (s.real) continue;
			if (await s.connectPreview()) any = true;
		}
		return any;
	}

	async disconnectAll(): Promise<void> {
		for (const s of this.sessions) await s.disconnect();
	}

	// ----- leaving the page, the wake lock ----------------------------------------------------------------------

	/** The page is being hidden or closed: every device applies its own rule. */
	leavePage(trigger: LeaveTrigger): BackgroundOutcome {
		const outcomes = this.sessions.map((s) => s.leavePage(trigger));
		return outcomes.includes('stop') ? 'stop' : outcomes.includes('estim-off') ? 'estim-off' : 'none';
	}

	/** Told whenever "any device is active" changes (the wake lock follows it). */
	onActive(fn: ActiveListener): () => void {
		this.activeListeners = [...this.activeListeners, fn];
		return () => {
			this.activeListeners = this.activeListeners.filter((x) => x !== fn);
		};
	}

	/** In the browser, once: the page lifecycle, whether Bluetooth is there, and the tests' lost-link event. */
	start(): () => void {
		const detach = attachPageLifecycle(this.sessions, (fn) => this.onActive(fn));
		void bluetoothSupport().then((s) => (this.bluetooth = s));
		const onLoss = () => {
			for (const s of this.sessions) s.simulateLoss();
		};
		window.addEventListener(SIMULATE_LOSS_EVENT, onLoss);
		return () => {
			window.removeEventListener(SIMULATE_LOSS_EVENT, onLoss);
			detach();
		};
	}
}
