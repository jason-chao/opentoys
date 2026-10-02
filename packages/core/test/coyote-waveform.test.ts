import { describe, expect, it } from 'vitest';
import { coyote } from '../src/index.ts';
import { Rng } from '../src/rng.ts';
import { fixture, type Json } from './helpers.ts';

const {
	PulseFrame,
	WAVEFORMS,
	WAVEFORM_IDS,
	WaveformError,
	decodeFreq,
	encodeFreq,
	frames,
	parseWaveform,
	playDurationS,
	previewWaveform,
	waveformById
} = coyote;

const F = fixture('coyote/waveforms');
const R = fixture('coyote/rng');

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const render = (wf: coyote.Waveform): string =>
	frames(wf)
		.map((f) => hex(f.bytes()))
		.join('');

// Rendering is integer and plain IEEE arithmetic in the reference implementation's order (no libm functions), so every byte is
// compared exactly.
describe('conformance: Coyote waveforms', () => {
	it('has the same built-in waveforms, in the same order, as real values', () => {
		expect(WAVEFORM_IDS).toEqual(F.presets.map((p: Json) => p.id));
		expect(WAVEFORMS).toHaveLength(12);
		for (const p of F.presets) {
			const w = waveformById(p.id);
			expect([w?.name, w?.tags, w?.waveform], p.id).toEqual([p.name, p.tags, p.waveform]);
		}
	});

	it.each((F.presets as Json[]).map((p): [string, Json] => [p.id, p]))(
		'renders %s byte for byte',
		(_id, p) => {
			const wf = (waveformById(p.id) as coyote.BuiltinWaveform).waveform;
			expect(render(wf)).toBe(p.frames);
			expect(frames(wf)).toHaveLength(p.count);
			expect(playDurationS(wf)).toBe(p.play_duration_s);
		}
	);

	it.each((F.cases as Json[]).map((c): [string, Json] => [c.name, c]))(
		'renders %s byte for byte',
		(_name, c) => {
			const wf = parseWaveform(c.waveform);
			expect(wf).toEqual(c.waveform);
			if ('error' in c) {
				expect(() => frames(wf)).toThrow(WaveformError);
				expect(() => frames(wf)).toThrow(c.error);
				return;
			}
			const got = render(wf);
			if (got !== c.frames) {
				let i = 0;
				while (got.slice(i * 16, i * 16 + 16) === c.frames.slice(i * 16, i * 16 + 16)) i += 1;
				expect([i, got.slice(i * 16, i * 16 + 16)], `first mismatch at frame ${i}`).toEqual([
					i,
					c.frames.slice(i * 16, i * 16 + 16)
				]);
			}
			expect(got.length / 16).toBe(c.count);
			expect(playDurationS(wf)).toBe(c.play_duration_s);
		}
	);

	it('converts frequencies alike, both ways', () => {
		expect(F.encode_freq.map((_: number, v: number) => encodeFreq(v))).toEqual(F.encode_freq);
		expect(F.decode_freq.map((_: number, b: number) => decodeFreq(b))).toEqual(F.decode_freq);
	});

	it('packs and scales frames alike', () => {
		for (const c of F.pulse_frames) {
			const label = JSON.stringify([c.freqs, c.strengths, c.scale]);
			if ('error' in c) {
				expect(() => new PulseFrame(c.freqs, c.strengths), label).toThrow(c.error);
				continue;
			}
			const f = new PulseFrame(c.freqs, c.strengths);
			expect([hex(f.bytes(c.scale)), f.isSilent(c.scale)], label).toEqual([c.bytes, c.silent]);
		}
		expect(hex(PulseFrame.silent().bytes())).toBe(F.silent);
	});

	it('draws the same integers and choices from a seed', () => {
		for (const c of R.cases) {
			let r = new Rng(c.seed);
			expect(Array.from({ length: 8 }, () => r.nextU32())).toEqual(c.u32);
			r = new Rng(c.seed);
			for (const [lo, hi, want] of c.randint)
				expect(Array.from({ length: 12 }, () => r.randint(lo, hi))).toEqual(want);
			r = new Rng(c.seed);
			for (const [n, want] of c.choice) {
				const seq = Array.from({ length: n }, (_, i) => i);
				expect(Array.from({ length: 12 }, () => r.choice(seq))).toEqual(want);
			}
		}
	});
});

// ----- ported from the reference implementation's tests/test_waveform.py (the parts that apply to the own format) -----------------
describe('Coyote frames', () => {
	it('scales strengths rounding up, and packs 1, 2 or 4 sub-slots', () => {
		const f = new PulseFrame([10, 50], [100, 1]);
		expect(Array.from(f.bytes())).toEqual([10, 10, 50, 50, 100, 100, 1, 1]);
		expect(Array.from(f.bytes(0.5))).toEqual([10, 10, 50, 50, 50, 50, 1, 1]); // ceil keeps 1 alive
		expect(Array.from(f.bytes(0))).toEqual([10, 10, 50, 50, 0, 0, 0, 0]);
		expect(f.isSilent(0)).toBe(true);
		expect(f.isSilent(NaN)).toBe(true); // an unreadable scale is silence, never full strength
		expect(Array.from(new PulseFrame([5, 300, 10, 10], [-1, 101, 0, 0]).bytes())).toEqual([
			10, 240, 10, 10, 0, 100, 0, 0
		]);
		expect(PulseFrame.fromBytes(f.bytes()).bytes()).toEqual(f.bytes());
		expect(() => new PulseFrame([10, 10, 10], [0, 0, 0])).toThrow();
		expect(() => new PulseFrame([NaN], [0])).toThrow();
		expect(() => PulseFrame.fromBytes([1, 2, 3])).toThrow();
	});

	it('converts frequencies as the protocol defines', () => {
		for (let v = 10; v <= 100; v++) expect(decodeFreq(encodeFreq(v))).toBe(v); // lossy above 100 by design
		expect([encodeFreq(1000), encodeFreq(600), encodeFreq(101), encodeFreq(9), encodeFreq(1001)]).toEqual([
			240, 200, 100, 10, 10
		]);
		expect([decodeFreq(240), decodeFreq(200), decodeFreq(9), decodeFreq(241)]).toEqual([1000, 600, 10, 10]);
		expect(encodeFreq(NaN)).toBe(10);
	});
});

describe('Coyote waveform format', () => {
	const ok = {
		restTime: 0,
		speed: 1,
		sections: [{ freq1: 10, freq2: 100, duration: 1, mode: 1, enabled: true, points: [0] }]
	};
	const withSection = (patch: Record<string, unknown>) => ({
		...ok,
		sections: [{ ...ok.sections[0], ...patch }]
	});

	it('accepts a valid waveform and fills in defaults', () => {
		expect(parseWaveform(ok)).toEqual(ok);
		expect(
			parseWaveform({ sections: [{ freq1: 10, freq2: 10, duration: 1, mode: 1, points: [5] }] })
		).toEqual({
			restTime: 0,
			speed: 1,
			sections: [{ freq1: 10, freq2: 10, duration: 1, mode: 1, enabled: true, points: [5] }]
		});
		expect(parseWaveform(ok)).not.toBe(ok); // a copy: later changes to the input do not reach the player
	});

	it.each([
		['not an object', 'nope'],
		['null', null],
		['speed 3', { ...ok, speed: 3 }],
		['restTime 101', { ...ok, restTime: 101 }],
		['restTime -1', { ...ok, restTime: -1 }],
		['restTime 1.5', { ...ok, restTime: 1.5 }],
		['no sections', { ...ok, sections: [] }],
		['sections not a list', { ...ok, sections: {} }],
		['section not an object', { ...ok, sections: [3] }],
		['freq1 9', withSection({ freq1: 9 })],
		['freq2 1001', withSection({ freq2: 1001 })],
		['freq1 10.5', withSection({ freq1: 10.5 })],
		['freq1 text', withSection({ freq1: '10' })],
		['freq1 NaN', withSection({ freq1: NaN })],
		['duration 0', withSection({ duration: 0 })],
		['duration 3001', withSection({ duration: 3001 })],
		['mode 5', withSection({ mode: 5 })],
		['mode 0', withSection({ mode: 0 })],
		['enabled 1', withSection({ enabled: 1 })],
		['no points', withSection({ points: [] })],
		['points not a list', withSection({ points: 50 })],
		['point 101', withSection({ points: [101] })],
		['point -1', withSection({ points: [-1] })],
		['point 50.5', withSection({ points: [50.5] })],
		['point Infinity', withSection({ points: [Infinity] })]
	])('refuses %s', (_label, bad) => {
		expect(() => parseWaveform(bad)).toThrow(WaveformError);
		expect(() => frames(bad as coyote.Waveform)).toThrow(WaveformError); // the renderer never runs on bad data
	});

	it('refuses to render a waveform with no enabled section', () => {
		expect(() => frames(parseWaveform(withSection({ enabled: false })))).toThrow('no enabled section');
	});

	it('previews strength and frequency per 25 ms slot over one pass', () => {
		const tremble = (waveformById('tremble') as coyote.BuiltinWaveform).waveform;
		expect(previewWaveform(tremble)).toEqual({
			slotMs: 25,
			strength: [100, 0, 100, 0],
			freq: [50, 50, 50, 50],
			durationS: 0.1
		});
		const rising = previewWaveform((waveformById('rising-tone') as coyote.BuiltinWaveform).waveform);
		expect(rising.strength).toHaveLength(120);
		expect(rising.freq).toHaveLength(120);
		expect(rising.durationS).toBe(3);
		expect([rising.freq[0], rising.freq[119]]).toEqual([10, 100]);
		expect(rising.freq.every((f, i) => i === 0 || f >= (rising.freq[i - 1] as number))).toBe(true);
		// a high frequency is shown as the device will play it (the wire byte is coarser above 100)
		const high = previewWaveform({
			restTime: 1,
			speed: 2,
			sections: [{ freq1: 333, freq2: 333, duration: 2, mode: 1, enabled: true, points: [7, 9] }]
		});
		expect(high).toEqual({
			slotMs: 25,
			strength: [7, 7, 9, 9, 0, 0, 0, 0],
			freq: [330, 330, 330, 330, 10, 10, 10, 10],
			durationS: 0.2
		});
		for (const w of WAVEFORMS) {
			const p = previewWaveform(w.waveform);
			expect(p.strength.length, w.id).toBe(Math.round(playDurationS(w.waveform) * 40));
			expect(
				p.strength.every((s) => s >= 0 && s <= 100) && p.freq.every((f) => f >= 10 && f <= 1000),
				w.id
			).toBe(true);
			expect(
				p.strength.some((s) => s > 0),
				w.id
			).toBe(true);
		}
	});
});
