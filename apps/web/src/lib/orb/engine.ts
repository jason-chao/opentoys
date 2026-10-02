// Runs one living orb on a canvas: WebGL (OGL) when available, else Canvas 2D. It reads the output level every
// frame, smooths it like a motor would (quick rise, softer fall), pauses when the page or the canvas is hidden,
// and slows to a calm, near-static glow under prefers-reduced-motion.
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import type { OrbLevels } from './levels';
import { fragments, vertex, type OrbVariant } from './shaders';

export type { OrbVariant };

/** What the orb shows (lib/orb/levels.ts works it out from everything that is playing). */
export type Level = OrbLevels;

/** Colours as hex: deep, mid, bright, highlight, and one per thread set (the ring's e-stim, Coyote A, B). */
export interface OrbPalette {
	c0: string;
	c1: string;
	c2: string;
	c3: string;
	fil: string;
	filA: string;
	filB: string;
	/** 1 on light backgrounds (adds a soft contact shadow where the direction supports it). */
	light?: number;
}

export interface OrbOptions {
	variant: OrbVariant;
	read: () => Level;
	palette: OrbPalette;
	/** Orb radius as a fraction of the canvas's shorter side. */
	radius?: number;
	/** Offset of the centre, in units of the shorter side (x right, y up). */
	center?: [number, number];
}

export interface OrbHandle {
	setPalette(palette: OrbPalette): void;
	setLayout(radius: number, center: [number, number]): void;
	destroy(): void;
	readonly mode: 'webgl' | 'canvas';
}

const hex = (h: string): [number, number, number] => {
	const n = parseInt(h.replace('#', ''), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function webglAvailable(): boolean {
	try {
		const probe = document.createElement('canvas');
		return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
	} catch {
		return false;
	}
}

/** Smoothed levels plus a "kick" envelope for sudden rises (drives ripples and rings). */
class Follower {
	vib = 0;
	/** The three thread sets, smoothed, and how far each has come round in its shimmer (radians). */
	threads: [number, number, number] = [0, 0, 0];
	phase: [number, number, number] = [0, 0, 0];
	breath = 0;
	kick = 0;
	rings: number[] = [-1, -1, -1];
	#nextRing = 0;
	#sinceRing = 1;

	step(level: Level, dt: number, calm: boolean) {
		const k = (tau: number) => 1 - Math.exp(-dt / tau);
		const tv = level.body;
		const rising = tv > this.vib;
		const before = this.vib;
		this.vib += (tv - this.vib) * k(calm ? 1.6 : rising ? 0.06 : 0.18);
		for (let i = 0; i < 3; i++) {
			this.threads[i] += (level.threads[i] - this.threads[i]) * k(calm ? 1.6 : 0.22);
			// Calm: no shimmer at all. The phase is kept small so it stays exact over a long session.
			if (!calm) this.phase[i] = (this.phase[i] + dt * 2 * Math.PI * level.flicker[i]) % (2 * Math.PI);
		}
		this.breath += (level.breath - this.breath) * k(calm ? 1.2 : 0.25);
		const rise = Math.max(0, this.vib - before) / Math.max(dt, 1e-3);
		this.kick = Math.max(this.kick * Math.exp(-dt / 0.35), Math.min(1, rise * 0.25));
		// A new ring on each clear onset, at most every 250 ms.
		this.#sinceRing += dt;
		for (let i = 0; i < 3; i++)
			if (this.rings[i] >= 0) this.rings[i] = this.rings[i] > 3 ? -1 : this.rings[i] + dt;
		if (!calm && rise > 1.2 && this.#sinceRing > 0.25) {
			this.rings[this.#nextRing] = 0;
			this.#nextRing = (this.#nextRing + 1) % 3;
			this.#sinceRing = 0;
		}
		if (calm) this.rings = [-1, -1, -1];
	}
}

export function createOrb(canvas: HTMLCanvasElement, options: OrbOptions): OrbHandle {
	let palette = options.palette;
	let radius = options.radius ?? 0.3;
	let center = options.center ?? [0, 0];
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	const follower = new Follower();
	let time = Math.random() * 40;
	let last = performance.now();
	let raf = 0;
	let visible = true;
	let onScreen = true;
	let destroyed = false;
	let lastFrame = 0;
	// OGL pins the canvas's CSS size, so measure the element that holds it.
	const host = canvas.parentElement ?? canvas;

	const dpr = () => {
		// Cap the pixel count: the orb is soft, so ~1.5x is plenty and keeps phones cool.
		const base = Math.min(window.devicePixelRatio || 1, 2);
		const area = host.clientWidth * host.clientHeight;
		const budget = 1_100_000;
		return Math.max(1, Math.min(base, Math.sqrt(budget / Math.max(area, 1))));
	};

	let renderer: Renderer | undefined;
	let program: Program | undefined;
	let mesh: Mesh | undefined;
	let ctx2d: CanvasRenderingContext2D | null = null;
	let mode: 'webgl' | 'canvas' = 'canvas';

	const setupWebgl = () => {
		renderer = new Renderer({
			canvas,
			dpr: dpr(),
			alpha: true,
			premultipliedAlpha: true,
			antialias: false,
			depth: false,
			powerPreference: 'low-power'
		});
		const gl = renderer.gl;
		gl.clearColor(0, 0, 0, 0);
		program = new Program(gl, {
			vertex,
			fragment: fragments[options.variant],
			transparent: true,
			depthTest: false,
			depthWrite: false,
			uniforms: {
				uRes: { value: [1, 1] },
				uTime: { value: 0 },
				uVib: { value: 0 },
				uThreads: { value: [0, 0, 0] },
				uPhase: { value: [0, 0, 0] },
				uKick: { value: 0 },
				uBreath: { value: 0 },
				uRadius: { value: radius },
				uCenter: { value: center },
				uLight: { value: palette.light ?? 0 },
				uC0: { value: hex(palette.c0) },
				uC1: { value: hex(palette.c1) },
				uC2: { value: hex(palette.c2) },
				uC3: { value: hex(palette.c3) },
				uFil: { value: hex(palette.fil) },
				uFilA: { value: hex(palette.filA) },
				uFilB: { value: hex(palette.filB) },
				uRings: { value: [-1, -1, -1] }
			}
		});
		// Premultiplied output: blend "over" correctly on any page background.
		program.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
		mode = 'webgl';
	};

	const fallback = () => {
		renderer = undefined;
		program = undefined;
		mesh = undefined;
		ctx2d = canvas.getContext('2d');
		mode = 'canvas';
		resize();
	};

	const onLost = (e: Event) => {
		e.preventDefault();
		// A fresh canvas can't be swapped in from here, so the 2D path takes over only if the context allows it.
		fallback();
	};

	if (webglAvailable()) {
		try {
			setupWebgl();
			canvas.addEventListener('webglcontextlost', onLost);
		} catch {
			fallback();
		}
	} else {
		fallback();
	}

	function resize() {
		const w = Math.max(1, host.clientWidth);
		const h = Math.max(1, host.clientHeight);
		if (renderer) {
			renderer.dpr = dpr();
			renderer.setSize(w, h);
			if (program) program.uniforms.uRes.value = [canvas.width, canvas.height];
		} else {
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			canvas.width = Math.round(w * ratio);
			canvas.height = Math.round(h * ratio);
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
		}
	}

	const draw2d = (t: number) => {
		if (!ctx2d) return;
		const c = ctx2d;
		const W = canvas.width;
		const H = canvas.height;
		const s = Math.min(W, H);
		const cx = W / 2 + center[0] * s;
		const cy = H / 2 - center[1] * s;
		const f = follower;
		const R = radius * s * (1 + 0.07 * f.breath + 0.09 * f.vib + 0.03 * f.kick);
		c.clearRect(0, 0, W, H);
		// Halo
		const halo = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.2);
		halo.addColorStop(0, rgba(palette.c2, 0.28 + 0.4 * f.vib + 0.15 * f.breath));
		halo.addColorStop(1, rgba(palette.c1, 0));
		c.fillStyle = halo;
		c.fillRect(0, 0, W, H);
		// Body: a softly wobbling outline
		c.beginPath();
		const steps = 72;
		for (let i = 0; i <= steps; i++) {
			const a = (i / steps) * Math.PI * 2;
			const wob =
				0.035 * Math.sin(a * 3 + t * 0.7) +
				0.025 * Math.sin(a * 5 - t * 0.9 + 1.3) +
				f.vib * 0.04 * Math.sin(a * 7 + t * 3.1);
			const rr = R * (1 + wob);
			const x = cx + Math.cos(a) * rr;
			const y = cy + Math.sin(a) * rr;
			if (i === 0) c.moveTo(x, y);
			else c.lineTo(x, y);
		}
		const body = c.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.05);
		body.addColorStop(0, palette.c3);
		body.addColorStop(0.35, palette.c2);
		body.addColorStop(0.75, palette.c1);
		body.addColorStop(1, palette.c0);
		c.fillStyle = body;
		c.fill();
		// E-stim: a few fine threads per set, each set in its own colour
		const colours = [palette.fil, palette.filA, palette.filB];
		if (f.threads.some((v) => v > 0.01)) {
			c.save();
			c.clip();
			c.lineWidth = Math.max(1.5, s / 300);
			for (let set = 0; set < 3; set++) {
				const level = f.threads[set];
				if (level <= 0.01) continue;
				const shimmer = 0.8 + 0.2 * Math.sin(f.phase[set]);
				c.strokeStyle = rgba(colours[set], Math.min(1, level * 1.1 * shimmer));
				for (let k = 0; k < 4; k++) {
					const a0 = k * 1.57 + set * 0.52 + t * 0.3;
					c.beginPath();
					c.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
					c.quadraticCurveTo(
						cx + Math.cos(a0 * 1.7 + t + set) * R * 0.4,
						cy + Math.sin(a0 * 1.3 - t + set) * R * 0.4,
						cx + Math.cos(a0 + 2.4) * R,
						cy + Math.sin(a0 + 2.4) * R
					);
					c.stroke();
				}
			}
			c.restore();
		}
	};

	const frame = (now: number) => {
		raf = 0;
		if (destroyed) return;
		const calm = motion.matches;
		// Reduced motion: ~12 fps and a very slow clock; otherwise every frame.
		if (calm && now - lastFrame < 80) {
			schedule();
			return;
		}
		lastFrame = now;
		const dt = Math.min(0.1, (now - last) / 1000);
		last = now;
		time += dt * (calm ? 0.06 : 1);
		const level = options.read();
		follower.step(level, dt, calm);
		if (renderer && program && mesh) {
			const u = program.uniforms;
			u.uTime.value = time;
			u.uVib.value = calm ? follower.vib * 0.5 : follower.vib;
			u.uThreads.value = follower.threads.map((v) => (calm ? v * 0.6 : v));
			u.uPhase.value = follower.phase;
			u.uKick.value = calm ? 0 : follower.kick;
			u.uBreath.value = follower.breath;
			u.uRings.value = follower.rings;
			renderer.render({ scene: mesh });
		} else {
			draw2d(time);
		}
		schedule();
	};

	function schedule() {
		if (!raf && visible && onScreen && !destroyed) raf = requestAnimationFrame(frame);
	}

	const onVisibility = () => {
		visible = document.visibilityState === 'visible';
		last = performance.now();
		schedule();
	};
	document.addEventListener('visibilitychange', onVisibility);

	const ro = new ResizeObserver(() => resize());
	ro.observe(host);
	const io = new IntersectionObserver((entries) => {
		onScreen = entries.some((e) => e.isIntersecting);
		last = performance.now();
		schedule();
	});
	io.observe(canvas);
	resize();
	schedule();

	return {
		get mode() {
			return mode;
		},
		setPalette(next) {
			palette = next;
			if (program) {
				const u = program.uniforms;
				u.uC0.value = hex(next.c0);
				u.uC1.value = hex(next.c1);
				u.uC2.value = hex(next.c2);
				u.uC3.value = hex(next.c3);
				u.uFil.value = hex(next.fil);
				u.uFilA.value = hex(next.filA);
				u.uFilB.value = hex(next.filB);
				u.uLight.value = next.light ?? 0;
			}
		},
		setLayout(r, c) {
			radius = r;
			center = c;
			if (program) {
				program.uniforms.uRadius.value = r;
				program.uniforms.uCenter.value = c;
			}
		},
		destroy() {
			destroyed = true;
			if (raf) cancelAnimationFrame(raf);
			document.removeEventListener('visibilitychange', onVisibility);
			canvas.removeEventListener('webglcontextlost', onLost);
			ro.disconnect();
			io.disconnect();
			renderer?.gl.getExtension('WEBGL_lose_context')?.loseContext();
		}
	};
}

function rgba(h: string, a: number): string {
	const [r, g, b] = hex(h);
	return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.max(0, Math.min(1, a))})`;
}
