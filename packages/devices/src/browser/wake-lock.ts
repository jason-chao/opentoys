// Screen Wake Lock while output is live, so the phone does not lock mid-session. The browser releases the lock
// whenever the page is hidden; it is requested again when the page becomes visible and output is still live.

export interface WakeLockSentinelLike {
	release(): Promise<void>;
	addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockLike {
	request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export class WakeLockKeeper {
	private sentinel: WakeLockSentinelLike | null = null;
	private pending = false;
	private wanted = false;
	private readonly api: WakeLockLike | undefined;
	private readonly isVisible: () => boolean;
	private readonly onError: (e: unknown) => void;

	constructor(
		api: WakeLockLike | undefined,
		isVisible: () => boolean,
		onError: (e: unknown) => void = () => {}
	) {
		this.api = api;
		this.isVisible = isVisible;
		this.onError = onError;
	}

	get supported(): boolean {
		return this.api !== undefined;
	}
	get held(): boolean {
		return this.sentinel !== null;
	}

	/** Hold the lock (when possible) while `want` is true. */
	set(want: boolean): Promise<void> {
		this.wanted = want;
		return want ? this.acquire() : this.release();
	}

	/** The page became visible again: re-acquire if still wanted. */
	visible(): Promise<void> {
		return this.acquire();
	}

	private async acquire(): Promise<void> {
		if (!this.api || !this.wanted || this.sentinel || this.pending || !this.isVisible()) return;
		this.pending = true;
		try {
			const s = await this.api.request('screen');
			if (!this.wanted) {
				await s.release();
				return;
			}
			this.sentinel = s;
			s.addEventListener('release', () => {
				if (this.sentinel === s) this.sentinel = null;
			});
		} catch (e) {
			this.onError(e); // e.g. NotAllowedError when the page is hidden or battery saver is on
		} finally {
			this.pending = false;
		}
	}

	private async release(): Promise<void> {
		const s = this.sentinel;
		this.sentinel = null;
		if (s) await s.release().catch((e: unknown) => this.onError(e));
	}
}
