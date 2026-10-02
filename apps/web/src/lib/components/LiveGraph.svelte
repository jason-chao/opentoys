<script lang="ts">
	// A rolling graph of what was actually sent over the last seconds: vibration as a solid line with a soft
	// fill, e-stim dashed, "now" at the right edge. Decorative for screen readers (the numbers above it are the
	// readout). It stops drawing while the page is hidden, and under reduced motion it moves in steps.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { duration } from '$lib/app/format';
	import { token } from '$lib/app/theme';
	import type { Trace } from '$lib/app/trace';

	// What was sent: the device session's own buffer (not reactive, read while drawing).
	// `tone` says what the lines are: 'ring' = vibration (solid, filled) and e-stim (dashed); 'estim' = one
	// e-stim channel's pattern strength (solid, filled) and its intensity (dashed).
	// `lane` shows only one of the two lines (the ring's rows on Control each show their own). `mini` is the
	// small strip in a row: no axis, lower.
	interface Props {
		trace: Trace;
		tone?: 'ring' | 'estim';
		lane?: 'both' | 'first' | 'second';
		mini?: boolean;
	}
	let { trace, tone = 'ring', lane = 'both', mini = false }: Props = $props();
	const app = useApp();

	let canvas = $state<HTMLCanvasElement>();
	/** Under reduced motion: redraw this often instead of every frame. */
	const STEP_MS = 250;

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		void app.themeName; // new colours when the colour mode changes
		const colour = {
			vib: token(tone === 'ring' ? '--vib' : '--estim', el),
			fill: tone === 'ring' ? token('--vib-fill', el) : null,
			estim: token(tone === 'ring' ? '--estim' : '--text', el),
			line: token('--line', el)
		};
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let raf = 0;
		let timer: ReturnType<typeof setInterval> | undefined;

		function draw() {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const w = el!.clientWidth;
			const h = el!.clientHeight;
			if (el!.width !== Math.round(w * dpr) || el!.height !== Math.round(h * dpr)) {
				el!.width = Math.round(w * dpr);
				el!.height = Math.round(h * dpr);
			}
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx!.clearRect(0, 0, w, h);
			// In steps under reduced motion: time only advances every STEP_MS.
			const t = performance.now();
			const now = motion.matches ? Math.floor(t / STEP_MS) * STEP_MS : t;
			const samples = trace.window(now);
			const pad = 2;
			const x = (st: number) => w * (1 - (now - st) / trace.windowMs);
			const y = (v: number) => pad + (h - 2 * pad) * (1 - Math.min(1, Math.max(0, v)));

			// Half-way and base lines.
			ctx!.strokeStyle = colour.line;
			ctx!.lineWidth = 1;
			ctx!.setLineDash([2, 4]);
			ctx!.beginPath();
			ctx!.moveTo(0, y(0.5));
			ctx!.lineTo(w, y(0.5));
			ctx!.stroke();
			ctx!.setLineDash([]);
			if (!samples.length) return;

			const path = (pick: (s: (typeof samples)[number]) => number) => {
				ctx!.beginPath();
				samples.forEach((s, i) => (i ? ctx!.lineTo(x(s.t), y(pick(s))) : ctx!.moveTo(x(s.t), y(pick(s)))));
			};
			// Vibration: soft fill, then its line.
			if (lane !== 'second') {
				path((s) => s.vib);
				ctx!.lineTo(x(samples[samples.length - 1].t), h);
				ctx!.lineTo(x(samples[0].t), h);
				ctx!.closePath();
				// Without a fill colour of its own: the line's colour, thinned.
				ctx!.fillStyle = colour.fill ?? colour.vib;
				ctx!.globalAlpha = colour.fill ? 1 : 0.24;
				ctx!.fill();
				ctx!.globalAlpha = 1;
				ctx!.lineJoin = 'round';
				ctx!.lineWidth = 2;
				ctx!.strokeStyle = colour.vib;
				path((s) => s.vib);
				ctx!.stroke();
			}
			// E-stim: dashed (solid when it is the only line), only when there is any in the window.
			if (lane !== 'first' && samples.some((s) => s.estim > 0)) {
				if (lane === 'both') ctx!.setLineDash([6, 4]);
				ctx!.lineWidth = 2;
				ctx!.strokeStyle = colour.estim;
				path((s) => s.estim);
				ctx!.stroke();
				ctx!.setLineDash([]);
			}
		}

		function stop() {
			cancelAnimationFrame(raf);
			clearInterval(timer);
			raf = 0;
			timer = undefined;
		}
		function start() {
			stop();
			if (document.visibilityState !== 'visible') return;
			if (motion.matches) {
				draw();
				timer = setInterval(draw, STEP_MS);
			} else {
				const loop = () => {
					draw();
					raf = requestAnimationFrame(loop);
				};
				raf = requestAnimationFrame(loop);
			}
		}
		start();
		document.addEventListener('visibilitychange', start);
		motion.addEventListener('change', start);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', start);
			motion.removeEventListener('change', start);
		};
	});
</script>

<div class="graph" class:mini aria-hidden="true">
	<canvas bind:this={canvas}></canvas>
	{#if !mini}
		<div class="axis">
			<span>{m.graph_ago({ time: duration(trace.windowMs / 1000) })}</span>
			<span>{m.graph_now()}</span>
		</div>
	{/if}
</div>

<style>
	.graph {
		grid-column: 1 / -1;
	}
	.mini canvas {
		height: 2rem;
		border-radius: 0.4rem;
	}
	@media (max-width: 479px) and (max-height: 800px) {
		.mini canvas {
			height: 1.6rem;
		}
	}
	@media (min-width: 480px) {
		.mini canvas {
			height: 2.6rem;
		}
	}
	canvas {
		display: block;
		width: 100%;
		height: 4.5rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		background: var(--surface);
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 0.2rem;
		font-size: 0.75rem;
		color: var(--faint);
	}
</style>
