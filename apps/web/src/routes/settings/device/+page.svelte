<script lang="ts">
	// One device's page in Settings (?id=…): everything about that device, once.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import { screensOf } from '$lib/devices/screens';
	import BackLink from '$lib/components/BackLink.svelte';
	import '$lib/styles/settings.css';

	const devices = useApp().devices;
	const session = $derived(
		(browser ? devices.session(page.url.searchParams.get('id') ?? '') : undefined) ??
			devices.mine[0] ??
			devices.sessions[0]
	);
	const Device = $derived(screensOf(session).Settings);
</script>

<svelte:head>
	<title>{browser ? session.kind.name() : m.nav_settings()} · opentoys</title>
</svelte:head>

<div class="page settings">
	<BackLink href={localizeHref('/settings/')} label={m.nav_settings()} />
	{#if browser}
		<h1>{session.kind.name()}</h1>
		{#key session}
			<Device {session} />
		{/key}
	{/if}
</div>
