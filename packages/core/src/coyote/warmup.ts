// Warm-up ramp: every frame's strengths are multiplied by `scale`, which starts at 0 and climbs while the channel
// outputs, and decays after `downDuration` of silence. The time constant depends on intensity: at 0 the ramp takes
// `upSpeed0` seconds, at 200 `upSpeed`.
// Ported from the reference implementation (engine/warmup.py).

export interface WarmupSettings {
	upSpeed0: number;
	upSpeed: number;
	coldDownEnable: boolean;
	downDuration: number;
	downSpeed0: number;
	downSpeed: number;
}

/** The conservative values that protected mode pins. */
export const PROTECTED: Readonly<WarmupSettings> = {
	upSpeed0: 10,
	upSpeed: 60,
	coldDownEnable: true,
	downDuration: 10,
	downSpeed0: 60,
	downSpeed: 10
};

const KEYS = Object.keys(PROTECTED) as (keyof WarmupSettings)[];

function c(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export class Warmup implements WarmupSettings {
	upSpeed0 = 10;
	upSpeed = 60;
	coldDownEnable = true;
	downDuration = 10;
	downSpeed0 = 60;
	downSpeed = 10;
	scale = 0;
	/** protected mode pins the conservative values above */
	protected = false;
	private coldMs = 0;
	private backup: Partial<WarmupSettings> | null = null;

	private assign(values: Partial<WarmupSettings>): void {
		for (const k of KEYS) if (values[k] !== undefined) (this as Record<string, unknown>)[k] = values[k];
	}

	/** On: remember the user's values and force the conservative ones. Off: restore them. */
	setProtected(on: boolean): void {
		if (on) {
			if (!this.protected) this.backup = Object.fromEntries(KEYS.map((k) => [k, this[k]]));
			this.assign(PROTECTED);
		} else if (this.protected && this.backup) this.assign(this.backup);
		this.protected = Boolean(on);
	}

	/** Change settings (seconds; speeds 5..120, downDuration 1..120). An unknown key throws. While protected the
	 * values stay pinned and the request is kept for when protection is lifted. */
	configure(kw: Partial<WarmupSettings>): void {
		for (const k of Object.keys(kw))
			if (!(KEYS as string[]).includes(k)) throw new Error(`unknown warm-up setting: ${k}`);
		if (this.protected) {
			this.backup = { ...(this.backup ?? {}), ...kw };
			return;
		}
		this.assign(kw);
		const up = [c(this.upSpeed0, 5, 120), c(this.upSpeed, 5, 120)];
		this.upSpeed0 = Math.min(...up);
		this.upSpeed = Math.max(...up);
		const down = [c(this.downSpeed0, 5, 120), c(this.downSpeed, 5, 120)];
		this.downSpeed = Math.min(...down);
		this.downSpeed0 = Math.max(...down);
		this.downDuration = c(this.downDuration, 1, 120);
	}

	reset(): void {
		this.scale = 0;
		this.coldMs = 0;
	}

	tick(dtMs: number, intensity: number, silentNow: boolean, silentLastRun: boolean): number {
		const silent = silentNow && silentLastRun;
		this.coldMs = silent ? this.coldMs + dtMs : 0;
		if (this.coldDownEnable && this.coldMs >= this.downDuration * 1000 && this.scale > 0)
			this.scale -= 0.1 / ((this.downSpeed0 - this.downSpeed) * (intensity / 200) + this.downSpeed);
		else if (!silent && this.scale < 1)
			this.scale += 0.1 / ((this.upSpeed - this.upSpeed0) * (intensity / 200) + this.upSpeed0);
		this.scale = c(this.scale, 0, 1);
		return this.scale;
	}
}
