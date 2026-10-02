<script lang="ts">
	// The Coyote's patterns: its built-in waveforms in one list (it has a single section, so there is no tab
	// row), each with a thumbnail of its strength and a star. Starred patterns come first.
	import { browser } from '$app/environment';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import Icon from '$lib/components/Icon.svelte';
	import NoBreak from '$lib/components/NoBreak.svelte';
	import { lanesOf, patternDescription, patternName, PATTERNS } from './catalogue';
	import { lengthText } from './text';
	import type { CoyoteDeviceSession } from './session.svelte';
	import { COYOTE_ID } from './settings';
	import Wave from './Wave.svelte';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const coyote = $derived(session as CoyoteDeviceSession);

	// Favourites first, in the order they were starred, then the rest in the library's order.
	const shown = $derived.by(() => {
		const starred = app.settings.favourites.filter((f) => f.device === COYOTE_ID).map((f) => f.id);
		const rank = (id: string) => (starred.includes(id) ? starred.indexOf(id) : starred.length);
		return [...PATTERNS].sort((x, y) => rank(x.id) - rank(y.id));
	});
</script>

<div class="page">
	<h1>{m.patterns_title()}</h1>
	<p class="lede">{m.patterns_lede()}</p>

	<div class="section" hidden={browser && !app.ready}>
		{#if coyote.needsSetup}
			<p class="locked">
				<Icon name="lock" size={18} />
				<span>
					{m.coyote_locked_list()}
					<button type="button" class="inline" onclick={() => app.openSetup(COYOTE_ID)}
						>{m.coyote_setup_link()}</button
					>
				</span>
			</p>
		{/if}

		<ul class="list">
			{#each shown as item (item.id)}
				{@const fav = app.isFavourite(COYOTE_ID, item.id)}
				{@const lanes = lanesOf(item.id)}
				<li class="row">
					<a class="row-link" href="{localizeHref('/pattern/')}?device={COYOTE_ID}&id={item.id}">
						<span class="thumb"
							>{#if lanes}<Wave {lanes} />{/if}</span
						>
						<span class="text">
							<span class="name"><NoBreak text={patternName(item.id)} /></span>
							<span class="desc">{patternDescription(item.id)}</span>
							<span class="meta">
								<span class="badge estim">{m.channel_estim()}</span>
								<span class="length">{lengthText(item.id)}</span>
							</span>
						</span>
					</a>
					<button
						type="button"
						class="star"
						class:on={fav}
						aria-pressed={fav}
						aria-label={fav
							? m.fav_remove({ name: patternName(item.id) })
							: m.fav_add({ name: patternName(item.id) })}
						onclick={() => app.toggleFavourite(COYOTE_ID, item.id)}
					>
						<Icon name="star" size={22} filled={fav} />
					</button>
				</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.locked {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		margin: 0 0 0.8rem;
		padding: 0.7rem 0.9rem;
		border-radius: 0.9rem;
		background: var(--surface);
		font-size: 0.9rem;
		color: var(--soft);
	}
	.locked :global(svg) {
		flex: none;
		margin-top: 0.15rem;
	}
	.inline {
		min-height: 44px;
		padding: 0;
		border: 0;
		background: transparent;
		font-weight: 650;
		text-decoration: underline;
		cursor: pointer;
	}
	.list {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: var(--surface);
		transition: background 0.2s;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.row-link {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr);
		gap: 0.9rem;
		align-items: center;
		min-height: 5.5rem;
		padding: 0.75rem 0 0.75rem 0.75rem;
		border-radius: 1rem;
		text-decoration: none;
	}
	.star {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		margin: 0.2rem 0.1rem 0 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--faint);
		cursor: pointer;
	}
	.star.on {
		color: var(--accent);
	}
	.thumb {
		height: 3.4rem;
		padding: 0.25rem;
		border-radius: 0.6rem;
		background: var(--surface);
	}
	.text {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.name {
		font-size: 1.05rem;
		font-weight: 700;
	}
	.desc {
		font-size: 0.88rem;
		line-height: 1.45;
		color: var(--soft);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
		margin-top: 0.25rem;
	}
	.length {
		font-size: 0.8rem;
		color: var(--faint);
	}
</style>
