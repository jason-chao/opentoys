<script lang="ts">
	// One of the Coyote's patterns: its name, what it does, its waveform (strength and pulse rate), which
	// channel to start it on, and Start pinned to the bottom of the screen. It always starts at intensity 0.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { duration } from '$lib/app/format';
	import BackLink from '$lib/components/BackLink.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NoBreak from '$lib/components/NoBreak.svelte';
	import { lanesOf, patternById, patternDescription, patternName } from './catalogue';
	import { channelName } from './kind';
	import type { CoyoteDeviceSession } from './session.svelte';
	import { CHANNELS, COYOTE_ID, type Channel } from './settings';
	import { lengthText } from './text';
	import Wave from './Wave.svelte';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const coyote = $derived(session as CoyoteDeviceSession);

	const id = $derived(browser ? page.url.searchParams.get('id') : null);
	const item = $derived(id ? patternById(id) : undefined);
	const lanes = $derived(item ? lanesOf(item.id) : undefined);
	const fav = $derived(!!item && app.isFavourite(COYOTE_ID, item.id));
	const connected = $derived(coyote.connection === 'connected');
	// On a real device nothing starts until the Coyote is set up: Start then opens the set-up.
	const locked = $derived(coyote.needsSetup);

	type Where = Channel | 'both';
	let where = $state<Where>('a');
	const channels = $derived<Channel[]>(where === 'both' ? ['a', 'b'] : [where]);
	// A channel without a maximum is not used: it can't be chosen.
	const available = (w: Where) =>
		!connected || locked || (w === 'both' ? CHANNELS : [w]).every((ch) => coyote.maxima[ch] > 0);
	$effect(() => {
		if (connected && !locked && !available(where)) where = available('a') ? 'a' : 'b';
	});

	// Start goes through the app: with no device connected it opens the connect sheet first, and a Coyote
	// that is not set up gets its set-up first. The pattern starts when those are out of the way.
	function start() {
		if (!item) return;
		app.request({ device: COYOTE_ID, presetId: item.id, opts: { channels } });
	}

	// The now-playing bar (with its Stop) sits above this page's pinned bar, never under it.
	let pinnedH = $state(0);
	$effect(() => {
		document.documentElement.style.setProperty('--pinned-h', `${pinnedH}px`);
		return () => document.documentElement.style.removeProperty('--pinned-h');
	});
</script>

<svelte:head>
	<title>{item ? patternName(item.id) : m.nav_patterns()} · opentoys</title>
</svelte:head>

<div class="page pattern">
	<div class="topline">
		<BackLink
			href={localizeHref('/')}
			label={m.nav_patterns()}
			onfollow={() => app.devices.show(COYOTE_ID)}
		/>
		{#if item}
			<button
				type="button"
				class="star"
				class:on={fav}
				aria-pressed={fav}
				aria-label={fav
					? m.fav_remove({ name: patternName(item.id) })
					: m.fav_add({ name: patternName(item.id) })}
				onclick={() => item && app.toggleFavourite(COYOTE_ID, item.id)}
			>
				<Icon name="star" size={24} filled={fav} />
			</button>
		{/if}
	</div>

	{#if !browser || !id}
		<p class="note">{m.pattern_loading()}</p>
	{:else if !item || !lanes}
		<h1>{m.pattern_missing()}</h1>
	{:else}
		<h1><NoBreak text={patternName(item.id)} /></h1>
		<p class="meta">
			<span class="badge estim">{m.channel_estim()}</span>
			<span class="faint">{coyote.kind.name()} · {lengthText(item.id)}</span>
		</p>
		<p class="lede">{patternDescription(item.id)}</p>

		<section class="wave card" aria-labelledby="wave-title">
			<h2 id="wave-title">{m.waveform_title()}</h2>
			<p class="note">{m.coyote_waveform_shown({ time: duration(lanes.seconds) })}</p>
			<Wave large {lanes} label={m.coyote_waveform_label({ name: patternName(item.id) })} />
		</section>

		<section class="card where" aria-labelledby="where-title">
			<fieldset>
				<legend id="where-title">{m.coyote_where()}</legend>
				<div class="seg">
					{#each ['a', 'b', 'both'] as const as w (w)}
						<label class:on={where === w} class:off={!available(w)}>
							<input
								type="radio"
								name="where"
								value={w}
								checked={where === w}
								disabled={!available(w)}
								onchange={() => (where = w)}
							/>
							{w === 'both' ? m.coyote_both_channels() : channelName(w)}
						</label>
					{/each}
				</div>
			</fieldset>
		</section>
		<p class="note start-note">{locked ? m.coyote_locked_pattern() : m.coyote_start_note()}</p>
	{/if}
</div>

{#if browser && item}
	<div class="pinned" bind:offsetHeight={pinnedH}>
		<button
			type="button"
			class="btn primary wide big"
			disabled={coyote.busy || coyote.silencing}
			onclick={start}
		>
			<Icon name={locked ? 'lock' : 'play'} size={20} />{locked ? m.setup_to_start() : m.start()}
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
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 0.5rem;
		font-size: 1.1rem;
		font-weight: 650;
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
	.seg label.off {
		opacity: 0.45;
		cursor: default;
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
	.big {
		min-height: 58px;
		font-size: 1.1rem;
	}
</style>
