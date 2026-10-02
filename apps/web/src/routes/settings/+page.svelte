<script lang="ts">
	// Settings, the hub: one row per device (its page has everything about it), then My devices, Playback and
	// Your data. Each row says where things stand in a few words. (Colour mode and language are in the header,
	// the safety notes and what opentoys is are under About.)
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import { duration } from '$lib/app/format';
	import Icon from '$lib/components/Icon.svelte';
	import '$lib/styles/settings.css';

	const app = useApp();
	const devices = app.devices;
	const s = $derived(app.settings);

	/** Connection and set-up in a few words. */
	function stateOf(d: DeviceSession): string {
		const link =
			d.connection === 'lost'
				? m.status_lost()
				: d.connection !== 'connected'
					? m.card_not_connected()
					: d.preview
						? m.status_preview_short()
						: m.device_connected();
		return m.hub_device_state({ link, setup: d.kind.summary(d) });
	}
</script>

<svelte:head>
	<title>{m.nav_settings()} · opentoys</title>
</svelte:head>

<div class="page settings">
	<h1>{m.settings_title()}</h1>
	<ul class="hub">
		{#each devices.mine as d (d.kind.id)}
			<li>
				<a href="{localizeHref('/settings/device/')}?id={d.kind.id}" data-device={d.kind.id}>
					<span class="title">{d.kind.name()}</span>
					<span class="state">{stateOf(d)}</span>
					<Icon name="chevron" size={18} />
				</a>
			</li>
		{/each}
		<li>
			<a href={localizeHref('/settings/devices/')}>
				<span class="title">{m.settings_my_devices()}</span>
				<Icon name="chevron" size={18} />
			</a>
		</li>
		<li>
			<a href={localizeHref('/settings/playback/')}>
				<span class="title">{m.settings_playback()}</span>
				<span class="state"
					>{m.now_limit({ time: duration(s.sessionMaxMin * 60) })}{#if s.leadIn}
						· {m.opt_leadin()}{/if}</span
				>
				<Icon name="chevron" size={18} />
			</a>
		</li>
		<li>
			<a href={localizeHref('/settings/data/')}>
				<span class="title">{m.settings_data()}</span>
				<span class="state">{m.hub_data_state()}</span>
				<Icon name="chevron" size={18} />
			</a>
		</li>
	</ul>
</div>
