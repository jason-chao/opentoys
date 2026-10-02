// Test doubles: a made-up kind of device and a session with it, for the tests of what is shared across devices
// (the registry, My devices, settings per device, the manager). Nothing here is used by the app.
import type { BackgroundOutcome, LeaveTrigger } from '@opentoys/devices';
import type { Settings } from '../settings.ts';
import type { Connection, DeviceKind, DeviceSession, SessionHost } from './types.ts';

export class FakeSession implements DeviceSession {
	connection: Connection = 'idle';
	preview = false;
	busy = false;
	battery: number | null = null;
	error: string | null = null;
	mayBeRunning = false;
	active = false;
	playing = false;
	hasPlayed = false;
	canRestart = false;
	needsSetup = false;
	elapsedS = 0;
	stopped: string | null = null;
	/** What happened to it, in order (the tests read this). */
	readonly log: string[] = [];
	/** What it does when the page is left. */
	onLeave: BackgroundOutcome = 'stop';
	settingsSeen: Settings | null = null;
	private startedAt = 0;

	constructor(
		readonly kind: DeviceKind,
		readonly host: SessionHost
	) {}

	get real(): boolean {
		return this.connection === 'connected' && !this.preview;
	}

	async connectBluetooth(): Promise<boolean> {
		this.connection = 'connected';
		this.preview = false;
		this.log.push('connect');
		this.host.connected(this);
		return true;
	}
	async connectPreview(): Promise<boolean> {
		this.connection = 'connected';
		this.preview = true;
		this.log.push('preview');
		return true;
	}
	reconnect(): Promise<boolean> {
		return this.preview ? this.connectPreview() : this.connectBluetooth();
	}
	async disconnect(): Promise<void> {
		this.stop('disconnect');
		this.connection = 'idle';
		this.preview = false;
		this.log.push('disconnect');
	}
	dismissLoss(): void {
		if (this.connection === 'lost') this.connection = 'idle';
	}

	/** Something starts playing on it. */
	play(what = 'pattern'): void {
		const fresh = !this.playing;
		this.playing = true;
		this.hasPlayed = true;
		this.log.push(`play:${what}`);
		if (fresh) {
			this.startedAt = Date.now();
			this.host.began(this);
		}
		this.setActive(true);
	}

	/** One engine tick. */
	tick(): void {
		this.host.ticked(this);
	}

	stop(reason = 'user'): void {
		this.log.push(`stop:${reason}`);
		const was = this.playing;
		this.playing = false;
		this.setActive(false);
		if (was)
			this.host.ended(
				this,
				this.preview
					? null
					: { device: this.kind.id, startedAt: this.startedAt, what: 'pattern', durationS: 0, ended: reason }
			);
	}
	restart(): void {
		this.play();
	}
	start(presetId: string): boolean {
		this.play(presetId);
		return true;
	}

	leavePage(trigger: LeaveTrigger): BackgroundOutcome {
		this.log.push(`leave:${trigger}`);
		if (!this.playing) return 'none';
		if (this.onLeave === 'stop') this.stop(trigger === 'hidden' ? 'page_hidden' : 'page_closed');
		return this.onLeave;
	}
	applySettings(settings: Settings): void {
		this.settingsSeen = settings;
	}
	simulateLoss(): void {
		if (!this.preview) return;
		this.connection = 'lost';
		this.stop('link_lost');
	}

	private setActive(active: boolean): void {
		if (active === this.active) return;
		this.active = active;
		this.host.activeChanged(this);
	}
}

export interface FakeKind {
	kind: DeviceKind;
	/** The sessions created for this kind (one per manager). */
	sessions: FakeSession[];
}

/** A kind of device that exists only in tests. */
export function fakeKind(id: string, opts: { patterns?: string[]; settingsKey?: string } = {}): FakeKind {
	const out: FakeKind = { kind: null!, sessions: [] };
	const patterns = new Set(opts.patterns ?? []);
	out.kind = {
		id,
		name: () => `Fake ${id}`,
		...(opts.settingsKey
			? {
					settings: {
						key: opts.settingsKey,
						// A level, and an "enabled" that a file must not carry.
						sanitize: (stored: unknown) => {
							const s = (stored ?? {}) as { level?: unknown; enabled?: unknown };
							return { level: typeof s.level === 'number' ? s.level : 1, enabled: s.enabled === true };
						},
						locked: (block: unknown) => ({ ...(block as object), enabled: false }),
						// Its level is a limit: a file never raises it.
						notAbove: (block: unknown, current: unknown) => ({
							...(block as object),
							level: Math.min((block as { level: number }).level, (current as { level: number }).level)
						})
					}
				}
			: {}),
		hasPattern: (p) => patterns.has(p),
		describe: (what) => `${id}:${what}`,
		connectHints: () => [],
		lostAdvice: () => `${id} may still be running`,
		stopText: (code) => code,
		errorText: (code) => code,
		unsupportedTitle: () => 'unsupported',
		about: () => `about ${id}`,
		nowPlaying: () => ({ name: id, readout: '' }),
		showsOwnStop: () => false,
		setupOnConnect: () => false,
		summary: () => '',
		createSession: (host) => {
			const session = new FakeSession(out.kind, host);
			out.sessions.push(session);
			return session;
		}
	};
	return out;
}
