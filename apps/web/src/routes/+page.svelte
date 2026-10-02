<script lang="ts">
	// Patterns (home): the patterns of the device shown, with a device switch when there are several.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { screensOf } from '$lib/devices/screens';
	import DeviceSwitch from '$lib/components/DeviceSwitch.svelte';

	const devices = useApp().devices;
	const session = $derived(devices.shown);
	const Patterns = $derived(screensOf(session).Patterns);
</script>

<svelte:head>
	<title>{m.nav_patterns()} · opentoys</title>
	<meta name="description" content={m.meta_description()} />
</svelte:head>

<DeviceSwitch />
{#key session}
	<Patterns {session} />
{/key}
