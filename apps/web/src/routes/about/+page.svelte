<script lang="ts">
	// About: what opentoys is, the legal notice, privacy in one line, the safety notes (what every device
	// shares once, with the own-risk line, then each of the user's devices' own), the version and the source.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { screensOf } from '$lib/devices/screens';
	import Icon from '$lib/components/Icon.svelte';
	import SharedSafety from '$lib/components/SharedSafety.svelte';
	import pkg from '../../../package.json';
	import '$lib/styles/settings.css';

	const devices = useApp().devices;
	// Before any device is chosen: every device's notes.
	const shown = $derived(devices.mine.length ? devices.mine : devices.sessions);
</script>

<svelte:head>
	<title>{m.nav_about()} · opentoys</title>
</svelte:head>

<div class="page settings about">
	<h1>{m.about_title()}</h1>
	<section class="card" id="what">
		<p>{m.about_what()}</p>
		<p>{m.welcome_privacy()}</p>
		<p class="note">{m.legal_disclaimer()}</p>
	</section>

	<section id="safety" aria-labelledby="h-safety">
		<h2 id="h-safety">{m.settings_safety()}</h2>
		<!-- What every device shares, once. Then what is each device's own, under its name. -->
		<div class="card notes shared">
			<SharedSafety />
		</div>
		{#each shown as device (device.kind.id)}
			{@const Notes = screensOf(device).SafetyNotes}
			<div class="card notes">
				<h3>{device.kind.name()}</h3>
				<Notes own />
			</div>
		{/each}
	</section>

	<p class="version faint">{m.about_version({ version: pkg.version })}</p>
	<!-- The app's one outward link. A plain link the user taps, with no referrer: the page fetches nothing. -->
	<a class="source" href="https://github.com/jason-chao/opentoys" rel="noopener noreferrer" target="_blank">
		<Icon name="github" size={20} />{m.about_source()}
	</a>
</div>

<style>
	#safety {
		margin-top: var(--space-section);
	}
	.notes {
		margin-top: var(--space-card);
	}
	.notes h3 {
		margin-top: 0;
	}
	.version {
		margin: var(--space-section) 0 0;
		font-size: 0.85rem;
	}
	.source {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		margin-top: 0.2rem;
		font-size: 0.9rem;
		font-weight: 650;
	}
</style>
