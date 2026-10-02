<script lang="ts">
	// This screen is part of Control now. Links and installed shortcuts from before land there.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';

	onMount(() => void goto(localizeHref('/control/'), { replaceState: true }));
</script>

<svelte:head>
	<title>{m.nav_control()} · opentoys</title>
</svelte:head>

<div class="page">
	<p><a href={localizeHref('/control/')}>{m.nav_control()}</a></p>
</div>
