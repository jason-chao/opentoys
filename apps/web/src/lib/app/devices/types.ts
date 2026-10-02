// What the app needs from a kind of device, and from a session with one. The app is built around these two:
// the registry lists the kinds it implements, the manager owns one session per kind and provides what is
// shared across devices (one Stop, the session limit, leaving the page, the wake lock). Each kind brings its
// own engine, controller, settings and screens; nothing here knows what a device's output looks like.
import type { BackgroundOutcome, LeaveTrigger } from '@opentoys/devices';
import type { Settings } from '../settings.ts';

export type Connection = 'idle' | 'connecting' | 'connected' | 'lost';
/** A translatable failure: BLE error codes, device error codes, or 'unknown'. */
export type ConnectError = string;

/** Playback on a real device ended: one line for the usage history. */
export interface SessionEnd {
	/** The kind of device it was on (a registered id). */
	device: string;
	startedAt: number;
	/** What played, in the device's own terms (the ring: a preset id, 'manual', 'mode:<id>'). */
	what: string;
	durationS: number;
	ended: string;
}

/** What a session may ask of, or tell, the app around it. */
export interface SessionHost {
	/** The current settings (shared and per device). */
	settings(): Settings;
	/** Store a change to this device's own settings (its block under its settings key). */
	saveDeviceSettings(key: string, patch: Record<string, unknown>): void;
	/** Output started from silence on this device. */
	began(session: DeviceSession): void;
	/** A moment passed while something may be playing (every engine tick): keeps the shared clock. */
	ticked(session: DeviceSession): void;
	/** The session's `active` changed (the wake lock follows any device being active). */
	activeChanged(session: DeviceSession): void;
	/** Playback on this device ended; `end` is given when it was on a real device (usage history). */
	ended(session: DeviceSession, end: SessionEnd | null): void;
	/** This device connected for real (it then belongs to My devices). */
	connected(session: DeviceSession): void;
}

/**
 * A session with one device: its connection and what it is playing. The fields the shared parts of the app
 * read are reactive ($state in the implementations).
 */
export interface DeviceSession {
	readonly kind: DeviceKind;
	readonly connection: Connection;
	/** Looking around without a device: a simulated device inside the page, playing on screen only. */
	readonly preview: boolean;
	/** The browser's device chooser is open, or a connection is being made. */
	readonly busy: boolean;
	readonly battery: number | null;
	readonly error: ConnectError | null;
	/** The link dropped while output was live and the device may still be running. */
	readonly mayBeRunning: boolean;
	/** Something is running on this device (or its stop is still going out). */
	readonly active: boolean;
	/** Something was started and has not ended (it may be in a silent phase). */
	readonly playing: boolean;
	/** On a real device, not a preview. */
	readonly real: boolean;
	/** Something was started on it in this visit: it can be started again from Control. */
	readonly hasPlayed: boolean;
	/** What it played last can be started again. */
	readonly canRestart: boolean;
	/**
	 * Connected for real, and something must be agreed or set before anything can be started on it (its safety
	 * notes, and for the Coyote its maximums). The status strip says "Set-up needed".
	 */
	readonly needsSetup: boolean;
	/** Seconds since playback started on it (by the clock). */
	readonly elapsedS: number;
	/** Why output last ended (a stop reason), until the next start. */
	readonly stopped: string | null;

	connectBluetooth(): Promise<boolean>;
	connectPreview(): Promise<boolean>;
	reconnect(): Promise<boolean>;
	disconnect(): Promise<void>;
	dismissLoss(): void;
	/** Stop this device's output now. */
	stop(reason?: string): void;
	/** Start again what it played last. */
	restart(): void;
	/**
	 * Start one of its built-in patterns, with options in the device's own terms (what a pattern page's Start
	 * asks for). False when it could not start (not connected, locked, unknown pattern).
	 */
	start(presetId: string, opts: unknown): boolean;
	/** The page is being hidden or closed: apply this device's own rule. */
	leavePage(trigger: LeaveTrigger): BackgroundOutcome;
	/** New settings: limits apply from the next tick. */
	applySettings(settings: Settings): void;
	/** Tests only: drop the simulated link (acts in preview only). */
	simulateLoss(): void;
}

/** One device's block of the settings: how it is read from storage, and what an imported file may carry. */
export interface DeviceSettingsSpec<T = unknown> {
	/** Where the block lives in Settings (e.g. 'ring'). */
	readonly key: string;
	/**
	 * Defaults filled in, everything clamped. `stored` is the block as stored (any shape); `legacy` is the
	 * whole stored settings object, for kinds whose settings once lived there, flat.
	 */
	sanitize(stored: unknown, legacy: Record<string, unknown>): T;
	/** The same block without anything that needs a confirmation in this browser (a file may be anyone's). */
	locked(block: T): T;
	/**
	 * `block` (from a file) with no limit above what `current` (this browser's) has: each cap and maximum is
	 * the lower of the two, each rate the slower. A file may lower a limit, never raise one.
	 */
	notAbove(block: T, current: T): T;
}

/** A kind of device the app implements. */
export interface DeviceKind {
	/** The model id (stable: it is stored in My devices, favourites and the history). */
	readonly id: string;
	/** Its full name: the only name the app uses for it. */
	name(): string;
	/** Its own settings block, if it has one. */
	readonly settings?: DeviceSettingsSpec;
	/** Whether `id` is one of its built-in patterns (favourites are checked against this). */
	hasPattern(id: string): boolean;
	/** What a history entry played, in words. */
	describe(what: string, savedName: (id: number) => string | undefined): string;
	/** What to know before the browser's chooser opens (how the device is listed, what it does on connecting). */
	connectHints(): string[];
	/**
	 * After a lost link: what the device may be doing, and what to do about it (the ring may still be running;
	 * the Coyote stops by itself). null when there is nothing to say.
	 */
	lostAdvice(session: DeviceSession): string | null;
	/** Why playback ended, as a whole sentence, in this device's words. */
	stopText(code: string): string;
	/** A connection error (ConnectError) in plain words, for this device. */
	errorText(code: string): string;
	/** The browser has no Web Bluetooth: the title of that note, for this device. */
	unsupportedTitle(): string;
	/** More about a device that is connected for real (e.g. its firmware version), or null. */
	connectedDetail?(session: DeviceSession): string | null;
	/** One line saying what this device is, where devices are chosen. */
	about(): string;
	/** The now-playing bar's lines for what this session is playing. */
	nowPlaying(session: DeviceSession): { name: string; readout: string };
	/** This session's own Stop is on screen (its set-up is open): the now-playing bar stays away. */
	showsOwnStop(session: DeviceSession): boolean;
	/**
	 * The set-up should open by itself now that the device has connected for real: something still has to be
	 * agreed or set before it can be used, or (once) its optional levels have never been offered.
	 */
	setupOnConnect(session: DeviceSession): boolean;
	/** A few words on where the device stands, for the Settings hub (set up or not). */
	summary(session: DeviceSession): string;
	/** A session with this device; one per kind for the life of the app. */
	createSession(host: SessionHost): DeviceSession;
}
