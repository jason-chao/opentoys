// A session with the DG-LAB Coyote 3.0: the two-channel engine (packages/core, `coyote`), its output loop
// (packages/devices, CoyoteController), and the device over Web Bluetooth. Components read its $state fields
// and call its methods; the safety stages themselves live in the packages. What is shared across devices (one
// Stop, the session limit, leaving the page, the wake lock) belongs to the manager, which this session
// reports to.
//
// Intensity is the device's own number, 0..200 per channel. Nothing ever starts above 0: a pattern starts at
// the channel's current intensity, which is 0 after every stop, and the user raises it. The maximum per
// channel is the user's own (Settings), enforced three times: here, in the engine (its cap and the channel's
// ceiling), and on the device (its own caps, written on connecting and whenever they change). The device's caps
// are never 0 (they persist on the device and bound its wheels): where nothing may be started, that is the app's
// own lock, and every start sets the intensity explicitly, so a wheel turned while idle never carries over.
//
// "Preview" is looking around without a device: the same engine and loop drive a simulated Coyote inside the
// page. Nothing is felt, so everything can be tried without the set-up, and nothing goes into the history.
import { coyote } from '@opentoys/core';
import {
	COYOTE_3,
	CoyoteController,
	CoyoteDriver,
	coyoteNameKind,
	DeviceError,
	FakeCoyote,
	type BackgroundOutcome,
	type LeaveTrigger,
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
import { Trace } from '$lib/app/trace';
import { patternById, pulsesPerSecond } from './catalogue.ts';
import {
	capOf,
	CHANNELS,
	deviceCapsFor,
	maximaFor,
	PAUSE_SHORTEST_S,
	type Channel,
	type CoyoteSettings
} from './settings.ts';

/** One channel as the screens see it. */
export interface ChannelView {
	/** The pattern playing on it (a built-in id), or null. */
	pattern: string | null;
	/** The intensity the user set. */
	base: number;
	/** The intensity being sent now: the set one plus any slow increase, or the burst level. */
	intensity: number;
	/** The pattern's strength as sent on the last tick, 0..1 (after the gentle start). */
	strength: number;
	/** The pulse rate being sent, in pulses per second (0 when nothing is). */
	rate: number;
	/** The burst is held. */
	burst: boolean;
	/** Random pauses are on, and whether it is pausing right now. */
	pauses: boolean;
	pausing: boolean;
	/** Slow increase is on, and how much it has added so far. */
	increase: boolean;
	added: number;
	/** The value the device's own dial set last, until the intensity is changed here again. */
	dial: number | null;
}

const idle = (): ChannelView => ({
	pattern: null,
	base: 0,
	intensity: 0,
	strength: 0,
	rate: 0,
	burst: false,
	pauses: false,
	pausing: false,
	increase: false,
	added: 0,
	dial: null
});

/** The pattern the set-up plays while a maximum is found: constant, so every step is felt as it is. */
export const SETUP_PATTERN = 'steady';

/** Stop reasons after which no zero frames go out (there is no link to send them on, or it is going). */
const NO_ZERO = new Set(['connected', 'disconnect', 'link_lost', 'device_not_answering', 'write_failed']);

function strengthOf(payload: Uint8Array | null): number {
	if (!payload) return 0;
	return (payload[4]! + payload[5]! + payload[6]! + payload[7]!) / 400;
}

export class CoyoteDeviceSession implements DeviceSession {
	connection = $state<Connection>('idle');
	/** Looking around without a device: connected to the simulated Coyote, playing on screen only. */
	preview = $state(false);
	busy = $state(false);
	battery = $state<number | null>(null);
	/** The firmware version it reported on connecting. */
	firmware = $state<number | null>(null);
	error = $state<ConnectError | null>(null);
	/** The Coyote stops by itself when frames stop arriving: after a lost link it is never still running. */
	readonly mayBeRunning = false;
	active = $state(false);
	playing = $state(false);
	hasPlayed = $state(false);
	/** Why output last ended (a stop reason), until the next start. */
	stopped = $state<string | null>(null);
	/** It was stopped because the page was left, and has not been started since. */
	leftPage = $state(false);
	/** A stop is still going out (zero frames, until the device reports 0): nothing can be started yet. */
	silencing = $state(false);
	elapsedS = $state(0);
	a = $state<ChannelView>(idle());
	b = $state<ChannelView>(idle());
	/** The set-up is finding this channel's maximum: it may go up to the cap, the other channel stays at 0. */
	setup = $state<Channel | null>(null);
	/** What each channel played last, so it can be started again. */
	private last = $state<Partial<Record<Channel, string>>>({});
	/** What was sent over the last seconds, per channel: the pattern's strength, and the intensity. */
	readonly traces: Record<Channel, Trace> = { a: new Trace(), b: new Trace() };

	readonly engine: coyote.CoyoteSession;
	readonly controller: CoyoteController;
	private settings = $state.raw<Settings>(null!);
	private driver: CoyoteDriver | null = null;
	private bleDevice: Awaited<ReturnType<typeof requestDevice>> | null = null;
	private fake: FakeCoyote | null = null;
	private startedAt = 0;
	/** The patterns played since playback began, for the history. */
	private whats: string[] = [];
	private silenceTimer: ReturnType<typeof setTimeout> | undefined;
	/** A start that waits for the zero frames of a stop to finish. */
	private queued: (() => void) | null = null;

	constructor(
		readonly kind: DeviceKind,
		private readonly host: SessionHost
	) {
		this.settings = host.settings();
		this.engine = new coyote.CoyoteSession();
		this.applyLimits();
		this.controller = new CoyoteController({ engine: this.engine });
		const c = this.controller;
		c.on('tick', ({ out }) => {
			const now = performance.now();
			const scale = capOf(this.coyote.above100);
			for (const ch of CHANNELS) {
				const o = out[ch];
				const e = this.engine.channel(ch);
				const v = this[ch];
				v.intensity = o.intensity;
				v.base = e.baseIntensity;
				v.strength = strengthOf(o.payload);
				v.rate = v.strength > 0 && o.payload ? pulsesPerSecond(coyote.decodeFreq(o.payload[0]!)) : 0;
				v.burst = e.fire.active;
				v.pausing = e.tease.enabled && !e.tease.working;
				v.added = e.auto.totalIncr;
				this.traces[ch].push(now, v.strength, o.intensity / scale);
			}
			if (this.startedAt && this.playing) this.elapsedS = Math.floor((Date.now() - this.startedAt) / 1000);
			this.host.ticked(this);
		});
		c.on('active', ({ active }) => {
			this.active = active;
			this.host.activeChanged(this);
		});
		c.on('battery', ({ percent }) => {
			if (!this.preview) this.battery = percent;
		});
		c.on('dial', ({ channel, device }) => {
			// The device is the truth about its intensity, and never above the user's maximum.
			const max = this.maxima[channel];
			if (this.engine.channel(channel).baseIntensity > max) this.engine.channel(channel).setIntensity(max);
			this[channel].dial = Math.min(device, max);
		});
		c.on('stopped', ({ reason }) => this.ended(reason));
		c.on('silenced', () => this.setSilencing(false, true));
		c.on('state', ({ state }) => {
			if (state === 'detached' && this.connection !== 'lost') this.connection = 'idle';
		});
		c.on('linkLost', () => {
			this.connection = 'lost';
			this.setSilencing(false);
			this.clearViews();
		});
	}

	// ----- what applies now -------------------------------------------------------------------------------------

	/** The Coyote's own block of the settings. */
	get coyote(): CoyoteSettings {
		return this.settings.coyote;
	}

	get real(): boolean {
		return this.connection === 'connected' && !this.preview;
	}

	/** The maximum in force per channel (0 = nothing can be started on it). */
	get maxima(): Record<Channel, number> {
		return maximaFor(this.coyote, { preview: this.preview, setup: this.setup });
	}

	/**
	 * Patterns can be started: in a preview always (on screen only), on a real device once it is enabled in
	 * Settings. Every place that gates output asks this.
	 */
	get usable(): boolean {
		return this.preview || (this.coyote.agreed && this.coyote.enabled);
	}

	/** Connected for real and not set up: its safety notes and its maximums come first. */
	get needsSetup(): boolean {
		return this.real && !this.usable;
	}

	/** Something can be started or changed on this channel right now. */
	canUse(channel: Channel): boolean {
		return this.connection === 'connected' && !this.silencing && this.maxima[channel] > 0;
	}

	get canRestart(): boolean {
		return (
			this.connection === 'connected' &&
			!this.setup &&
			CHANNELS.some((ch) => this.last[ch] !== undefined && this.maxima[ch] > 0)
		);
	}

	/**
	 * The engine's cap, each channel's ceiling and the device's own caps, all from the maxima in force. A set
	 * intensity above a lowered maximum comes down with it.
	 */
	private applyLimits(writeCaps = true): void {
		const max = this.maxima;
		this.engine.setLimits({
			absoluteMax: Math.max(1, max.a, max.b),
			sessionMaxS: Math.min(86400, Math.max(60, Math.round(this.settings.sessionMaxMin * 60)))
		});
		const s = this.coyote;
		for (const ch of CHANNELS) {
			const c = this.engine.channel(ch);
			// The simple ceiling: one number per channel, with nothing that changes by itself.
			c.comfort.configure({
				mode: 'simple',
				absoluteMax: Math.max(1, max[ch]),
				comfortMax: Math.max(1, max[ch])
			});
			if (max[ch] === 0 && (c.player.playing || c.baseIntensity > 0)) c.stop();
			else if (c.baseIntensity > max[ch]) c.setIntensity(max[ch]);
			c.tease.workingRange = [PAUSE_SHORTEST_S, s.pauseWorkS];
			c.tease.pauseRange = [PAUSE_SHORTEST_S, s.pausePauseS];
			c.auto.timeMin = s.increaseEveryS;
			c.auto.timeMax = s.increaseEveryS;
			c.auto.intensityMax = s.increaseUpTo;
		}
		const driver = this.driver;
		const caps = deviceCapsFor(s, this.setup);
		if (writeCaps && driver?.connected && (driver.caps?.a !== caps.a || driver.caps?.b !== caps.b))
			void driver.setSoftCaps(caps.a, caps.b).catch(() => {});
	}

	applySettings(settings: Settings): void {
		this.settings = settings;
		this.applyLimits();
	}

	// ----- connection -------------------------------------------------------------------------------------------

	/** Open the browser's device chooser and connect (must run from a click or tap). */
	async connectBluetooth(): Promise<boolean> {
		return this.guarded(async () => {
			const device = await requestDevice(COYOTE_3.ble);
			// A device in its update mode has a name of its own: it can be seen, not controlled.
			if (coyoteNameKind(device.name) === 'recovery')
				throw new DeviceError('recovery-mode', 'the device is in update mode');
			this.bleDevice = device;
			return this.connectWith(false, () => connect(device, COYOTE_3.ble));
		});
	}

	/** Reconnect to what was connected before, without the chooser (after a lost link, on request). */
	async reconnect(): Promise<boolean> {
		if (this.preview) return this.connectPreview();
		const dev = this.bleDevice;
		if (!dev) return this.connectBluetooth();
		return this.guarded(() => this.connectWith(false, () => connect(dev, COYOTE_3.ble)));
	}

	/** Look around without a device: the simulated Coyote, on screen only. */
	async connectPreview(): Promise<boolean> {
		this.fake ??= new FakeCoyote();
		const fake = this.fake;
		return this.guarded(() => this.connectWith(true, async () => fake.connect()));
	}

	/**
	 * Connect over a link that is already there, as a real device (not a preview). The tests use it with the
	 * simulated Coyote, and so can anything that brings its own transport.
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
			const code = e instanceof BleError || e instanceof DeviceError ? e.code : 'unknown';
			// Closing the chooser is a choice, not an error.
			this.error = code === 'cancelled' ? null : code;
			return false;
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Open the link and the driver, then swap it in. What was attached before (a preview) stays until the new
	 * device has answered. The device's own caps are written while connecting, for the device that is being
	 * connected: leaving a preview locks everything again unless the Coyote is enabled in Settings.
	 */
	private async connectWith(preview: boolean, open: () => Promise<Transport>): Promise<boolean> {
		const before = this.controller.device ? this.connection : 'idle';
		this.connection = 'connecting';
		let driver: CoyoteDriver;
		try {
			const caps = deviceCapsFor(this.coyote);
			driver = await CoyoteDriver.open(await open(), { caps });
		} catch (e) {
			if (before === 'connected' && this.controller.device) this.connection = 'connected';
			else {
				this.connection = 'idle';
				this.preview = false;
			}
			throw e;
		}
		if (this.controller.device) await this.controller.disconnect();
		this.setup = null;
		this.setSilencing(false);
		this.preview = preview;
		this.driver = driver;
		this.applyLimits(false);
		this.battery = preview ? null : driver.battery;
		this.firmware = preview ? null : driver.fwVersion;
		this.controller.attach(driver);
		this.connection = 'connected';
		if (!preview) this.host.connected(this);
		return true;
	}

	/** Stop output (the device acknowledges zero), then a clean disconnect. */
	async disconnect(): Promise<void> {
		await this.controller.disconnect();
		this.driver = null;
		this.connection = 'idle';
		this.preview = false;
		this.setup = null;
		this.setSilencing(false);
		this.applyLimits(false);
		this.clearViews();
		this.battery = null;
		this.firmware = null;
	}

	dismissLoss(): void {
		if (this.connection !== 'lost') return;
		this.connection = 'idle';
		this.preview = false;
		this.applyLimits(false);
	}

	/** Tests only: the simulated Coyote's link drops. Acts in preview only. */
	simulateLoss(): void {
		if (this.preview) this.fake?.loseLink();
	}

	// ----- starting and changing output ---------------------------------------------------------------------------

	/**
	 * Every start intent: after a stop the engine keeps its stop reason, and with it its own session limit is
	 * off, until it is resumed.
	 */
	private wake(): void {
		if (this.engine.stoppedReason !== null) this.engine.resume();
	}

	/**
	 * A channel that is about to start from idle: its intensity is 0, whatever the device's wheel was turned to
	 * meanwhile, and the next frame says so explicitly. (Without it the frame would say "keep", and the pattern
	 * would play at the wheel's value until the app noticed.)
	 */
	private fromZero(channel: Channel): void {
		const c = this.engine.channel(channel);
		c.setIntensity(0); // the output loop states it explicitly on the first frame of a start
		this[channel].base = 0;
		this[channel].dial = null;
	}

	/**
	 * Start a built-in pattern on one channel or both. It plays at the channel's current intensity, which is 0
	 * after every stop: nothing is felt until the user raises it.
	 */
	play(channels: readonly Channel[], id: string): boolean {
		const pattern = patternById(id);
		if (!pattern || this.setup) return false;
		const on = channels.filter((ch) => this.canUse(ch));
		if (on.length === 0) return false;
		this.wake();
		for (const ch of on) {
			if (!this.engine.channel(ch).player.playing) this.fromZero(ch);
			this.engine.channel(ch).player.play(pattern.waveform);
			this[ch].pattern = id;
			this.last = { ...this.last, [ch]: id };
		}
		this.begin(id);
		return true;
	}

	/** Start a built-in pattern with what its page's Start asks for: the channels to play it on. */
	start(presetId: string, opts: unknown): boolean {
		const asked = (opts as { channels?: readonly Channel[] } | null)?.channels;
		const channels = asked?.length ? asked : (['a'] as const);
		// A stop is still going out (the set-up has just ended, say): the pattern starts when the device has
		// reported 0, a second later at most. Any stop in between takes it back.
		if (this.silencing && this.connection === 'connected' && this.usable && patternById(presetId)) {
			this.queued = () => this.play(channels, presetId);
			return true;
		}
		return this.play(channels, presetId);
	}

	/** Start again what each channel played last (at 0, like every start). */
	restart(): void {
		for (const ch of CHANNELS) {
			const id = this.last[ch];
			if (id !== undefined) this.play([ch], id);
		}
	}

	/** Set a channel's intensity (0..its maximum). Only while a pattern is playing on it. */
	setIntensity(channel: Channel, value: number): void {
		const v = this[channel];
		if (!this.canUse(channel) || v.pattern === null) return;
		this.wake();
		const max = this.maxima[channel];
		const c = this.engine.channel(channel);
		c.setIntensity(Math.min(max, Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0))));
		v.base = c.baseIntensity;
		// Shown at once (it goes out with the next frame, a tenth of a second later at most).
		if (!c.fire.active) v.intensity = Math.min(max, v.base + v.added);
		v.dial = null;
	}

	step(channel: Channel, delta: number): void {
		this.setIntensity(channel, this.engine.channel(channel).baseIntensity + delta);
	}

	/**
	 * The burst: while held, the channel runs `burst` above its current intensity, never above its maximum. The
	 * engine lets go by itself after 15 seconds. Not from 0: there must be an intensity to add to.
	 */
	burst(channel: Channel, on: boolean): void {
		const c = this.engine.channel(channel);
		if (!on) {
			c.fire.end();
			this[channel].burst = false;
			return;
		}
		if (!this.canUse(channel) || this[channel].pattern === null || c.baseIntensity <= 0) return;
		// Above what is playing now, which includes what slow increase has added: a burst never lowers it.
		const now = c.baseIntensity + c.auto.totalIncr;
		c.fire.setTarget(Math.min(this.maxima[channel], now + this.coyote.burst));
		c.fire.start();
		this[channel].burst = true;
	}

	/** Random pauses: play and pause periods of random length take turns. */
	setPauses(channel: Channel, on: boolean): void {
		const t = this.engine.channel(channel).tease;
		t.enabled = on;
		t.reset();
		this[channel].pauses = on;
		if (!on) this[channel].pausing = false;
	}

	/** Slow increase: +1 every so often while playing, up to a set amount above the set intensity. */
	setIncrease(channel: Channel, on: boolean): void {
		const a = this.engine.channel(channel).auto;
		a.enabled = on;
		if (!on) a.reset();
		this[channel].increase = on;
		if (!on) this[channel].added = 0;
	}

	/** One channel off: its pattern stops and its intensity goes to 0. The last channel going off is a stop. */
	off(channel: Channel): void {
		this.engine.channel(channel).stop();
		this.setPauses(channel, false);
		this.setIncrease(channel, false);
		this[channel] = idle();
		if (this.playing && !this.engine.busy) this.stop('user');
	}

	/** Stop all output now: zero frames go out until the device reports 0. */
	stop(reason = 'user'): void {
		this.queued = null;
		void this.controller.stop(reason);
	}

	/** The page is being hidden or closed: for this device always a full stop, until it is started again. */
	leavePage(trigger: LeaveTrigger): BackgroundOutcome {
		const was = this.playing;
		this.queued = null;
		const outcome = this.controller.leavePage(trigger);
		if (outcome === 'stop' && was) this.leftPage = true;
		return outcome;
	}

	// ----- the set-up: finding a channel's maximum ----------------------------------------------------------------

	/**
	 * Start the set-up for one channel, on a real device: a constant pattern at intensity 0, which the user
	 * steps up (here, or with the device's wheel) until it is as strong as they ever want it. Only that channel
	 * can output, up to the cap. (Setting up again starts from 0 too: the earlier maximum does not apply.)
	 */
	beginSetup(channel: Channel): boolean {
		if (!this.real || !this.coyote.agreed || this.playing || this.silencing) return false;
		const pattern = patternById(SETUP_PATTERN);
		if (!pattern) return false;
		this.setup = channel;
		this.applyLimits();
		this.wake();
		this.fromZero(channel);
		this.engine.channel(channel).player.play(pattern.waveform);
		this[channel].pattern = SETUP_PATTERN;
		this.begin(null);
		return true;
	}

	/** Leave the set-up: output stops and the normal maxima come back. */
	endSetup(): void {
		if (!this.setup) return;
		if (this.playing) this.stop('user');
		this.setup = null;
		this.applyLimits();
	}

	// ----- bookkeeping ------------------------------------------------------------------------------------------

	private begin(what: string | null): void {
		if (!this.playing) {
			this.startedAt = Date.now();
			this.elapsedS = 0;
			this.stopped = null;
			this.leftPage = false;
			this.playing = true;
			this.whats = [];
			this.host.began(this);
		}
		if (what !== null) {
			this.hasPlayed = true;
			if (!this.whats.includes(what)) this.whats.push(what);
		}
	}

	private ended(reason: string): void {
		this.clearViews();
		for (const ch of CHANNELS) {
			const c = this.engine.channel(ch);
			c.tease.enabled = false;
			c.auto.enabled = false;
		}
		// The zero frames of this stop are on their way: nothing starts until the device has reported 0.
		if (this.controller.device && !NO_ZERO.has(reason)) this.setSilencing(true);
		if (!this.playing) return; // nothing was playing: the earlier reason stands
		this.stopped = reason;
		this.playing = false;
		// A preview is not usage, and neither is the set-up: they stay out of the history.
		const logged = this.startedAt && this.whats.length > 0 && !this.preview;
		this.host.ended(
			this,
			logged
				? {
						device: this.kind.id,
						startedAt: this.startedAt,
						what: this.whats.slice(0, 6).join(','),
						durationS: this.elapsedS,
						ended: reason
					}
				: null
		);
		this.startedAt = 0;
		this.whats = [];
	}

	private clearViews(): void {
		this.a = idle();
		this.b = idle();
		const now = performance.now();
		for (const ch of CHANNELS) this.traces[ch].push(now, 0, 0);
	}

	private setSilencing(on: boolean, finished = false): void {
		clearTimeout(this.silenceTimer);
		this.silencing = on;
		// Only the end of the zero frames lets a waiting start through. Anything else that ends the silence
		// (a lost link, a new connection, a disconnect) takes it back.
		const start = finished ? this.queued : null;
		if (!on) this.queued = null;
		start?.();
		// Never stuck: the zero frames take a second, three at the most.
		if (on) this.silenceTimer = setTimeout(() => this.setSilencing(false, true), 4000);
	}
}
