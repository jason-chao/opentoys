<script lang="ts">
	// One pattern (?id=…) of one device (?device=…). A link that doesn't say which is from before there were
	// several devices: the ring's.
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { useApp } from '$lib/app/app.svelte';
	import { screensOf } from '$lib/devices/screens';

	const devices = useApp().devices;
	const session = $derived(
		(browser ? devices.session(page.url.searchParams.get('device') ?? '') : undefined) ??
			devices.session(devices.registry.legacy.id) ??
			devices.sessions[0]
	);
	const Pattern = $derived(screensOf(session).Pattern);
</script>

{#key session}
	<Pattern {session} />
{/key}
