<script lang="ts">
	// Settings → My devices: which devices the user has. The rest of the app shows only what applies to them.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import BackLink from '$lib/components/BackLink.svelte';
	import MyDevices from '$lib/components/MyDevices.svelte';
	import '$lib/styles/settings.css';
</script>

<svelte:head>
	<title>{m.settings_my_devices()} · opentoys</title>
</svelte:head>

<div class="page settings">
	<BackLink href={localizeHref('/settings/')} label={m.nav_settings()} />
	<h1>{m.settings_my_devices()}</h1>
	<section class="card">
		<MyDevices keepOne />
		<p class="note">{m.devices_help_settings()}</p>
	</section>
</div>
