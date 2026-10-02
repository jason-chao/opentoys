<script lang="ts">
	// Saved: each device's saved patterns (the ring: recorded in free control, or imported), and the history
	// of what played, on which device.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import type { JournalEntry } from '$lib/app/storage';
	import { dateTime, duration } from '$lib/app/format';
	import { screensOf } from '$lib/devices/screens';

	const app = useApp();
	const devices = app.devices;
	const mine = $derived(devices.mine);
	const withSaved = $derived(mine.filter((d) => screensOf(d).Saved));

	const savedName = (id: number) => app.modes.find((x) => x.id === id)?.name;
	/** What an entry played, in the words of the device it was on. */
	const what = (entry: JournalEntry) => devices.kindOf(entry.device).describe(entry.what, savedName);
</script>

<svelte:head>
	<title>{m.nav_saved()} · opentoys</title>
</svelte:head>

<div class="page">
	<h1>{m.saved_title()}</h1>

	{#each withSaved as device (device.kind.id)}
		{@const Saved = screensOf(device).Saved}
		{#if Saved}<Saved session={device} />{/if}
	{/each}

	<section aria-labelledby="history-title">
		<h2 id="history-title">{m.history_title()}</h2>
		<p class="note">{m.history_lede()}</p>
		{#if app.journal.length === 0}
			<p class="note">{m.history_empty()}</p>
		{:else}
			<ul class="history">
				{#each app.journal as entry (entry.id)}
					<li>
						<div>
							<p class="name">{what(entry)}</p>
							<p class="faint small">{devices.kindOf(entry.device).name()}</p>
							<p class="faint small">{dateTime(entry.at)} · {duration(entry.durationS)}</p>
							<p class="faint small">{devices.kindOf(entry.device).stopText(entry.ended)}</p>
						</div>
						<button
							type="button"
							class="btn small"
							aria-label={m.history_delete_label({ what: what(entry) })}
							onclick={() => app.deleteJournalEntry(entry.id)}>{m.delete()}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	section {
		margin-top: 1.8rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.3rem;
	}
	.history {
		display: grid;
		gap: 0.5rem;
		margin: 0.6rem 0;
		padding: 0;
		list-style: none;
	}
	.name {
		margin: 0;
		font-weight: 700;
	}
	.small {
		margin: 0;
		font-size: 0.85rem;
	}
	.history li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: 1rem;
	}
</style>
