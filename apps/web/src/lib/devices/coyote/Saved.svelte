<script lang="ts">
	// What is saved for the Coyote: the patterns starred as favourites.
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import NoBreak from '$lib/components/NoBreak.svelte';
	import { lanesOf, patternById, patternName, type Pattern } from './catalogue';
	import { COYOTE_ID } from './settings';
	import { lengthText } from './text';
	import Wave from './Wave.svelte';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const favourites = $derived(
		app.settings.favourites
			.filter((f) => f.device === COYOTE_ID)
			.map((f) => patternById(f.id))
			.filter((p): p is Pattern => !!p)
	);
</script>

<section aria-labelledby="coyote-fav-title">
	<h2 id="coyote-fav-title">
		{m.saved_favourites_of({ device: session.kind.name() })}
	</h2>
	{#if favourites.length === 0}
		<p class="note">{m.favourites_empty()}</p>
	{:else}
		<ul class="list">
			{#each favourites as item (item.id)}
				{@const lanes = lanesOf(item.id)}
				<li>
					<a class="item" href="{localizeHref('/pattern/')}?device={COYOTE_ID}&id={item.id}">
						<span class="thumb"
							>{#if lanes}<Wave {lanes} />{/if}</span
						>
						<span class="body">
							<span class="name"><NoBreak text={patternName(item.id)} /></span>
							<span class="faint small">{lengthText(item.id)}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		margin-top: 1.8rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.3rem;
	}
	.list {
		display: grid;
		gap: 0.5rem;
		margin: 0.6rem 0;
		padding: 0;
		list-style: none;
	}
	.item {
		display: grid;
		grid-template-columns: 6rem 1fr;
		gap: 0.9rem;
		align-items: center;
		min-height: 4.5rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: var(--surface);
		text-decoration: none;
	}
	.thumb {
		height: 3.4rem;
		padding: 0.25rem;
	}
	.body {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.name {
		font-weight: 700;
	}
	.small {
		font-size: 0.85rem;
	}
</style>
