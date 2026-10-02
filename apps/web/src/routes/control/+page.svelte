<script lang="ts">
	// Control: every output of the user's devices on one screen, playing or not. One orb shows what is playing,
	// each device has a card with one row per output, and one Stop for everything stays in view.
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import { clock, duration } from '$lib/app/format';
	import { orbInput } from '$lib/devices/orb';
	import { RING_ID } from '$lib/devices/ring/settings';
	import { screensOf } from '$lib/devices/screens';
	import { orbLevels } from '$lib/orb/levels';
	import Icon from '$lib/components/Icon.svelte';
	import LiveOrb from '$lib/components/LiveOrb.svelte';

	const app = useApp();
	const devices = app.devices;
	const mine = $derived(devices.mine);
	const pending = $derived(app.pendingStart);
	const hasRing = $derived(mine.some((s) => s.kind.id === RING_ID));
	const elapsed = $derived(Math.max(0, ...mine.filter((s) => s.playing).map((s) => s.elapsedS)));
	const again = $derived(mine.filter((s) => s.hasPlayed && s.canRestart));

	// ----- the optional lead-in: three slow breaths before the pattern starts ----------------------------------
	const IN = 4;
	const OUT = 5;
	let leadT = $state(0);
	let breath = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	const breathIndex = $derived(Math.min(2, Math.floor(leadT / (IN + OUT))));
	const inhale = $derived(leadT - breathIndex * (IN + OUT) < IN);

	$effect(() => {
		if (!pending) return;
		leadT = 0;
		const started = performance.now();
		timer = setInterval(() => {
			leadT = (performance.now() - started) / 1000;
			const x = leadT % (IN + OUT);
			breath =
				x < IN ? 0.5 - 0.5 * Math.cos((Math.PI * x) / IN) : 0.5 + 0.5 * Math.cos((Math.PI * (x - IN)) / OUT);
			if (leadT >= 3 * (IN + OUT)) beginNow();
		}, 100);
		return () => {
			clearInterval(timer);
			breath = 0;
		};
	});
	function beginNow() {
		clearInterval(timer);
		breath = 0;
		app.beginPending();
	}
	onDestroy(() => clearInterval(timer));

	// The orb reads every session's output as it is drawn.
	const read = () => orbLevels(orbInput(devices.mine, performance.now() / 1000, breath));

	function stopAll() {
		app.pendingStart = null; // a lead-in that hasn't started anything yet
		devices.stopAll();
	}

	let stopButton = $state<HTMLButtonElement>();
	$effect(() => {
		// Keyboard users land on Stop as soon as output starts.
		if (devices.anyActive || pending) stopButton?.focus();
	});
</script>

<svelte:head>
	<title>{m.nav_control()} · opentoys</title>
</svelte:head>

<div class="page control">
	<h1 class="visually-hidden">{m.nav_control()}</h1>

	{#if mine.length === 0}
		<p class="lede">{m.control_no_devices()}</p>
		<a class="btn primary" href={localizeHref('/settings/devices/')}>{m.settings_my_devices()}</a>
	{:else}
		<div class="stage">
			<LiveOrb class="orb" {read} label={m.orb_label()} radius={0.34} />
			{#if pending}
				<div class="leadin" aria-live="polite">
					<p class="breath">{inhale ? m.breath_in() : m.breath_out()}</p>
					<p class="note">{m.now_leadin()} {m.breath_count({ n: breathIndex + 1 })}</p>
					<button type="button" class="btn small" onclick={beginNow}>{m.breath_skip()}</button>
				</div>
			{:else}
				<p class="caption">{hasRing ? m.orb_caption() : m.orb_caption_estim()}</p>
			{/if}
		</div>

		<div class="cards" class:two={mine.length > 1}>
			{#each mine as session (session.kind.id)}
				{@const Card = screensOf(session).Card}
				<Card {session} />
			{/each}
		</div>

		{#if devices.anyActive}
			<p class="time">
				{m.now_time({ time: clock(elapsed) })} · {m.now_limit({
					time: duration(app.settings.sessionMaxMin * 60)
				})}
			</p>
		{/if}
	{/if}
</div>

{#if devices.anyActive || pending}
	<div class="stopbar">
		<button type="button" class="stop" bind:this={stopButton} onclick={stopAll} aria-describedby="stop-hint">
			<Icon name="stop" size={22} />{m.stop()}
		</button>
		<!-- Said to assistive technology here. In full, for everyone, under About. -->
		<p id="stop-hint" class="visually-hidden">{m.stop_hint()}</p>
	</div>
{:else if again.length}
	<div class="stopbar">
		<div class="after">
			{#each again as session (session.kind.id)}
				<button type="button" class="btn" onclick={() => session.restart()}
					>{mine.length > 1 ? m.now_again_device({ device: session.kind.name() }) : m.now_again()}</button
				>
			{/each}
		</div>
	</div>
{/if}

<style>
	.control {
		max-width: 62rem;
		padding-top: 0.2rem;
		padding-bottom: calc(var(--tabbar-h) + 6rem);
	}
	.stage {
		display: grid;
		justify-items: center;
		gap: 0.1rem;
	}
	.stage :global(.orb) {
		width: 100%;
		/* Small on a short phone, so that every row of both devices is on screen above Stop, and larger where
		   the screen has room for it. */
		height: clamp(4rem, calc(75svh - 30rem), 13rem);
	}
	.caption {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		line-height: 1.3;
		text-align: center;
		color: var(--faint);
	}
	.leadin {
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		margin-bottom: 0.6rem;
		text-align: center;
	}
	.leadin p {
		margin: 0;
	}
	.breath {
		font-size: 1.6rem;
		font-weight: 300;
	}
	.cards {
		display: grid;
		gap: 0.4rem;
		align-items: start;
	}
	.time {
		margin: 0.6rem 0 0;
		font-size: 0.85rem;
		text-align: center;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.stopbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
		z-index: 12;
		display: grid;
		justify-items: center;
		padding: 0.4rem 1rem 0.45rem;
		background: linear-gradient(transparent, var(--bg) 35%);
	}
	.stop {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		width: min(100%, 26rem);
		min-height: 56px;
		border: 0;
		border-radius: 999px;
		background: var(--stop-bg);
		color: var(--stop-fg);
		font-size: 1.2rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--stop-bg) 16%, transparent),
			var(--shadow);
		cursor: pointer;
	}
	.stop:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 5px;
	}
	.after {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}
	@media (min-width: 900px) {
		.cards.two {
			grid-template-columns: 1fr 1fr;
		}
		.stage :global(.orb) {
			height: 12rem;
		}
	}
</style>
