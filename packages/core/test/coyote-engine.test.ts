import { describe, expect, it } from 'vitest';
import { coyote, type CoyoteEngine, type CoyoteOut } from '../src/index.ts';
import { Rng } from '../src/rng.ts';
import { attempt, camelize, diff, fixture, type Json } from './helpers.ts';

const { ComfortLimit, CoyoteChannel, CoyoteLimits, CoyoteSession, Player, Warmup, frames, parseWaveform } =
	coyote;

const F = fixture('coyote/engine');
const WAVES: Record<string, coyote.Waveform> = Object.fromEntries(
	Object.entries(F.waveforms).map(([name, w]) => [name, parseWaveform(w)])
);

const hex = (bytes: Uint8Array | null): string | null =>
	bytes === null ? null : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const row = (o: coyote.CoyoteChannelOut): Json => [
	o.intensity,
	o.changed,
	hex(o.payload),
	o.silent,
	o.scale,
	o.cap
];

/** The session's state in the shape (and with the keys) of the fixture's "state" steps. */
function state(s: coyote.CoyoteSession): Json {
	const out: Json = {
		output_ms: s.outputMs,
		stopped_reason: s.stoppedReason,
		sync_ab: s.syncAb,
		fire_sync: s.fireSync,
		protect_mode: s.protectMode,
		mute_on_connect: s.muteOnConnect
	};
	for (const [name, c] of [
		['a', s.a],
		['b', s.b]
	] as const) {
		const w = c.warmup;
		const m = c.comfort;
		out[name] = {
			base_intensity: c.baseIntensity,
			muted: c.muted,
			player: {
				playing: c.player.playing,
				index: c.player.index,
				mode: c.player.mode,
				length: c.player.playlist.length
			},
			fire: { active: c.fire.active, target: c.fire.target, held_ms: c.fire.heldMs },
			tease: { enabled: c.tease.enabled, working: c.tease.working },
			auto: { enabled: c.auto.enabled, total_incr: c.auto.totalIncr, increasing: c.auto.increasing },
			comfort: {
				mode: m.mode,
				comfort_max: m.comfortMax,
				absolute_max: m.absoluteMax,
				overheat: m.overheat,
				overheat_pct: m.overheatPct,
				total_incr: m.totalIncr,
				auto_incr_scope: m.autoIncrScope,
				total_comfort_max: m.totalComfortMax,
				total_absolute_max: m.totalAbsoluteMax,
				max_strength: m.maxStrength
			},
			warmup: {
				scale: w.scale,
				protected: w.protected,
				up_speed0: w.upSpeed0,
				up_speed: w.upSpeed,
				cold_down_enable: w.coldDownEnable,
				down_duration: w.downDuration,
				down_speed0: w.downSpeed0,
				down_speed: w.downSpeed
			}
		};
	}
	return out;
}

function apply(s: coyote.CoyoteSession, step: Json): unknown {
	const ch = step.ch ? s.channel(step.ch) : s.a;
	switch (step.op) {
		case 'set_intensity':
			return ch.setIntensity(step.value);
		case 'add_intensity':
			return ch.addIntensity(step.delta);
		case 'adopt_device':
			return s.adoptDevice(step.ch, step.value);
		case 'play': {
			if (step.mode !== null) ch.player.mode = step.mode;
			if (step.seed !== null) ch.player.rng = new Rng(step.seed);
			const list = step.names.map((n: string) => WAVES[n]);
			if (list.length === 1 && step.mode === null) ch.player.play(list[0]);
			else ch.player.play(list, step.start_index);
			return undefined;
		}
		case 'replace_current':
			return ch.player.replaceCurrent(WAVES[step.name] as coyote.Waveform);
		case 'stop_player':
			return ch.player.stop();
		case 'stop_channel':
			return ch.stop();
		case 'mute':
			ch.muted = step.on;
			return undefined;
		case 'fire_target':
			return ch.fire.setTarget(step.value);
		case 'fire_start':
			return ch.fire.start();
		case 'fire_end':
			return ch.fire.end();
		case 'tease':
			if (step.seed !== null) ch.tease.rng = new Rng(step.seed);
			Object.assign(ch.tease, camelize(step.kw));
			if (step.reset) ch.tease.reset();
			return undefined;
		case 'auto':
			if (step.seed !== null) ch.auto.rng = new Rng(step.seed);
			Object.assign(ch.auto, camelize(step.kw));
			if (step.reset) ch.auto.reset();
			return undefined;
		case 'comfort':
			return ch.comfort.configure(camelize(step.kw));
		case 'warmup':
			return ch.warmup.configure(camelize(step.kw));
		case 'sync_ab':
			s.syncAb = step.on;
			return undefined;
		case 'fire_sync':
			return s.setFireSync(step.on);
		case 'protect':
			return s.setProtectMode(step.on);
		case 'mute_on_connect':
			return s.setMuteOnConnect(step.on);
		case 'connected':
			return s.onDeviceConnected();
		case 'stop':
			return s.stop(step.reason);
		case 'resume':
			return s.resume();
		case 'state':
			return state(s);
	}
	throw new Error(`unknown op ${step.op}`);
}

// The engine is integer and plain IEEE arithmetic in the reference implementation's order (no libm functions anywhere), so every
// tick is compared exactly: bytes, integers, and the float scale / overheat budget too. No tolerance is used.
describe('conformance: Coyote engine traces', () => {
	for (const trace of F.traces) {
		it(trace.name, () => {
			const s = new CoyoteSession(camelize(trace.limits));
			trace.steps.forEach((step: Json, n: number) => {
				const where = `${trace.name} step ${n} (${step.op})`;
				if (step.op === 'tick') {
					const outs = [...step.outs];
					for (let i = 0; i < step.n; i++) {
						const o = step.dt === null ? s.tick() : s.tick(step.dt);
						if (i % step.every === 0 || i === step.n - 1) {
							const d = diff([i, row(o.a), row(o.b), o.stopped, o.anyOutput], outs.shift());
							if (d) expect(d, `${where} tick ${i}`).toBeNull();
						}
					}
					expect(outs, where).toHaveLength(0);
					return;
				}
				const got = attempt(() => apply(s, step));
				if ('error' in step) {
					expect('error' in got, where).toBe(true);
					if (step.op === 'play') expect((got as { error: string }).error).toBe(step.error);
				} else {
					expect('ok' in got, `${where}: ${JSON.stringify(got)}`).toBe(true);
					const value = (got as { ok: unknown }).ok;
					if ('result' in step) expect(diff(value, step.result), where).toBeNull();
				}
			});
		});
	}

	it('validates and clamps limits alike', () => {
		for (const c of F.limits) {
			const got = attempt(() => new CoyoteLimits(camelize(c.kw)).validate());
			if ('error' in c) {
				expect(got, JSON.stringify(c.kw)).toEqual({ error: c.error });
				expect(() => new CoyoteSession(camelize(c.kw))).toThrow(c.error);
				continue;
			}
			const lim = (got as { ok: coyote.CoyoteLimits }).ok;
			expect([lim.absoluteMax, lim.sessionMaxS]).toEqual([c.ok.absolute_max, c.ok.session_max_s]);
			for (const [v, want] of c.ok.clamp) expect(lim.clamp(v)).toBe(want);
		}
	});
});

// ----- ported from the reference implementation's tests/test_engine.py ----------------------------------------------------------
const FULL = WAVES.full as coyote.Waveform; // one frame, strength 100
const TWO = WAVES.two as coyote.Waveform; // silent, then full

function run(ch: { tick(dt?: number): coyote.CoyoteChannelOut }, n: number): coyote.CoyoteChannelOut {
	let out = ch.tick();
	for (let i = 1; i < n; i++) out = ch.tick();
	return out;
}

describe('Coyote engine', () => {
	it('starts the warm-up at zero and ramps by intensity', () => {
		const w = new Warmup();
		expect(w.scale).toBe(0);
		let ticks = 0;
		while (w.tick(100, 0, false, false) < 1) ticks += 1;
		expect(ticks).toBeGreaterThanOrEqual(99);
		expect(ticks).toBeLessThanOrEqual(101); // 0.1/10 per tick at intensity 0 → 10 s
		const w2 = new Warmup();
		let t2 = 0;
		while (w2.tick(100, 200, false, false) < 1) t2 += 1;
		expect(t2).toBeGreaterThanOrEqual(590);
		expect(t2).toBeLessThanOrEqual(610); // at intensity 200 the ramp takes upSpeed = 60 s
	});

	it('lets the warm-up decay after silence', () => {
		const w = new Warmup();
		w.scale = 1;
		for (let i = 0; i < 105; i++) w.tick(100, 0, true, true);
		expect(w.scale).toBeLessThan(1);
	});

	it('scales and caps a channel frame', () => {
		const ch = new CoyoteChannel('A', new CoyoteLimits({ absoluteMax: 40 }));
		ch.player.play(FULL);
		ch.setIntensity(90);
		let out = ch.tick();
		expect([out.intensity, out.changed]).toEqual([40, true]);
		expect(Array.from((out.payload as Uint8Array).slice(4))).toEqual([1, 1, 1, 1]); // ceil(100 × small scale)
		out = run(ch, 200);
		expect(Array.from(out.payload as Uint8Array)).toEqual([30, 30, 30, 30, 100, 100, 100, 100]);
	});

	it('mutes and stops', () => {
		const ch = new CoyoteChannel();
		ch.player.play(FULL);
		ch.setIntensity(10);
		ch.muted = true;
		expect(ch.tick().payload).toBeNull();
		ch.muted = false;
		ch.stop();
		const out = ch.tick();
		expect([out.payload, out.intensity, out.silent, ch.warmup.scale]).toEqual([null, 0, true, 0]);
	});

	it('drops the ceiling on overheat, then recovers', () => {
		const c = new ComfortLimit({ comfortMax: 20, absoluteMax: 60, upSpeed: 2, overheatDuration: 1 });
		for (let i = 0; i < 19; i++) c.tick(100, 50, false);
		expect([c.overheat, c.maxStrength]).toEqual([false, 60]);
		c.tick(100, 50, false);
		expect([c.overheat, c.maxStrength]).toEqual([true, 20]);
		for (let i = 0; i < 10; i++) c.tick(100, 50, false);
		expect([c.overheat, c.maxStrength]).toEqual([false, 60]);
	});

	it('raises and lowers the comfort ceilings automatically', () => {
		const c = new ComfortLimit({
			autoIncr: true,
			autoIncrMax: 3,
			incrTime: 1,
			decrTime: 1,
			comfortMax: 10,
			absoluteMax: 20
		});
		for (let i = 0; i < 35; i++) c.tick(100, 5, false);
		expect([c.totalIncr, c.totalAbsoluteMax, c.totalComfortMax]).toEqual([3, 23, 13]);
		for (let i = 0; i < 35; i++) c.tick(100, 5, true);
		expect(c.totalIncr).toBe(0);
	});

	it('fires over the base intensity, on both channels when synced', () => {
		const s = new CoyoteSession({ absoluteMax: 100 });
		s.a.setIntensity(5);
		s.b.setIntensity(5);
		s.setFireSync(true);
		s.a.fire.setTarget(50);
		s.a.fire.start();
		let o = s.tick();
		expect([o.a.intensity, o.b.intensity]).toEqual([50, 50]);
		s.a.fire.end();
		o = s.tick();
		expect([o.a.intensity, o.b.intensity]).toEqual([5, 5]);
	});

	it('does not adopt a device report while Fire is held, and keeps B on A when synced', () => {
		const s = new CoyoteSession();
		s.a.setIntensity(20);
		s.a.fire.setTarget(60);
		s.a.fire.start();
		expect(s.adoptDevice('a', 60)).toBe(20); // the burst level is ours: the base stays
		expect(s.a.baseIntensity).toBe(20);
		s.a.fire.end();
		expect(s.adoptDevice('a', 35)).toBe(35); // a dial turn
		s.syncAb = true;
		s.adoptDevice('a', 40);
		expect(s.b.baseIntensity).toBe(40);
	});

	it('never fires above the cap', () => {
		const s = new CoyoteSession({ absoluteMax: 30 });
		s.a.fire.setTarget(200);
		s.a.fire.start();
		const o = s.tick();
		expect([o.a.intensity, o.a.cap]).toEqual([30, 30]);
	});

	it('releases a held fire by itself after 15 s; sync works both ways', () => {
		const s = new CoyoteSession({ absoluteMax: 100 });
		s.a.setIntensity(3);
		s.b.setIntensity(4);
		s.setFireSync(true);
		expect(s.fireSync).toBe(true);
		s.b.fire.setTarget(40);
		s.b.fire.start();
		let o = s.tick();
		expect([o.a.intensity, o.b.intensity]).toEqual([40, 40]);
		for (let i = 0; i < 151; i++) o = s.tick(); // 15 s hold limit
		expect([s.a.fire.active, s.b.fire.active, o.a.intensity, o.b.intensity]).toEqual([false, false, 3, 4]);
		s.setFireSync(false);
		s.a.fire.start();
		o = s.tick();
		expect([o.a.intensity, o.b.intensity]).toEqual([s.a.fire.target, 4]);
	});

	it('alternates work and pause when teasing', () => {
		const ch = new CoyoteChannel();
		ch.player.play(FULL);
		ch.setIntensity(10);
		Object.assign(ch.tease, {
			enabled: true,
			workingFixed: true,
			pauseFixed: true,
			workingRange: [1, 1],
			pauseRange: [1, 1]
		});
		ch.tease.reset();
		const seq = Array.from({ length: 25 }, () => ch.tick().payload !== null);
		expect(seq.slice(0, 10)).toEqual(Array(10).fill(true));
		expect(seq.slice(10, 20)).toEqual(Array(10).fill(false));
		expect(seq[20]).toBe(true);
	});

	it('plays playlists in each mode, and hot-swaps', () => {
		const p = new Player();
		p.play([FULL, TWO]);
		expect(Array.from({ length: 4 }, () => p.nextFrame()?.strengths[0])).toEqual([100, 0, 100, 100]);
		p.replaceCurrent(TWO);
		expect(frames(p.current as coyote.Waveform)).toHaveLength(2);
		p.mode = 'repeat';
		p.play([FULL, TWO], 1);
		expect(Array.from({ length: 4 }, () => p.nextFrame()?.strengths[0])).toEqual([0, 100, 0, 100]);
		p.mode = 'random';
		p.play([FULL, TWO, FULL]);
		const seen: number[] = [];
		for (let i = 0; i < 60; i++) {
			p.nextFrame();
			seen.push(p.index);
		}
		expect(new Set(seen)).toEqual(new Set([0, 1, 2]));
	});

	it('refuses to play nothing or an invalid waveform, and keeps what was playing', () => {
		const p = new Player();
		expect(() => p.play()).toThrow('nothing to play');
		expect(() => p.play([])).toThrow('nothing to play');
		p.play(FULL);
		const bad = {
			restTime: 0,
			speed: 1,
			sections: [{ freq1: 10, freq2: 10, duration: 1, mode: 1, enabled: true, points: [] }]
		};
		expect(() => p.play(bad as coyote.Waveform)).toThrow(coyote.WaveformError);
		expect(() => p.replaceCurrent(bad as coyote.Waveform)).toThrow(coyote.WaveformError);
		expect([p.playing, p.current]).toEqual([true, FULL]);
		expect(p.nextFrame()?.strengths[0]).toBe(100);
	});

	it('escalates slowly with auto-increase', () => {
		const ch = new CoyoteChannel();
		ch.player.play(FULL);
		ch.setIntensity(10);
		Object.assign(ch.auto, { enabled: true, timeMin: 1, timeMax: 1, intensityMax: 2 });
		expect(run(ch, 35).intensity).toBe(12);
	});

	it('stops output at the session maximum', () => {
		const s = new CoyoteSession({ sessionMaxS: 60 });
		s.a.player.play(FULL);
		s.a.setIntensity(10);
		let o = s.tick();
		for (let i = 1; i < 601; i++) o = s.tick();
		expect([o.stopped, o.a.payload, o.a.intensity, o.anyOutput]).toEqual(['session_max', null, 0, false]);
		expect(s.busy).toBe(false);
	});

	it('validates limits', () => {
		expect(() => new CoyoteLimits({ absoluteMax: 0 }).validate()).toThrow();
		expect(() => new CoyoteLimits({ sessionMaxS: 10 }).validate()).toThrow();
		expect(() => new CoyoteLimits({ absoluteMax: 50.5 }).validate()).toThrow();
		expect(() => new CoyoteLimits({ absoluteMax: NaN }).validate()).toThrow();
	});

	// ----- beyond the reference implementation's tests: the contract with the output loop and the app ---------------------------
	it('has the tick shape the output loop is written against', () => {
		const s: CoyoteEngine = new CoyoteSession();
		const o: CoyoteOut = s.tick(100);
		expect(Object.keys(o).sort()).toEqual(['a', 'anyOutput', 'b', 'stopped']);
		expect(Object.keys(o.a).sort()).toEqual(['cap', 'changed', 'intensity', 'payload', 'scale', 'silent']);
		expect(o).toEqual({
			a: { intensity: 0, changed: false, payload: null, silent: true, scale: 0, cap: 100 },
			b: { intensity: 0, changed: false, payload: null, silent: true, scale: 0, cap: 100 },
			stopped: null,
			anyOutput: false
		});
	});

	it('gives the payload as 8 wire bytes after the warm-up scale', () => {
		const s = new CoyoteSession();
		s.a.player.play(FULL);
		s.a.setIntensity(20);
		const o = s.tick();
		expect(o.a.payload).toBeInstanceOf(Uint8Array);
		expect(o.a.payload).toHaveLength(8);
		expect(Array.from(o.a.payload as Uint8Array)).toEqual([30, 30, 30, 30, 1, 1, 1, 1]);
		expect([o.a.silent, o.anyOutput, o.b.payload]).toEqual([false, true, null]);
	});

	it('is busy while something plays or an intensity is above 0', () => {
		const s = new CoyoteSession();
		expect(s.busy).toBe(false);
		s.b.setIntensity(1);
		expect(s.busy).toBe(true);
		s.b.setIntensity(0);
		expect(s.busy).toBe(false);
		s.a.player.play(FULL);
		expect(s.busy).toBe(true); // playing, even at intensity 0
		s.a.player.stop();
		s.a.fire.start();
		expect(s.busy).toBe(true);
		s.a.fire.end();
		expect(s.busy).toBe(false);
	});

	it('stops everything at once and starts again from zero', () => {
		const s = new CoyoteSession();
		s.a.player.play(FULL);
		s.b.player.play(TWO);
		s.a.setIntensity(50);
		s.b.setIntensity(60);
		s.b.fire.start();
		for (let i = 0; i < 100; i++) s.tick();
		expect(s.busy).toBe(true);
		s.stop('user');
		expect([s.busy, s.b.fire.active, s.a.warmup.scale, s.b.warmup.scale]).toEqual([false, false, 0, 0]);
		const o = s.tick();
		const silent = { intensity: 0, changed: true, payload: null, silent: true, cap: 100 };
		expect(o).toMatchObject({ a: silent, b: silent, stopped: 'user', anyOutput: false });
		for (let i = 0; i < 30; i++) s.tick();
		// As in the reference implementation, the scale drifts up for the ten ticks it takes a channel to count as idle (to 0.1 at
		// most, with nothing output), so a restart begins near zero rather than at exactly zero.
		expect(s.a.warmup.scale).toBeGreaterThan(0);
		expect(s.a.warmup.scale).toBeLessThanOrEqual(0.1 + 1e-12);
		s.resume();
		expect([s.tick().stopped, s.outputMs]).toEqual([null, 0]);
		s.a.player.play(FULL);
		s.a.setIntensity(50);
		const strengths = Array.from(s.tick().a.payload as Uint8Array).slice(4);
		expect(Math.max(...strengths)).toBeLessThanOrEqual(11); // warm-up again
	});

	it('follows the device dial, never above the cap', () => {
		const s = new CoyoteSession({ absoluteMax: 80 });
		expect(s.adoptDevice('a', 30)).toBe(30);
		expect(s.adoptDevice('b', 200)).toBe(80);
		expect(s.adoptDevice('a', NaN)).toBe(0);
		expect([s.a.baseIntensity, s.b.baseIntensity]).toEqual([0, 80]);
	});

	it('treats unreadable intensities as 0', () => {
		const ch = new CoyoteChannel();
		ch.setIntensity(40);
		expect(ch.setIntensity(NaN)).toBe(0);
		ch.setIntensity(40);
		expect(ch.setIntensity(Infinity)).toBe(0);
		ch.setIntensity(40);
		expect(ch.addIntensity(NaN)).toBe(40);
		ch.fire.setTarget(NaN);
		expect(ch.fire.target).toBe(1);
	});

	it('changes limits only to valid values, and lowers intensities with the cap', () => {
		const s = new CoyoteSession();
		s.a.setIntensity(90);
		expect(() => s.setLimits({ absoluteMax: 201 })).toThrow();
		expect(() => s.setLimits({ sessionMaxS: 5 })).toThrow();
		expect([s.limits.absoluteMax, s.limits.sessionMaxS]).toEqual([100, 3600]);
		s.setLimits({ absoluteMax: 50 });
		expect([s.a.baseIntensity, s.tick().a.cap, s.limits.sessionMaxS]).toEqual([50, 50, 3600]);
		s.setLimits({ absoluteMax: 200 });
		expect(s.a.setIntensity(150)).toBe(150);
		expect(s.tick().a.intensity).toBe(100); // the comfort ceiling (default 100) is a separate, lower layer
		s.a.comfort.configure({ absoluteMax: 200, comfortMax: 200 });
		expect(s.tick().a.intensity).toBe(150);
	});

	it('never commands above the cap or the device maximum, whatever the producers ask', () => {
		const rng = new Rng(99);
		const s = new CoyoteSession({ absoluteMax: 120 });
		for (const c of s.channels()) {
			c.comfort.configure({
				absoluteMax: 200,
				comfortMax: 150,
				autoIncr: true,
				autoIncrMax: 50,
				incrTime: 1
			});
			c.player.play([FULL, TWO, WAVES.sweep as coyote.Waveform, WAVES.fast as coyote.Waveform]);
			Object.assign(c.auto, { enabled: true, timeMin: 1, timeMax: 1, intensityMax: 100 });
		}
		for (let i = 0; i < 3000; i++) {
			const c = s.channel(rng.choice(['a', 'b'] as const));
			const what = rng.randint(0, 5);
			if (what === 0) c.setIntensity(rng.randint(-50, 400));
			else if (what === 1) c.addIntensity(rng.randint(-30, 60));
			else if (what === 2) c.adoptDevice(rng.randint(0, 255));
			else if (what === 3) {
				c.fire.setTarget(rng.randint(0, 300));
				c.fire.start();
			} else if (what === 4) c.fire.end();
			const o = s.tick();
			for (const x of [o.a, o.b]) {
				expect(x.intensity >= 0 && x.intensity <= 120 && x.cap <= 120 && x.scale >= 0 && x.scale <= 1).toBe(
					true
				);
				if (x.payload) expect(Array.from(x.payload.slice(4)).every((v) => v <= 100)).toBe(true);
			}
		}
	});
});
