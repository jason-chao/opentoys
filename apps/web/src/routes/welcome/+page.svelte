<script lang="ts">
	// First run, kept short: what opentoys is, which devices the visitor has, and the 18+ tick. From there
	// either connect (each device's set-up, with its safety notes, follows its first connection, here or
	// anywhere later), or look around without a device, which previews the chosen devices (both when none is
	// chosen) and goes straight to Patterns.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { detectLocale, recallLocale } from '$lib/i18n/locales';
	import { useApp } from '$lib/app/app.svelte';
	import { restingLevels } from '$lib/orb/levels';
	import ConnectPanel from '$lib/components/ConnectPanel.svelte';
	import MyDevices from '$lib/components/MyDevices.svelte';
	import LiveOrb from '$lib/components/LiveOrb.svelte';

	const app = useApp();
	const devices = app.devices;
	const mine = $derived(devices.mine);

	let step = $state(1);
	let adult = $state(false);

	// A first visit follows the browser's language, until the visitor chooses one (the header menu).
	onMount(() => {
		if (recallLocale()) return;
		const locale = detectLocale(navigator.languages);
		if (locale !== getLocale())
			void goto(localizeHref(page.url.pathname + page.url.search, { locale }), { replaceState: true });
	});

	// Someone who was here before lands on the patterns.
	$effect(() => {
		if (app.ready && app.settings.adult && step === 1) void goto(localizeHref('/'), { replaceState: true });
	});

	function finish() {
		void goto(localizeHref('/'));
	}
	async function next() {
		if (!adult || mine.length === 0) return;
		step = 2;
		await app.update({ adult: true });
	}
	// Without a device: a preview of the chosen devices, or of every device when none is chosen.
	async function lookAround() {
		if (!adult) return;
		step = 2;
		if (mine.length === 0) await app.setDevices(devices.registry.ids);
		await app.update({ adult: true });
		if (await devices.lookAround()) finish();
	}
	// With one device, connecting it is all there is to do here: its set-up opens over this screen, and when
	// that closes the patterns are next. With several, Continue moves on once the others had their turn.
	const oneConnected = $derived(mine.length === 1 && mine[0].real && !app.setup);
	$effect(() => {
		if (step === 2 && oneConnected) finish();
	});

	const idle = () => restingLevels(performance.now() / 1000);
</script>

<svelte:head>
	<title>{m.welcome_title()} · opentoys</title>
</svelte:head>

<div class="page welcome">
	{#if step === 1}
		<LiveOrb class="orb" read={idle} label={m.orb_decor_label()} radius={0.3} />
		<h1>{m.welcome_title()}</h1>
		<p class="lede">{m.welcome_what()}</p>
		<MyDevices />
		<label class="check adult">
			<input type="checkbox" bind:checked={adult} />
			<span>{m.welcome_adult()}</span>
		</label>
		<div class="actions">
			<button type="button" class="btn primary" disabled={!adult || mine.length === 0} onclick={next}
				>{m.next()}</button
			>
			<button type="button" class="btn" disabled={!adult} onclick={lookAround}>{m.connect_preview()}</button>
		</div>
		<p class="note">{m.welcome_privacy()}</p>
	{:else}
		<h1>{m.welcome_connect_title()}</h1>
		<p class="lede">{m.welcome_connect_lede()}</p>
		{#each mine as device, i (device.kind.id)}
			<div class="card">
				<h2>{device.kind.name()}</h2>
				<ConnectPanel session={device} previewOption={false} legal={i === mine.length - 1} />
			</div>
		{/each}
		<div class="actions">
			{#if mine.length > 1}
				<button type="button" class="btn primary" disabled={!mine.some((d) => d.real)} onclick={finish}
					>{m.welcome_accept()}</button
				>
			{/if}
			<button type="button" class="btn" onclick={lookAround}>{m.connect_preview()}</button>
		</div>
		{#if mine.length > 1}<p class="note">{m.welcome_connect_several()}</p>{/if}
	{/if}
</div>

<style>
	.welcome {
		max-width: 34rem;
		padding-bottom: 3rem;
	}
	.welcome :global(.orb) {
		height: 11rem;
		margin: 0 -1rem;
	}
	.adult {
		margin: 0.8rem 0 1rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.8rem;
	}
	.actions .btn {
		white-space: normal;
		text-align: center;
	}
	.card {
		margin-bottom: 1rem;
	}
	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
</style>
