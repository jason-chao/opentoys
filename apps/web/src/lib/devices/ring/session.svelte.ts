// A session with the Dragon S1: one engine session (packages/core), the output controller (packages/devices),
// and the ring over Web Bluetooth. Components read its $state fields and call its methods; the safety pipeline
// itself lives in the packages. What is shared across devices (one Stop, the session limit, leaving the page,
// the wake lock) belongs to the manager (lib/app/devices/manager.svelte.ts), which this session reports to.
//
// "Preview" is looking around without a device: the same engine and controller drive a simulated ring inside
// the page, so patterns play on screen only. Nothing is felt, so e-stim is shown without being set up, nothing
// can be calibrated, and nothing goes into the usage history.
import {
	BY_ID,
	DEFAULT_INTENSITY,
	MAX_CAPS,
	Session,
	type PresetOptions,
	type Recording
} from '@opentoys/core';
import {
	Controller,
	DeviceError,
	DRAGON_S1,
	FakeRing,
	S1Driver,
	type BackgroundOutcome,
	type Device,
	type LeaveTrigger,
	type RoleLevels,
	type Transport
} from '@opentoys/devices';
import { BleError, connect, requestDevice } from '@opentoys/web-ble';
import type { Settings } from '$lib/app/settings';
import type {
	ConnectError,
	Connection,
	DeviceKind,
	DeviceSession,
	SessionHost
} from '$lib/app/devices/types';
import { stepValue } from '$lib/app/stepping';
import { Trace } from '$lib/app/trace';
import { limitsFor, type RingSettings } from './settings.ts';

const ZERO: RoleLevels = { vibration: 0, estim: 0 };

/** What was started last: a built-in pattern (with its options), manual control, or a saved pattern. */
export type Playing =
	| {
			kind: 'preset';
			id: string;
			params: Record<string, number | string> | null;
			vibIntensity: number;
			estimIntensity: number;
			estimOn: boolean;
			intensify: boolean;
	  }
	| { kind: 'manual'; vib: number; estim: number }
	| { kind: 'mode'; id: number; name: string };

export type CalibrationChannel = 'vibration' | 'estim';

/** What Start on a pattern page asks for. */
export type PlayOptions = NonNullable<Parameters<RingSession['play']>[1]>;

export class RingSession implements DeviceSession {
	connection = $state<Connection>('idle');
	/** Looking around without a device: connected to the simulated ring, playing on screen only. */
	preview = $state(false);
	/** The browser's device chooser is open, or a connection is being made. */
	busy = $state(false);
	battery = $state<number | null>(null);
	error = $state<ConnectError | null>(null);
	/** The link dropped while output was live: the ring may still be running. */
	mayBeRunning = $state(false);
	/** A source is running (or its stop is still going out). */
	active = $state(false);
	/** What is being sent right now, per role (0..1): drives the visuals. */
	output = $state<RoleLevels>(ZERO);
	/** E-stim held at 0 after the page was left, until the user turns it on again. */
	estimHeld = $state(false);
	/** Something was started and has not ended (it may be in a silent phase). */
	playing = $state(false);
	/** Why output last ended (a stop reason), until the next start. */
	stopped = $state<string | null>(null);
	/** Seconds since playback started (by the clock). */
	elapsedS = $state(0);
	/** The last thing started (kept after a stop, so it can be started again). */
	current = $state<Playing | null>(null);
	/** A calibration is running: manual output on one channel, up to the cap instead of the comfort maximum. */
	calibrating = $state<CalibrationChannel | null>(null);
	/** Recording manual control. */
	recording = $state(false);
	/** A new connection makes the ring buzz: set on each connect so the UI can say so beforehand. */
	readonly buzzesOnConnect = DRAGON_S1.capabilities.buzzesOnConnect;
	/** What was sent over the last seconds (for the graphs on Control); not reactive, read while drawing. */
	readonly trace = new Trace();

	readonly session: Session;
	readonly controller: Controller;
	/** Reactive, so that what depends on it (estimAvailable) updates when Settings change. */
	private settings = $state.raw<Settings>(null!);
	private bleDevice: Awaited<ReturnType<typeof requestDevice>> | null = null;
	private fake: FakeRing | null = null;
	private startedAt = 0;
	private what = '';

	constructor(
		readonly kind: DeviceKind,
		private readonly host: SessionHost
	) {
		this.settings = host.settings();
		// The engine runs under the device's full range; the user's own caps (e-stim 80 % unless they allowed
		// more) reach it through the limits (limitsFor).
		this.session = new Session(limitsFor(this.ring, this.settings.sessionMaxMin), MAX_CAPS);
		this.controller = new Controller({ engine: this.session });
		const c = this.controller;
		c.on('tick', ({ roles, estimHeld }) => {
			this.output = roles;
			this.estimHeld = estimHeld;
			this.trace.push(performance.now(), roles.vibration, roles.estim);
			this.keepTime();
			this.host.ticked(this);
		});
		c.on('active', ({ active }) => {
			this.active = active;
			this.host.activeChanged(this);
		});
		c.on('battery', ({ percent }) => (this.battery = percent));
		c.on('stopped', ({ reason }) => this.ended(reason));
		c.on('state', ({ state }) => {
			if (state === 'detached' && this.connection !== 'lost') this.connection = 'idle';
		});
		c.on('linkLost', ({ mayBeRunning }) => {
			this.connection = 'lost';
			// Nothing real is running in preview.
			this.mayBeRunning = mayBeRunning && !this.preview;
			this.silent();
			this.recording = false;
		});
	}

	/** Nothing is being sent any more (as far as the page knows). */
	private silent(): void {
		this.output = ZERO;
		this.trace.push(performance.now(), 0, 0);
	}

	/**
	 * E-stim can be used: enabled in Settings (after its calibration and confirmation), or in preview, where it
	 * is only shown on screen. Every place that gates e-stim asks this.
	 */
	get estimAvailable(): boolean {
		return this.preview || (this.ring.agreed && this.ring.estimUnlocked);
	}

	/**
	 * Output can be started: in a preview always (on screen only), on a real ring once its safety notes were
	 * agreed to (its set-up). Every way of starting output asks this.
	 */
	get usable(): boolean {
		return this.preview || this.ring.agreed;
	}

	/** Connected for real and the safety notes are not agreed to yet: nothing can be started. */
	get needsSetup(): boolean {
		return this.real && !this.ring.agreed;
	}

	/** E-stim is part of what's playing now: available, asked for, and not held after leaving the page. The
	 * readouts then show its level (0 % in a silent phase) rather than "off". */
	get estimInUse(): boolean {
		const cur = this.current;
		if (!cur || !this.active || !this.estimAvailable || this.estimHeld) return false;
		return cur.kind !== 'preset' || cur.estimOn;
	}

	/** The ring's own block of the settings. */
	get ring(): RingSettings {
		return this.settings.ring;
	}

	/** On a real device (not the preview): the only place anything can be felt, calibrated or logged. */
	get real(): boolean {
		return this.connection === 'connected' && !this.preview;
	}

	private applyLimits(): void {
		this.session.setLimits(limitsFor(this.ring, this.settings.sessionMaxMin, this.preview));
	}

	/**
	 * The page is being hidden or closed. The ring's own rule: e-stim to 0 at once, vibration keeps running;
	 * or a full stop when the user chose "stop everything when I leave the page".
	 */
	leavePage(trigger: LeaveTrigger): BackgroundOutcome {
		return this.controller.leavePage(trigger, { stopEverything: this.ring.stopEverythingOnLeave });
	}

	/** Tests only: the simulated ring's link drops, as when a phone goes out of range. Acts in preview only. */
	simulateLoss(): void {
		if (this.preview) this.fake?.loseLink();
	}

	/** New settings (calibration, limits): the engine takes them from the next tick. */
	applySettings(settings: Settings): void {
		this.settings = settings;
		if (!this.calibrating) this.applyLimits();
	}

	get connected(): boolean {
		return this.connection === 'connected';
	}

	/**
	 * Open the browser's device chooser and connect (must run from a click or tap). Closing the chooser changes
	 * nothing: a preview carries on.
	 */
	async connectBluetooth(): Promise<boolean> {
		if (this.busy) return false;
		this.busy = true;
		this.error = null;
		try {
			const device = await requestDevice(DRAGON_S1.ble);
			this.bleDevice = device;
			return await this.connectWith(false, () => connect(device, DRAGON_S1.ble));
		} catch (e) {
			this.fail(e);
			return false;
		} finally {
			this.busy = false;
		}
	}

	/** Reconnect to what was connected before, without the chooser (after a lost link, on request). */
	async reconnect(): Promise<boolean> {
		if (this.preview) return this.connectPreview();
		const dev = this.bleDevice;
		if (!dev) return this.connectBluetooth();
		return this.guarded(() => this.connectWith(false, () => connect(dev, DRAGON_S1.ble)));
	}

	/** Look around without a device: the simulated ring, on screen only. */
	async connectPreview(): Promise<boolean> {
		this.fake ??= new FakeRing();
		const fake = this.fake;
		return this.guarded(() => this.connectWith(true, async () => fake.connect()));
	}

	/**
	 * Connect over a link that is already there, as a real ring (not a preview). The tests use it with the
	 * simulated ring, and so can anything that brings its own transport.
	 */
	async connectVia(open: () => Promise<Transport>): Promise<boolean> {
		return this.guarded(() => this.connectWith(false, open));
	}

	private async guarded(run: () => Promise<boolean>): Promise<boolean> {
		if (this.busy) return false;
		this.busy = true;
		this.error = null;
		try {
			return await run();
		} catch (e) {
			this.fail(e);
			return false;
		} finally {
			this.busy = false;
		}
	}

	private fail(e: unknown): void {
		const code = e instanceof BleError || e instanceof DeviceError ? e.code : 'unknown';
		// Closing the chooser is a choice, not an error.
		this.error = code === 'cancelled' ? null : code;
	}

	/**
	 * Open the link and the driver, then swap it in. What was attached before (a preview) stays until the new
	 * device has answered, so a failed attempt leaves things as they were. The limits for the new device are in
	 * place before the controller gets it: leaving preview locks e-stim again unless it is enabled in Settings.
	 */
	private async connectWith(preview: boolean, open: () => Promise<Transport>): Promise<boolean> {
		const before = this.controller.device ? this.connection : 'idle';
		this.connection = 'connecting';
		this.mayBeRunning = false;
		let driver: S1Driver;
		try {
			const transport = await open();
			const knownHeader = preview ? null : this.ring.knownHeader;
			driver = await S1Driver.open(transport, { knownHeader });
			const header = driver.info().header;
			// Remembered, so a reconnection can silence the ring before anything else.
			if (!preview && header !== null && header !== knownHeader)
				this.host.saveDeviceSettings('ring', { knownHeader: header });
		} catch (e) {
			if (before === 'connected' && this.controller.device) this.connection = 'connected';
			else {
				this.connection = 'idle';
				this.preview = false;
				this.applyLimits();
			}
			throw e;
		}
		if (this.controller.device) await this.controller.disconnect();
		this.endCalibration();
		this.preview = preview;
		this.applyLimits();
		this.battery = preview ? null : driver.info().battery;
		this.controller.attach(driver as Device);
		this.connection = 'connected';
		if (!preview) this.host.connected(this);
		return true;
	}

	/** Stop output, then a clean disconnect (the ring stops itself on a clean disconnect too). */
	async disconnect(): Promise<void> {
		await this.controller.disconnect();
		this.connection = 'idle';
		this.preview = false;
		this.applyLimits();
		this.silent();
		this.battery = null;
	}

	/** Stop all output now. */
	stop(reason = 'user'): void {
		this.controller.stop(reason);
		this.silent();
		this.recording = false;
	}

	/** The user has read the link-lost alert. */
	dismissLoss(): void {
		if (this.connection === 'lost') {
			this.connection = 'idle';
			this.preview = false;
			this.applyLimits();
		}
		this.mayBeRunning = false;
	}

	/** Play a built-in pattern (preset or generator), mapped onto the calibrated range. */
	play(
		presetId: string,
		opts: {
			params?: Record<string, number | string> | null;
			vibIntensity?: number;
			estimIntensity?: number;
			estimOn?: boolean;
			intensify?: boolean;
			seed?: number | null;
		} = {}
	): boolean {
		if (this.connection !== 'connected' || !this.usable || !BY_ID.has(presetId)) return false;
		this.endCalibration();
		this.current = {
			kind: 'preset',
			id: presetId,
			params: opts.params ?? null,
			vibIntensity: opts.vibIntensity ?? DEFAULT_INTENSITY[0],
			estimIntensity: opts.estimIntensity ?? DEFAULT_INTENSITY[1],
			estimOn: !!opts.estimOn && this.estimAvailable,
			intensify: !!opts.intensify
		};
		this.begin(presetId);
		this.session.setPreset(presetId, { ...this.presetOptions(), seed: opts.seed ?? null });
		return true;
	}

	/** Start a built-in pattern with what its page's Start asks for. */
	start(presetId: string, opts: unknown): boolean {
		return this.play(presetId, (opts ?? {}) as PlayOptions);
	}

	/** Change the running pattern's intensity, e-stim or "intensify slowly" (the pattern itself carries on). */
	adjust(
		patch: Partial<{ vibIntensity: number; estimIntensity: number; estimOn: boolean; intensify: boolean }>
	): void {
		const cur = this.current;
		if (cur?.kind !== 'preset') return;
		const next = { ...cur, ...patch };
		next.vibIntensity = Math.min(1, Math.max(0, next.vibIntensity));
		next.estimIntensity = Math.min(1, Math.max(0, next.estimIntensity));
		next.estimOn = next.estimOn && this.estimAvailable;
		this.current = next;
		if (this.session.source !== null) this.session.setPreset(cur.id, this.presetOptions());
	}

	get hasPlayed(): boolean {
		return this.current !== null;
	}

	/** A saved pattern is started from Saved, where its recording is. */
	get canRestart(): boolean {
		return this.current !== null && this.current.kind !== 'mode' && this.connection === 'connected';
	}

	/** Start the last thing again. */
	restart(): void {
		const cur = this.current;
		if (cur?.kind === 'preset') this.play(cur.id, cur);
		else if (cur?.kind === 'manual') this.setManual(cur.vib, cur.estim);
	}

	private presetOptions(): PresetOptions {
		const cur = this.current;
		if (cur?.kind !== 'preset') return {};
		return {
			params: cur.params,
			estimOn: cur.estimOn && this.estimAvailable,
			intensify: cur.intensify,
			intensity: { vib: cur.vibIntensity, estim: cur.estimIntensity }
		};
	}

	// ----- the rows on Control: − and + per output, in steps of 5 % -------------------------------------------------

	/** What − and + change for vibration right now: a pattern's intensity, or the free-control level. */
	get vibSetting(): number | null {
		const cur = this.current;
		if (!this.active || !cur) return null;
		return cur.kind === 'preset' ? cur.vibIntensity : cur.kind === 'manual' ? cur.vib : null;
	}

	/** The same for e-stim; null when e-stim isn't part of what is playing (or can't be changed). */
	get estimSetting(): number | null {
		const cur = this.current;
		if (!this.active || !cur || !this.estimAvailable) return null;
		return cur.kind === 'preset'
			? cur.estimOn
				? cur.estimIntensity
				: null
			: cur.kind === 'manual'
				? cur.estim
				: null;
	}

	stepVibration(steps: number): void {
		const cur = this.current;
		const now = this.vibSetting;
		if (now === null || !cur) return;
		const next = stepValue(now, steps, 0.05, 0, 1);
		if (cur.kind === 'preset') this.adjust({ vibIntensity: next });
		else if (cur.kind === 'manual') this.setManual(next, cur.estim);
	}

	stepEstim(steps: number): void {
		const cur = this.current;
		const now = this.estimSetting;
		if (now === null || !cur) return;
		const next = stepValue(now, steps, 0.05, 0, 1);
		if (cur.kind === 'preset') this.adjust({ estimIntensity: next });
		else if (cur.kind === 'manual') this.setManual(cur.vib, next);
	}

	/** Free control: levels as fractions 0..1, capped but not mapped. */
	setManual(vib: number, estim: number): void {
		if (this.connection !== 'connected' || !this.usable) return;
		this.endCalibration();
		const e = this.estimAvailable ? estim : 0;
		this.current = { kind: 'manual', vib, estim: e };
		this.begin('manual');
		this.session.setManual(vib, e);
	}

	/** A saved pattern (ring-link-mode/1 lanes). */
	playMode(id: number, mode: { name: string; periodMs: number; vib: number[]; estim: number[] }): void {
		if (this.connection !== 'connected' || !this.usable) return;
		this.endCalibration();
		this.current = { kind: 'mode', id, name: mode.name };
		this.begin(`mode:${id}`);
		const estim = this.estimAvailable ? mode.estim : [];
		this.session.play([{ name: mode.name, period_ms: mode.periodMs, vib: mode.vib, estim }], 'loop', 0);
	}

	/**
	 * Calibration: one channel at a raw level, allowed up to the user's cap (not the comfort maximum being
	 * measured). E-stim can be calibrated before it is enabled; the rise limit and warm-up still apply. Only on
	 * a real device: a preview cannot be felt, so there is nothing to calibrate.
	 */
	calibrate(channel: CalibrationChannel, value: number): void {
		if (!this.real || !this.ring.agreed) return;
		const ring = this.ring;
		if (this.calibrating !== channel) {
			this.calibrating = channel;
			this.session.setLimits({
				...limitsFor(ring, this.settings.sessionMaxMin),
				maxVib: ring.capVib,
				maxEstim: channel === 'estim' ? ring.capEstim : 0
			});
		}
		this.begin('calibration');
		const v = Math.min(1, Math.max(0, value));
		this.session.setManual(channel === 'vibration' ? v : 0, channel === 'estim' ? v : 0);
	}

	/** Leave calibration: output stops and the normal limits come back. */
	endCalibration(): void {
		if (!this.calibrating) return;
		this.stop('user');
		this.calibrating = null;
		this.applyLimits();
	}

	/** Record what manual control sends (for a saved pattern). */
	startRecording(): void {
		this.session.recorder.start();
		this.recording = true;
	}

	takeRecording(): Recording {
		this.recording = false;
		return this.session.recorder.take();
	}

	/**
	 * Time since playback started on the ring, by the clock. The session limit is kept by the manager, on the
	 * same clock, across every device (the engine's own limit counts only moments with output above zero and
	 * falls behind when a hidden page's timers are throttled, so it stays as a backstop only).
	 */
	private keepTime(): void {
		if (!this.startedAt || this.session.source === null) return;
		this.elapsedS = Math.floor((Date.now() - this.startedAt) / 1000);
	}

	private begin(what: string): void {
		if (this.session.source === null) {
			this.startedAt = Date.now();
			this.elapsedS = 0;
			this.stopped = null;
			this.playing = true;
			this.host.began(this);
		}
		this.what = what;
	}

	private ended(reason: string): void {
		this.stopped = reason;
		this.playing = false;
		// A preview is not usage, and neither is a calibration: they stay out of the history.
		const logged = this.startedAt && this.what && this.what !== 'calibration' && !this.preview;
		this.host.ended(
			this,
			logged
				? {
						device: this.kind.id,
						startedAt: this.startedAt,
						what: this.what,
						durationS: this.elapsedS,
						ended: reason
					}
				: null
		);
		this.startedAt = 0;
		this.what = '';
	}
}
