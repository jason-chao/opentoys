<script lang="ts">
	// A pattern's waveform: vibration as a filled area (solid line), e-stim as a dashed line. The thumbnail
	// overlays both; the large version gives each channel its own labelled lane with a time axis.
	import { m } from '$lib/paraglide/messages';
	import { areaPath, hasSignal, linePath, timeTicks } from '$lib/app/waveform';
	import { duration } from '$lib/app/format';

	interface Props {
		vib: readonly number[];
		estim: readonly number[];
		/** How many seconds the values cover (for the axis). */
		seconds: number;
		large?: boolean;
		/** Text for screen readers (the picture itself is decorative for them). */
		label?: string;
	}

	let { vib, estim, seconds, large = false, label }: Props = $props();

	const showEstim = $derived(hasSignal(estim));
	// Large: drawing units (the SVG scales to its box).
	const W = 600;
	const LANE = 90;
	const ticks = $derived(timeTicks(seconds, 6));
	const x = (t: number) => (seconds > 0 ? (t / seconds) * W : 0);
</script>

{#if !large}
	<svg class="thumb" viewBox="0 0 120 44" preserveAspectRatio="none" aria-hidden="true">
		<path class="vib-fill" d={areaPath(vib, 120, 44, 2)} />
		<path class="vib-line" d={linePath(vib, 120, 44, 2)} vector-effect="non-scaling-stroke" />
		{#if showEstim}
			<path class="estim-line" d={linePath(estim, 120, 44, 2)} vector-effect="non-scaling-stroke" />
		{/if}
	</svg>
{:else}
	<figure class="large" role="img" aria-label={label}>
		{#each showEstim ? ['vib', 'estim'] : ['vib'] as lane (lane)}
			<div class="lane-block">
				<div class="lane-label" aria-hidden="true">
					<span class="key {lane}"></span>{lane === 'vib' ? m.channel_vibration() : m.channel_estim()}
				</div>
				<svg class="lane-svg" viewBox="0 0 {W} {LANE}" preserveAspectRatio="none" aria-hidden="true">
					<line class="grid" x1="0" x2={W} y1={LANE / 2} y2={LANE / 2} vector-effect="non-scaling-stroke" />
					{#each ticks as t (t)}
						<line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={LANE} vector-effect="non-scaling-stroke" />
					{/each}
					{#if lane === 'vib'}
						<path class="vib-fill" d={areaPath(vib, W, LANE, 2)} />
						<path class="vib-line" d={linePath(vib, W, LANE, 2)} vector-effect="non-scaling-stroke" />
					{:else}
						<path class="estim-line big" d={linePath(estim, W, LANE, 2)} vector-effect="non-scaling-stroke" />
					{/if}
				</svg>
			</div>
		{/each}
		<div class="axis" aria-hidden="true">
			{#each ticks as t (t)}
				<span style="left: {(x(t) / W) * 100}%">{duration(t)}</span>
			{/each}
		</div>
	</figure>
{/if}

<style>
	.thumb {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.vib-fill {
		fill: var(--vib-fill);
	}
	.vib-line {
		fill: none;
		stroke: var(--vib);
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.estim-line {
		fill: none;
		stroke: var(--estim);
		stroke-width: 1.8;
		stroke-dasharray: 4 3;
		stroke-linejoin: round;
	}
	.large {
		margin: 0;
	}
	.lane-svg .vib-line {
		stroke-width: 2.2;
	}
	.estim-line.big {
		stroke-width: 2.4;
		stroke-dasharray: 8 5;
	}
	.lane-block + .lane-block {
		margin-top: 0.9rem;
	}
	.lane-label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin-bottom: 0.3rem;
		font-size: 0.85rem;
		font-weight: 650;
		color: var(--soft);
	}
	.lane-svg {
		display: block;
		width: 100%;
		height: 5.5rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		background: var(--surface);
	}
	.grid {
		stroke: var(--line);
		stroke-dasharray: 2 4;
	}
	.key {
		display: inline-block;
		width: 1.4rem;
		height: 0;
		border-top: 3px solid var(--vib);
	}
	.key.estim {
		border-top: 3px dashed var(--estim);
	}
	.axis {
		position: relative;
		height: 1.5rem;
		margin-top: 0.3rem;
		font-size: 0.78rem;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.axis span {
		position: absolute;
		translate: -50% 0;
		white-space: nowrap;
	}
	.axis span:first-child {
		translate: 0 0;
	}
	.axis span:last-child:not(:first-child) {
		translate: -100% 0;
	}
</style>
