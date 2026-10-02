// Waveform playback for one channel: a single waveform on loop, or a playlist.
// Ported from the reference implementation (engine/player.py).

import { Rng, randomSeed } from '../rng.ts';
import type { PulseFrame } from './frame.ts';
import { frames, type Waveform } from './waveform.ts';

/** next: advance through the playlist, wrap around · random: pick another entry after each pass ·
 * repeat: loop the current entry */
export type PlayMode = 'next' | 'random' | 'repeat';
export const PLAY_MODES: readonly PlayMode[] = ['next', 'random', 'repeat'];

export class Player {
	playlist: Waveform[] = [];
	mode: PlayMode = 'next';
	index = -1;
	playing = false;
	rng: Rng;
	private frames: PulseFrame[] = [];
	private pos = 0;

	constructor(rng?: Rng) {
		this.rng = rng ?? new Rng(randomSeed());
	}

	/** Play one waveform on loop, or a playlist from `startIndex`; with nothing given, the playlist it already
	 * has. An invalid waveform throws WaveformError and leaves the player as it was. */
	play(what: Waveform | readonly Waveform[] | null = null, startIndex = 0): void {
		let playlist = this.playlist;
		if (Array.isArray(what)) playlist = [...(what as readonly Waveform[])];
		else if (what !== null) {
			playlist = [what as Waveform];
			startIndex = 0;
		}
		if (playlist.length === 0) throw new Error('nothing to play');
		const index = Math.max(0, Math.min(playlist.length - 1, Math.trunc(startIndex) || 0));
		const rendered = frames(playlist[index] as Waveform);
		this.playlist = playlist;
		this.index = index;
		this.frames = rendered;
		this.pos = 0;
		this.playing = true;
	}

	stop(): void {
		this.playing = false;
		this.frames = [];
		this.pos = 0;
	}

	/** Hot-swap the waveform being played without restarting the loop. */
	replaceCurrent(waveform: Waveform): void {
		if (this.playlist.length === 0) {
			this.play(waveform);
			return;
		}
		const rendered = frames(waveform);
		this.playlist[this.index] = waveform;
		this.pos = rendered.length ? this.pos % rendered.length : 0;
		this.frames = rendered;
	}

	private load(): void {
		this.frames = frames(this.playlist[this.index] as Waveform);
		this.pos = 0;
	}

	private advance(): void {
		const n = this.playlist.length;
		if (this.mode === 'random' && n > 1) {
			const others: number[] = [];
			for (let i = 0; i < n; i++) if (i !== this.index) others.push(i);
			this.index = this.rng.choice(others);
		} else if (this.mode === 'next') this.index = (this.index + 1) % n;
		this.load();
	}

	nextFrame(): PulseFrame | null {
		if (!this.playing || this.frames.length === 0) return null;
		if (this.pos >= this.frames.length) this.advance();
		const f = this.frames[this.pos] as PulseFrame;
		this.pos += 1;
		return f;
	}

	get current(): Waveform | null {
		return this.playing && this.playlist.length ? (this.playlist[this.index] as Waveform) : null;
	}
}
