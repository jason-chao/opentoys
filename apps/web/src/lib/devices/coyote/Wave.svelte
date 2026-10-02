<script lang="ts">
	// A Coyote pattern's waveform. The thumbnail shows its strength over one pass. The large version gives
	// strength and pulse rate (pulses per second, on a log scale) a labelled lane each, with a time axis.
	import { m } from '$lib/paraglide/messages';
	import { areaPath, linePath, timeTicks } from '$lib/app/waveform';
	import { duration, num } from '$lib/app/format';
	import type { Lanes } from './catalogue';

	interface Props {
		lanes: Lanes;
		large?: boolean;
		/** Text for screen readers (the picture itself is decorative for them). */
		label?: string;
	}
	let { lanes, large = false, label }: Props = $props();

	const W = 600;
	const LANE = 90;
	const ticks = $derived(timeTicks(lanes.seconds, 6));
	const x = (t: number) => (lanes.seconds > 0 ? (t / lanes.seconds) * W : 0);
	// Each value lasts 25 ms: drawn as steps, which is what is sent.
	const steps = (values: readonly number[]) => values.flatMap((v) => [v, v]);
</script>

{#if !large}
	<svg class="thumb" viewBox="0 0 120 44" preserveAspectRatio="none" aria-hidden="true">
		<path class="fill" d={areaPath(lanes.strength, 120, 44, 2)} />
		<path class="line" d={linePath(lanes.strength, 120, 44, 2)} vector-effect="non-scaling-stroke" />
	</svg>
{:else}
	<figure class="large" role="img" aria-label={label}>
		<div class="lane-block">
			<div class="lane-label" aria-hidden="true"><span class="key"></span>{m.coyote_lane_strength()}</div>
			<svg class="lane-svg" viewBox="0 0 {W} {LANE}" preserveAspectRatio="none" aria-hidden="true">
				<line class="grid" x1="0" x2={W} y1={LANE / 2} y2={LANE / 2} vector-effect="non-scaling-stroke" />
				{#each ticks as t (t)}
					<line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={LANE} vector-effect="non-scaling-stroke" />
				{/each}
				<path class="fill" d={areaPath(steps(lanes.strength), W, LANE, 2)} />
				<path
					class="line"
					d={linePath(steps(lanes.strength), W, LANE, 2)}
					vector-effect="non-scaling-stroke"
				/>
			</svg>
		</div>
		<div class="lane-block">
			<div class="lane-label" aria-hidden="true">
				<span class="key freq"></span>{m.coyote_lane_rate()}
				<span class="range"
					>{lanes.rateRange[0] === lanes.rateRange[1]
						? m.coyote_rate_fixed({ value: num(lanes.rateRange[0], 0) })
						: m.coyote_rate_range({
								from: num(lanes.rateRange[0], 0),
								to: num(lanes.rateRange[1], 0)
							})}</span
				>
			</div>
			<svg class="lane-svg" viewBox="0 0 {W} {LANE}" preserveAspectRatio="none" aria-hidden="true">
				<line class="grid" x1="0" x2={W} y1={LANE / 2} y2={LANE / 2} vector-effect="non-scaling-stroke" />
				{#each ticks as t (t)}
					<line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={LANE} vector-effect="non-scaling-stroke" />
				{/each}
				<path
					class="freq-line"
					d={linePath(steps(lanes.rate), W, LANE, 6)}
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			<!-- The scale: 100, 10 and 1 pulses a second (top, middle, bottom). -->
			<div class="scale" aria-hidden="true">
				<span>{num(100, 0)}</span><span>{num(10, 0)}</span><span>{num(1, 0)}</span>
			</div>
		</div>
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
	.fill {
		fill: color-mix(in srgb, var(--estim) 24%, transparent);
	}
	.line {
		fill: none;
		stroke: var(--estim);
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.freq-line {
		fill: none;
		stroke: var(--soft);
		stroke-width: 2.2;
		stroke-dasharray: 8 5;
		stroke-linejoin: round;
	}
	.large {
		margin: 0;
	}
	.lane-svg .line {
		stroke-width: 2.2;
	}
	.lane-block {
		position: relative;
	}
	.lane-block + .lane-block {
		margin-top: 0.9rem;
	}
	.scale {
		position: absolute;
		right: 0.4rem;
		bottom: 0;
		height: 5.5rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 0.2rem 0;
		font-size: 0.7rem;
		line-height: 1;
		text-align: right;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
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
	.range {
		margin-left: auto;
		font-weight: 500;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
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
		border-top: 3px solid var(--estim);
	}
	.key.freq {
		border-top: 3px dashed var(--soft);
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
