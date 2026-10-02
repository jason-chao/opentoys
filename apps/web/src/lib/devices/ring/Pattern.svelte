<script lang="ts">
	// One of the ring's patterns, the important things first: its name, what it outputs, its waveform (the preview), its
	// settings (adjustable ones), and Start pinned to the bottom of the screen so it never needs scrolling.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import type { Param } from '@opentoys/core';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import type { RingSession } from './session.svelte';
	import { RING_ID } from './settings';
	import {
		isRandom,
		ITEM_BY_ID,
		lanesFor,
		lengthText,
		paramHint,
		paramLabel,
		paramValue,
		presetDescription,
		presetName
	} from '$lib/app/catalogue';
	import { duration } from '$lib/app/format';
	import Waveform from '$lib/components/Waveform.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NoBreak from '$lib/components/NoBreak.svelte';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const player = $derived(session as RingSession);

	// The id comes from ?id=…, read in the browser only (the page itself is prerendered once).
	const id = $derived(browser ? page.url.searchParams.get('id') : null);
	const item = $derived(id ? ITEM_BY_ID.get(id) : undefined);
	const isGen = $derived(!!item?.generator);
	const fav = $derived(!!item && app.isFavourite(RING_ID, item.id));

	let params = $state<Record<string, number | string>>({});
	let seed = $state(1);
	let estimOn = $state(true);
	$effect(() => {
		// New pattern: its defaults.
		const defaults: Record<string, number | string> = {};
		for (const p of item?.schema ?? []) defaults[p.key] = p.default;
		params = defaults;
		seed = 1;
	});

	const pv = $derived(item ? lanesFor(item.id, 300, isGen ? $state.snapshot(params) : null, seed) : null);
	const estimParam = $derived(item?.schema.some((p) => p.key === 'estim_mode') ?? false);
	const usesEstim = $derived(
		!!item && (item.category === 'combined' || (estimParam && params.estim_mode !== 'off'))
	);
	const estimAvailable = $derived(player.estimAvailable);

	const setParam = (p: Param, value: string) => {
		params = { ...params, [p.key]: p.type === 'number' ? Number(value) : value };
	};

	// Start goes through the app: with no device connected it opens the connect sheet first, and a ring that
	// still needs its set-up gets that first. The pattern starts when those are out of the way.
	function start() {
		if (!item) return;
		app.request({
			device: RING_ID,
			presetId: item.id,
			opts: { params: isGen ? $state.snapshot(params) : null, estimOn: usesEstim && estimOn }
		});
	}

	// The now-playing bar (with its Stop) sits above this page's pinned bar, never under it.
	let pinnedH = $state(0);
	$effect(() => {
		document.documentElement.style.setProperty('--pinned-h', `${pinnedH}px`);
		return () => document.documentElement.style.removeProperty('--pinned-h');
	});
</script>

<svelte:head>
	<title>{item ? presetName(item.id) : m.nav_patterns()} · opentoys</title>
</svelte:head>

<div class="page pattern">
	<div class="topline">
		<BackLink href={localizeHref('/')} label={m.nav_patterns()} onfollow={() => app.devices.show(RING_ID)} />
		{#if item}
			<button
				type="button"
				class="star"
				class:on={fav}
				aria-pressed={fav}
				aria-label={fav
					? m.fav_remove({ name: presetName(item.id) })
					: m.fav_add({ name: presetName(item.id) })}
				onclick={() => item && app.toggleFavourite(RING_ID, item.id)}
			>
				<Icon name="star" size={24} filled={fav} />
			</button>
		{/if}
	</div>

	{#if !browser || !id}
		<p class="note">{m.pattern_loading()}</p>
	{:else if !item || !pv}
		<h1>{m.pattern_missing()}</h1>
	{:else}
		<h1><NoBreak text={presetName(item.id)} /></h1>
		<p class="meta">
			{#if item.category === 'vibration'}
				<span class="badge">{m.badge_vibration()}</span>
			{:else if item.category === 'combined'}
				<span class="badge estim">{m.badge_combined()}</span>
			{:else}
				<span class="badge">{m.badge_generated()}</span>
			{/if}
			<span class="faint">{lengthText(item, params)}</span>
		</p>
		<p class="lede">{presetDescription(item.id)}</p>

		<section class="wave card" aria-labelledby="wave-title">
			<h2 id="wave-title">{m.waveform_title()}</h2>
			<p class="note">
				{isGen ? m.waveform_example() : m.waveform_shown({ time: duration(pv.seconds) })}
			</p>
			<Waveform
				large
				vib={pv.vib}
				estim={pv.estim}
				seconds={pv.seconds}
				label={m.waveform_label({ name: presetName(item.id) })}
			/>
			{#if isGen && isRandom(item)}
				<button
					type="button"
					class="btn small"
					onclick={() => (seed = 1 + Math.floor(Math.random() * 999_999))}>{m.waveform_another()}</button
				>
			{/if}
		</section>

		{#if isGen}
			<section class="params card" aria-labelledby="params-title">
				<h2 id="params-title">{m.params_title()}</h2>
				{#each item.schema as p (p.key)}
					{@const hint = paramHint(item, p)}
					{#if p.type === 'number'}
						<label class="param">
							<span class="param-top">
								<span>{paramLabel(p)}</span>
								<span class="out">{paramValue(p, params[p.key] ?? p.default)}</span>
							</span>
							<input
								type="range"
								min={p.min}
								max={p.max}
								step={p.step}
								value={params[p.key] ?? p.default}
								aria-valuetext={paramValue(p, params[p.key] ?? p.default)}
								oninput={(e) => setParam(p, e.currentTarget.value)}
							/>
							{#if hint}<span class="note hint">{hint}</span>{/if}
						</label>
					{:else}
						<fieldset class="param">
							<legend>{paramLabel(p)}</legend>
							<div class="seg">
								{#each p.options as o (o)}
									<label class:on={params[p.key] === o}>
										<input
											type="radio"
											name={p.key}
											value={o}
											checked={params[p.key] === o}
											onchange={() => setParam(p, o)}
										/>
										{paramValue(p, o)}
									</label>
								{/each}
							</div>
						</fieldset>
					{/if}
				{/each}
			</section>
		{/if}

		{#if usesEstim}
			<section class="options card" aria-label={m.channel_estim()}>
				{#if estimAvailable}
					<label class="check">
						<input type="checkbox" bind:checked={estimOn} />
						<span>{m.start_with_estim()}</span>
					</label>
				{:else}
					<p class="locked">
						<Icon name="lock" size={18} />
						<span>
							{m.estim_locked_pattern()}
							{#if player.real}
								<button type="button" class="inline" onclick={() => app.openSetup(RING_ID, 'estim')}
									>{m.estim_set_up_link()}</button
								>
							{/if}
						</span>
					</p>
				{/if}
			</section>
		{/if}
		<p class="note start-note">{m.start_note()}</p>
	{/if}
</div>

{#if browser && item}
	<div class="pinned" bind:offsetHeight={pinnedH}>
		<button type="button" class="btn primary wide big" disabled={player.busy} onclick={start}>
			<Icon name="play" size={20} />{player.needsSetup ? m.setup_to_start() : m.start()}
		</button>
	</div>
{/if}

<style>
	.pattern {
		padding-bottom: calc(var(--tabbar-h) + 11rem);
	}
	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.star {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--faint);
		cursor: pointer;
	}
	.star.on {
		color: var(--accent);
	}
	.hint {
		margin-top: -0.2rem;
	}
	.options {
		display: grid;
		gap: 0.6rem;
	}
	.options p {
		margin: 0;
	}
	.start-note {
		margin: 0.8rem 0 0;
	}
	.pinned {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
		z-index: 12;
		display: grid;
		justify-items: center;
		padding: 0.9rem 1rem 0.7rem;
		background: linear-gradient(transparent, var(--bg) 40%);
	}
	.pinned .btn {
		max-width: 28rem;
	}
	.inline {
		min-height: 44px;
		padding: 0;
		border: 0;
		background: transparent;
		font-weight: 650;
		text-decoration: underline;
		cursor: pointer;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		margin: 0.3rem 0 0.6rem;
		font-size: 0.9rem;
	}
	.card {
		margin-top: 1rem;
	}
	.card h2 {
		margin: 0 0 0.2rem;
		font-size: 1.1rem;
	}
	.wave .note {
		margin: 0 0 0.9rem;
	}
	.wave .btn {
		margin-top: 0.4rem;
	}
	.param {
		display: grid;
		gap: 0.1rem;
		margin: 0.9rem 0 0;
		padding: 0;
		border: 0;
	}
	.param-top {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-weight: 600;
	}
	.out {
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	legend {
		padding: 0;
		margin-bottom: 0.4rem;
		font-weight: 600;
	}
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.seg label {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.seg label.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.seg input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.seg label:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.big {
		min-height: 58px;
		font-size: 1.1rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 44px;
		font-weight: 600;
	}
	.check input {
		width: 1.4rem;
		height: 1.4rem;
		accent-color: var(--accent);
	}
	.locked {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		color: var(--soft);
	}
	.locked :global(svg) {
		flex: none;
		margin-top: 0.15rem;
	}
</style>
