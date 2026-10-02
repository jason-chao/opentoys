// A stand-in for core's Session in the device-layer tests: a manual source with the parts of the reference implementation's
// pipeline the controller interacts with (e-stim rise limit, suppress_estim's ≤ 1 s fade with wantEstim 0,
// session max). Not a safety pipeline: the app uses packages/core.
import type { Out, OutputEngine } from '../controller/controller.ts';

const ESTIM_FADE_PER_S = 1;

export class TestEngine implements OutputEngine {
	source: { name: string; vib: number; estim: number } | null = null;
	stoppedReason: string | null = null;
	estimSuppressed = false;
	outVib = 0;
	outEstim = 0;
	outputMs = 0;
	readonly dts: number[] = [];
	estimRisePerS: number;
	sessionMaxMs: number;

	constructor(opts: { estimRisePerS?: number; sessionMaxMs?: number } = {}) {
		this.estimRisePerS = opts.estimRisePerS ?? Infinity;
		this.sessionMaxMs = opts.sessionMaxMs ?? Infinity;
	}

	setManual(vib: number, estim: number): void {
		if (this.source === null) {
			this.outputMs = 0;
			this.source = { name: 'manual', vib, estim };
		} else {
			this.source.vib = vib;
			this.source.estim = estim;
		}
		this.estimSuppressed = false;
	}

	suppressEstim(): boolean {
		if (this.source === null || this.estimSuppressed) return false;
		this.estimSuppressed = true;
		this.source.estim = 0;
		return true;
	}

	stop(reason: string): void {
		this.source = null;
		this.stoppedReason = reason;
		this.estimSuppressed = false;
		this.outVib = this.outEstim = 0;
	}

	tick(dtMs: number): Out {
		this.dts.push(dtMs);
		const src = this.source;
		if (src === null) return out('none', 0, 0, 0, 0, this.stoppedReason);
		let we = src.estim;
		const v = src.vib;
		let e = we;
		if (this.estimSuppressed) {
			we = 0;
			e = Math.max(0, this.outEstim - (ESTIM_FADE_PER_S * dtMs) / 1000);
		} else if (e > this.outEstim) e = Math.min(e, this.outEstim + (this.estimRisePerS * dtMs) / 1000);
		this.outVib = v;
		this.outEstim = e;
		const o = out(src.name, src.vib, we, v, e, null);
		if (o.live) {
			this.outputMs += dtMs;
			if (this.outputMs >= this.sessionMaxMs) {
				this.stop('session_max');
				return out('none', src.vib, we, 0, 0, 'session_max');
			}
		}
		return o;
	}
}

function out(source: string, wv: number, we: number, v: number, e: number, stopped: string | null): Out {
	const live = Math.trunc(v * 255) > 0 || Math.trunc(e * 255) > 0;
	return { source, wantVib: wv, wantEstim: we, vib: v, estim: e, warm: 1, stopped, live };
}
