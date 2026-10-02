<script lang="ts">
	// One output on Control, the same for every device: its name, what it is playing (or what it needs), the
	// value with − and + (press and hold repeats), "More", and under them a trace of the last seconds across the
	// row's full width, tall enough to show a change in level.
	import { m } from '$lib/paraglide/messages';
	import { hold } from '$lib/app/hold';
	import type { Trace } from '$lib/app/trace';
	import LiveGraph from './LiveGraph.svelte';

	interface Props {
		/** A stable id for the row ('a', 'b', 'vibration', 'estim'). */
		id: string;
		name: string;
		/** The pattern playing on it, or its state in a few words. */
		status: string;
		/** The value as shown ("22", "80%"), or null when there is nothing to step right now. */
		value: string | null;
		/** A smaller second reading (the ring: the level being sent now). */
		live?: string | null;
		canDown?: boolean;
		canUp?: boolean;
		ondown?: () => void;
		onup?: () => void;
		/** In place of the value when the output can't be stepped: what to do first. */
		action?: { label: string; run: () => void } | null;
		trace?: Trace;
		tone?: 'ring' | 'estim';
		/** Which of the trace's two lines is this row's (the ring's two rows share one trace). */
		lane?: 'both' | 'first' | 'second';
		/** The colour of this output's threads in the orb (a CSS variable name), for the dot by its name. */
		thread?: string;
		onmore?: () => void;
	}
	let {
		id,
		name,
		status,
		value,
		live = null,
		canDown = false,
		canUp = false,
		ondown = () => {},
		onup = () => {},
		action = null,
		trace,
		tone = 'estim',
		lane = 'both',
		thread,
		onmore
	}: Props = $props();
</script>

<div class="row" data-output={id} role="group" aria-label={name}>
	<div class="what">
		<p class="label" title="{name} · {status}">
			{#if thread}<span class="dot" style="background: var({thread})" aria-hidden="true"></span>{/if}
			<span class="name">{name}</span>
			<span class="status">{status}</span>
		</p>
	</div>
	{#if action}
		<button type="button" class="btn small action" onclick={action.run}>{action.label}</button>
	{:else}
		<div class="stepper">
			<button type="button" class="round" aria-label={m.cal_lower()} disabled={!canDown} use:hold={ondown}
				>−</button
			>
			<p class="value" aria-live="off">
				<span class="val">{value ?? '–'}</span>
				{#if live !== null}<span class="live">{live}</span>{/if}
			</p>
			<button type="button" class="round" aria-label={m.cal_higher()} disabled={!canUp} use:hold={onup}
				>+</button
			>
		</div>
	{/if}
	{#if onmore}
		<button type="button" class="more" onclick={onmore} aria-label={m.row_more_of({ name })}>
			{m.row_more()}
		</button>
	{/if}
	{#if trace}
		<div class="mini">
			<LiveGraph {trace} {tone} {lane} mini />
		</div>
	{/if}
</div>

<style>
	/* One line per output, 44 px controls: name and what it plays, then − value +, then More; the trace under
	   them, the row's full width. */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem 0.4rem;
		min-height: 46px;
		padding: 0.1rem 0 0.2rem;
		border-top: 1px solid var(--line);
	}
	.what {
		flex: 1;
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	/* The pattern's name sits beside the output's name where it fits, and under it where it doesn't. */
	.label {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.35rem;
		min-width: 0;
		margin: 0;
		line-height: 1.2;
		white-space: nowrap;
	}
	.dot {
		align-self: center;
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}
	.name {
		flex: none;
		font-size: 0.95rem;
		font-weight: 700;
	}
	.status {
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.85rem;
		color: var(--soft);
	}
	.mini {
		flex: 1 0 100%;
		height: 2rem;
	}
	.more {
		flex: none;
		min-width: 44px;
		min-height: 44px;
		padding: 0 0.55rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font-size: 0.82rem;
		font-weight: 650;
		color: var(--soft);
		cursor: pointer;
	}
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		flex: none;
	}
	.round {
		width: 44px;
		height: 44px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--raised);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
		touch-action: manipulation;
		user-select: none;
	}
	.round:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.value {
		display: grid;
		justify-items: center;
		min-width: 3rem;
		margin: 0;
		line-height: 1.05;
	}
	.val {
		font-size: 1.35rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.live {
		font-size: 0.68rem;
		color: var(--soft);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.action {
		flex: none;
		padding: 0 0.8rem;
	}
	/* A short phone: four rows (two devices) must still end above Stop, so the trace is lower there. */
	@media (max-width: 479px) and (max-height: 800px) {
		.row {
			gap: 0 0.4rem;
			min-height: 44px;
			padding: 0.05rem 0;
		}
		.mini {
			height: 1.6rem;
		}
	}
	@media (min-width: 480px) {
		.row {
			gap: 0.6rem;
		}
		.mini {
			height: 2.6rem;
		}
		.val {
			font-size: 1.5rem;
		}
		.value {
			min-width: 3.6rem;
		}
	}
</style>
