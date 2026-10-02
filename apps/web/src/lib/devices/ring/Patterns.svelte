<script lang="ts">
	// The ring's patterns: favourites and the built-in patterns in three sections, one shown at a time (tabs
	// at the top, so the e-stim and adjustable patterns aren't hidden below a long list), each pattern with its
	// waveform and a star to keep it in Favourites.
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { CatalogueItem } from '@opentoys/core';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import {
		ITEM_BY_ID,
		itemsIn,
		kindOf,
		KINDS,
		lengthText,
		presetDescription,
		presetName,
		SECTIONS,
		THUMBS,
		type Kind,
		type Section
	} from '$lib/app/catalogue';
	import { KIND_LABEL, SECTION_TEXT } from '$lib/app/text';
	import Waveform from '$lib/components/Waveform.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NoBreak from '$lib/components/NoBreak.svelte';
	import type { DeviceSession } from '$lib/app/devices/types';
	import type { RingSession } from './session.svelte';
	import { RING_ID } from './settings';

	let { session }: { session: DeviceSession } = $props();
	const app = useApp();
	const ring = $derived(session as RingSession);

	type Tab = 'favourites' | Section;
	const TABS: readonly Tab[] = ['favourites', ...SECTIONS];

	const favourites = $derived(
		app.settings.favourites
			.filter((f) => f.device === RING_ID)
			.map((f) => ITEM_BY_ID.get(f.id))
			.filter((i): i is CatalogueItem => !!i)
	);

	// The chosen tab lives in the URL (?section=combined), so Back and shared links keep it. Without one:
	// Favourites when there are any, else Vibration. That is decided once, when the page opens, so starring
	// the first pattern doesn't move you to another tab.
	let opening = $state<Tab | null>(null);
	$effect(() => {
		if (app.ready && opening === null)
			opening = untrack(() => (favourites.length ? 'favourites' : 'vibration'));
	});
	const tab = $derived.by((): Tab => {
		const s = browser ? page.url.searchParams.get('section') : null;
		if ((TABS as readonly string[]).includes(s ?? '')) return s as Tab;
		return opening ?? 'vibration';
	});
	// The filter chip lives in the URL too (?kind=waves), so Back from a pattern returns to the same list.
	const kind = $derived.by((): Kind | 'all' => {
		const k = browser ? page.url.searchParams.get('kind') : null;
		return (KINDS as readonly string[]).includes(k ?? '') ? (k as Kind) : 'all';
	});
	function filter(k: Kind | 'all') {
		const url = new URL(page.url);
		if (k === 'all') url.searchParams.delete('kind');
		else url.searchParams.set('kind', k);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	const tabButtons: HTMLButtonElement[] = [];
	// Joins the two halves of "Vibration + e-stim" (a mustache keeps its spaces; plain text wouldn't).
	const PLUS = ' + ';

	function choose(t: Tab, focus = false) {
		const url = new URL(page.url);
		url.searchParams.set('section', t);
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
		if (focus) tabButtons[TABS.indexOf(t)]?.focus();
	}

	// Arrow keys move between the tabs (the ARIA tabs pattern).
	function onTabKey(e: KeyboardEvent) {
		const i = TABS.indexOf(tab);
		const next =
			e.key === 'ArrowRight'
				? i + 1
				: e.key === 'ArrowLeft'
					? i - 1
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? -1
							: null;
		if (next === null) return;
		e.preventDefault();
		choose(TABS.at(next % TABS.length) as Tab, true);
	}

	const shown = $derived(
		tab === 'favourites'
			? favourites
			: itemsIn(tab).filter((i) => tab !== 'vibration' || kind === 'all' || kindOf(i.tags) === kind)
	);
	const count = (t: Tab) => (t === 'favourites' ? favourites.length : itemsIn(t).length);
	// Patterns with e-stim are listed, and e-stim is not available: say that they play vibration only.
	const estimNote = $derived(!ring.estimAvailable && shown.some((i) => i.category !== 'vibration'));
</script>

<div class="page">
	<h1>{m.patterns_title()}</h1>
	<p class="lede">{m.patterns_lede()}</p>

	<p class="legend" aria-hidden="true">
		<span><span class="key vib"></span>{m.channel_vibration()}</span>
		<span><span class="key estim"></span>{m.channel_estim()}</span>
	</p>

	<div class="tabs" role="tablist" aria-label={m.patterns_title()} tabindex="-1" onkeydown={onTabKey}>
		{#each TABS as t, i (t)}
			<button
				bind:this={tabButtons[i]}
				id="tab-{t}"
				type="button"
				role="tab"
				class:fav={t === 'favourites'}
				aria-selected={tab === t}
				aria-controls="panel"
				tabindex={tab === t ? 0 : -1}
				onclick={() => choose(t)}
			>
				{#if t === 'favourites'}
					<Icon name="star" size={20} filled={favourites.length > 0} />
					<span class="visually-hidden">{m.section_favourites()}</span>
				{:else}
					<span class="tab-name"
						>{#each SECTION_TEXT[t].title().split(' + ') as part, j (j)}{#if j}{PLUS}{/if}<span class="nw"
								>{part}</span
							>{/each}</span
					>
				{/if}
				<span class="count">{count(t)}</span>
			</button>
		{/each}
	</div>

	<!-- In the browser the list waits for the stored favourites, so it opens on the right tab at once. -->
	<div class="section" id="panel" role="tabpanel" aria-labelledby="tab-{tab}" hidden={browser && !app.ready}>
		{#if tab !== 'favourites'}<p class="note">{SECTION_TEXT[tab].line()}</p>{/if}

		{#if tab === 'vibration'}
			<div class="chips" role="group" aria-label={m.kind_label()}>
				<button type="button" aria-pressed={kind === 'all'} onclick={() => filter('all')}
					>{m.kind_all()}</button
				>
				{#each KINDS as k (k)}
					<button type="button" aria-pressed={kind === k} onclick={() => filter(k)}>{KIND_LABEL[k]()}</button>
				{/each}
			</div>
		{/if}
		{#if estimNote}
			<p class="locked">
				<Icon name="lock" size={18} />
				<span>
					{m.estim_locked_list()}
					{#if ring.real}
						<button type="button" class="inline" onclick={() => app.openSetup(RING_ID, 'estim')}
							>{m.estim_set_up_link()}</button
						>
					{/if}
				</span>
			</p>
		{/if}
		{#if tab === 'favourites' && favourites.length === 0}
			<p class="empty">{m.favourites_empty()}</p>
		{/if}

		<ul class="list">
			{#each shown as item (item.id)}
				{@const fav = app.isFavourite(RING_ID, item.id)}
				<li class="row">
					<a class="row-link" href="{localizeHref('/pattern/')}?id={item.id}">
						<span class="thumb">
							{#if THUMBS.get(item.id)}
								{@const t = THUMBS.get(item.id)!}
								<Waveform vib={t.vib} estim={t.estim} seconds={t.seconds} />
							{/if}
						</span>
						<span class="text">
							<span class="name"><NoBreak text={presetName(item.id)} /></span>
							<span class="desc">{presetDescription(item.id)}</span>
							<span class="meta">
								{#if item.category === 'vibration'}
									<span class="badge">{m.badge_vibration()}</span>
								{:else if item.category === 'combined'}
									<span class="badge estim">{m.badge_combined()}</span>
								{:else}
									<span class="badge">{m.badge_generated()}</span>
								{/if}
								<span class="length">{lengthText(item)}</span>
							</span>
						</span>
					</a>
					<button
						type="button"
						class="star"
						class:on={fav}
						aria-pressed={fav}
						aria-label={fav
							? m.fav_remove({ name: presetName(item.id) })
							: m.fav_add({ name: presetName(item.id) })}
						onclick={() => app.toggleFavourite(RING_ID, item.id)}
					>
						<Icon name="star" size={22} filled={fav} />
					</button>
				</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.legend {
		display: flex;
		gap: 1.2rem;
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--soft);
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.key {
		display: inline-block;
		width: 1.4rem;
		border-top: 3px solid var(--vib);
	}
	.key.estim {
		border-top: 3px dashed var(--estim);
	}
	.tabs {
		position: sticky;
		top: var(--header-h, 3.6rem);
		z-index: 5;
		display: grid;
		grid-template-columns: auto repeat(3, minmax(0, 1fr));
		gap: 0.3rem;
		margin: 0.8rem -1rem 0;
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--bg) 92%, transparent);
		backdrop-filter: blur(10px);
	}
	.tabs button {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.1rem;
		min-height: 3.4rem;
		padding: 0.35rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 0.9rem;
		background: transparent;
		font: inherit;
		color: var(--soft);
		cursor: pointer;
	}
	.tabs button.fav {
		min-width: 3.2rem;
		color: var(--accent);
	}
	.tabs button[aria-selected='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--text);
	}
	.tab-name {
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
	}
	/* "Vibration + e-stim" may wrap at the plus, never inside "e-stim". */
	.nw {
		white-space: nowrap;
	}
	.count {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--faint);
	}
	.section {
		margin-top: 0.6rem;
	}
	.section > .note {
		margin: 0.2rem 0 0.8rem;
	}
	.chips {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		margin: 0 -1rem 0.6rem;
		padding: 0.2rem 1rem;
		scrollbar-width: none;
	}
	.chips button {
		flex: none;
		min-height: 44px;
		padding: 0 1rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--soft);
		cursor: pointer;
	}
	.chips button[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--text);
	}
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
	.empty {
		margin: 0.5rem 0;
		padding: 1rem;
		border: 1px dashed var(--line);
		border-radius: 1rem;
		color: var(--soft);
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
