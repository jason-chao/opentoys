// The app's shared state, created once in the root layout and handed to every page through context, so a
// Bluetooth connection survives navigation and language switches. Settings, saved patterns and the history live
// in IndexedDB (storage.ts); the appearance choice is a per-viewer convenience in localStorage (theme.ts). The
// devices (their sessions, and what is shared across them) belong to the manager (devices/manager.svelte.ts).
import { getContext, setContext } from 'svelte';
import { DeviceManager } from './devices/manager.svelte.ts';
import { withDevice } from './devices/mine.ts';
import { REGISTRY } from './devices/registry.ts';
import type { SessionEnd } from './devices/types.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, type Favourite, type Settings } from './settings.ts';
import { Storage, type JournalEntry, type SavedMode } from './storage.ts';
import { applyTheme, DARK_THEMES, loadTheme, resolveTheme, saveTheme, type ThemeChoice } from './theme.ts';

/**
 * A pattern to start on a device, with options in that device's own terms (what its pattern page's Start asks
 * for). It waits while the device is being connected, and through the optional lead-in.
 */
export interface Intent {
	device: string;
	presetId: string;
	opts: unknown;
}
export type PendingStart = Intent;

/** The set-up that is open, over whatever screen it was opened from. */
export interface SetupRequest {
	device: string;
	/** Where to begin, in the device's own terms (the ring: 'estim' goes straight to e-stim). */
	part?: string;
}

/** The connect sheet that is open for a device. */
export interface ConnectRequest {
	device: string;
	then?: Intent;
}

export class App {
	settings = $state<Settings>(sanitizeSettings(DEFAULT_SETTINGS));
	/** Settings and storage are loaded (in the browser). */
	ready = $state(false);
	/** IndexedDB could not be opened (private mode, blocked site data): nothing is kept. */
	storageFailed = $state(false);
	modes = $state<SavedMode[]>([]);
	journal = $state<JournalEntry[]>([]);
	/** The colour mode the viewer chose ('auto' follows the system). */
	theme = $state<ThemeChoice>('auto');
	systemDark = $state(true);
	/** A new version of the app is downloaded and waiting (offered only while nothing is playing). */
	updateReady = $state(false);
	/** A pattern waiting for its three-breath lead-in. */
	pendingStart = $state<PendingStart | null>(null);
	/** A device's set-up is open (over the current screen). */
	setup = $state<SetupRequest | null>(null);
	/** The connect sheet is open for a device. */
	connecting = $state<ConnectRequest | null>(null);
	/** The path of the page the user was on before this one (null on arrival): where Back may return to. */
	previousPath = $state<string | null>(null);
	/** Go to a page of the app (set by the layout, which knows about routing and languages). */
	navigate: (path: string) => void = () => {};

	/** The devices: one session per kind, one Stop, one session limit. */
	readonly devices: DeviceManager;
	private storage: Storage | null = null;
	private updateSW: ((reload?: boolean) => Promise<void>) | null = null;

	constructor() {
		this.devices = new DeviceManager(REGISTRY, {
			settings: () => this.settings,
			saveDeviceSettings: (key, patch) => void this.updateDevice(key, patch),
			addDevice: (id) => {
				if (!this.settings.devices.includes(id))
					void this.update({ devices: withDevice(this.settings.devices, id, REGISTRY) });
				this.deviceConnected(id);
			},
			logged: (end) => void this.sessionEnded(end)
		});
	}

	private async registerServiceWorker(): Promise<void> {
		if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
		const { registerSW } = await import('virtual:pwa-register');
		this.updateSW = registerSW({ onNeedRefresh: () => (this.updateReady = true) });
	}

	/** Switch to the waiting version (reloads the page, which ends any connection): only while idle. */
	async applyUpdate(): Promise<void> {
		if (this.devices.anyActive || !this.updateSW) return;
		await this.devices.disconnectAll();
		await this.updateSW(true);
	}

	/** The colour mode as applied: the choice, or for 'auto' what the system asks for. */
	get themeName() {
		return resolveTheme(this.theme, this.systemDark);
	}

	get dark(): boolean {
		return DARK_THEMES.has(this.themeName);
	}

	// ----- starting a pattern, wherever that needs to go first ---------------------------------------------------

	/**
	 * Start a pattern (a pattern page's Start, a locked row's "Set up to start"). Whatever stands in the way
	 * comes first, in place, and the pattern starts when it is out of the way: the connect sheet when the
	 * device isn't connected, its set-up when a real device still needs one.
	 */
	request(intent: Intent): void {
		const session = this.devices.session(intent.device);
		if (!session) return;
		if (session.connection !== 'connected') this.connecting = { device: intent.device, then: intent };
		else if (session.needsSetup) this.openSetup(intent.device);
		else this.run(intent);
	}

	/** Start it now (after the three breaths, when those are on), and show Control. */
	private run(intent: Intent): void {
		const session = this.devices.session(intent.device);
		if (!session || session.connection !== 'connected' || session.needsSetup) return;
		if (this.settings.leadIn) this.pendingStart = intent;
		else if (!session.start(intent.presetId, intent.opts)) return;
		this.navigate('/control/');
	}

	/** The lead-in is over (or was skipped): start what was waiting. */
	beginPending(): void {
		const p = this.pendingStart;
		this.pendingStart = null;
		if (p) this.devices.session(p.device)?.start(p.presetId, p.opts);
	}

	/** Open the connect sheet for a device. */
	connect(device: string, then?: Intent): void {
		this.connecting = then ? { device, then } : { device };
	}

	/** Open a device's set-up, over the current screen. */
	openSetup(device: string, part?: string): void {
		this.connecting = null;
		this.setup = part ? { device, part } : { device };
	}

	/**
	 * A device connected for real. The first time (and whenever something still has to be agreed or set), its
	 * set-up opens where the user is. Otherwise the pattern they were about to start starts.
	 */
	private deviceConnected(id: string): void {
		const session = this.devices.session(id);
		if (!session) return;
		const then = this.connecting?.device === id ? this.connecting.then : undefined;
		this.connecting = null;
		if (session.kind.setupOnConnect(session)) this.openSetup(id);
		else if (then) this.run(then);
	}

	/** The connect sheet ended with a preview: nothing to set up, the pattern can play on screen. */
	previewConnected(): void {
		const then = this.connecting?.then;
		this.connecting = null;
		if (then) this.run(then);
	}

	/**
	 * The set-up closed. The user is back where they opened it, with whatever they had chosen still there:
	 * nothing starts by itself after a set-up, Start is theirs to press.
	 */
	setupClosed(): void {
		this.setup = null;
	}

	/** Whether a built-in pattern of a device is starred. */
	isFavourite(device: string, id: string): boolean {
		return this.settings.favourites.some((f) => f.device === device && f.id === id);
	}

	async toggleFavourite(device: string, id: string): Promise<void> {
		const now: Favourite[] = $state.snapshot(this.settings.favourites);
		await this.update({
			favourites: this.isFavourite(device, id)
				? now.filter((f) => !(f.device === device && f.id === id))
				: [...now, { device, id }]
		});
	}

	/** My devices: the kinds of device this person has (Welcome, Settings; connecting a device adds it). */
	async setDevices(ids: string[]): Promise<void> {
		// A device taken out of the list is let go of: stopped and disconnected.
		for (const session of this.devices.sessions)
			if (!ids.includes(session.kind.id) && session.connection !== 'idle') {
				session.stop();
				void session.disconnect();
			}
		await this.update({ devices: ids });
	}

	/** In the browser, once: open storage, load settings and lists, hook up the page lifecycle. */
	async init(): Promise<() => void> {
		this.theme = loadTheme();
		applyTheme(this.theme);
		const media = matchMedia('(prefers-color-scheme: dark)');
		this.systemDark = media.matches;
		const onScheme = () => {
			this.systemDark = media.matches;
			applyTheme(this.theme); // the browser's bars follow the page
		};
		media.addEventListener('change', onScheme);
		const detach = this.devices.start();
		void this.registerServiceWorker();
		await this.open();
		return () => {
			media.removeEventListener('change', onScheme);
			detach();
		};
	}

	private async open(): Promise<void> {
		try {
			this.storage = await Storage.open();
			this.settings = await this.storage.getSettings();
			await this.reload();
			this.storageFailed = false;
		} catch {
			this.storage = null;
			this.storageFailed = true;
		}
		this.devices.applySettings(this.settings);
		this.ready = true;
	}

	async reload(): Promise<void> {
		if (!this.storage) return;
		[this.modes, this.journal] = await Promise.all([this.storage.listModes(), this.storage.listJournal()]);
	}

	/** Change settings: sanitised (limits stay within what is allowed), applied to the engine at once, stored. */
	async update(patch: Partial<Settings>): Promise<void> {
		this.settings = sanitizeSettings({ ...$state.snapshot(this.settings), ...patch });
		this.devices.applySettings(this.settings);
		await this.storage?.saveSettings(this.settings).catch(() => {});
	}

	/** Change one device's own settings (its block under `key`, e.g. 'ring'); sanitised like any change. */
	async updateDevice(key: string, patch: Record<string, unknown>): Promise<void> {
		const all = $state.snapshot(this.settings) as unknown as Record<string, Record<string, unknown>>;
		await this.update({ [key]: { ...all[key], ...patch } } as Partial<Settings>);
	}

	setTheme(theme: ThemeChoice): void {
		this.theme = theme;
		saveTheme(theme);
		applyTheme(theme);
	}

	/** Output on a real device ended: one line in the usage history. */
	private async sessionEnded(end: SessionEnd): Promise<void> {
		if (!this.storage) return;
		try {
			await this.storage.addJournal({
				device: end.device,
				at: end.startedAt,
				what: end.what,
				durationS: end.durationS,
				ended: end.ended
			});
			await this.reload();
		} catch {
			// the history just misses this entry
		}
	}

	/** Keep a recorded pattern, for the device it was recorded on. */
	async saveMode(mode: Parameters<Storage['saveMode']>[0], device: string): Promise<SavedMode | null> {
		if (!this.storage) return null;
		const saved = await this.storage.saveMode(mode, device);
		await this.reload();
		return saved;
	}

	async renameMode(id: number, name: string): Promise<void> {
		await this.storage?.renameMode(id, name);
		await this.reload();
	}

	async deleteMode(id: number): Promise<void> {
		await this.storage?.deleteMode(id);
		await this.reload();
	}

	async deleteJournalEntry(id: number): Promise<void> {
		await this.storage?.deleteJournalEntry(id);
		await this.reload();
	}

	async exportAll() {
		if (!this.storage) throw new Error('no storage');
		return this.storage.exportAll();
	}

	async importFile(data: unknown) {
		if (!this.storage) throw new Error('no storage');
		const result = await this.storage.importFile(data);
		if (result.settings) {
			this.settings = await this.storage.getSettings();
			this.devices.applySettings(this.settings);
		}
		await this.reload();
		return result;
	}

	/** Stop, disconnect, and remove every stored thing; the app starts over at the welcome screen. */
	async deleteEverything(): Promise<void> {
		this.devices.stopAll();
		await this.devices.disconnectAll();
		if (this.storage) await this.storage.deleteEverything();
		this.storage = null;
		this.settings = sanitizeSettings({});
		this.modes = [];
		this.journal = [];
		this.setTheme('auto');
		await this.open();
	}
}

const KEY = Symbol('app');

export const provideApp = (app: App): App => setContext(KEY, app);
export const useApp = (): App => getContext<App>(KEY);
