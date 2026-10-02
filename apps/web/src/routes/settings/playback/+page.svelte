<script lang="ts">
	// Settings → Playback: what applies to every device. The session limit, and the three breaths before a start.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import { duration } from '$lib/app/format';
	import type { Settings } from '$lib/app/settings';
	import BackLink from '$lib/components/BackLink.svelte';
	import '$lib/styles/settings.css';

	const app = useApp();
	const s = $derived(app.settings);
	const SESSION_MAX = [15, 30, 45, 60, 90, 120, 180];
	const set = (patch: Partial<Settings>) => void app.update(patch);
</script>

<svelte:head>
	<title>{m.settings_playback()} · opentoys</title>
</svelte:head>

<div class="page settings">
	<BackLink href={localizeHref('/settings/')} label={m.nav_settings()} />
	<h1>{m.settings_playback()}</h1>
	<section class="card" id="session">
		<label class="field">
			<span class="top"><span>{m.limit_session_max()}</span></span>
			<select value={s.sessionMaxMin} onchange={(e) => set({ sessionMaxMin: Number(e.currentTarget.value) })}>
				{#each SESSION_MAX as v (v)}
					<option value={v}>{duration(v * 60)}</option>
				{/each}
				{#if !SESSION_MAX.includes(s.sessionMaxMin)}
					<option value={s.sessionMaxMin}>{duration(s.sessionMaxMin * 60)}</option>
				{/if}
			</select>
			<span class="note">{m.limit_session_max_help()}</span>
		</label>
	</section>
	<section class="card" id="starting">
		<label class="choice">
			<input type="checkbox" checked={s.leadIn} onchange={(e) => set({ leadIn: e.currentTarget.checked })} />
			<span><strong>{m.opt_leadin()}</strong><span class="note">{m.opt_leadin_help()}</span></span>
		</label>
	</section>
</div>
