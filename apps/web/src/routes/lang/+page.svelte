<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { localizeHref, locales } from '$lib/paraglide/runtime';
	import { detectLocale, endonyms, htmlLang, recallLocale, rememberLocale } from '$lib/i18n/locales';

	// Reached at the bare root (/): go on to the language the visitor chose before, else the browser's. Without
	// JavaScript the links below still work; following one is a choice, so it is remembered.
	onMount(() => {
		if (location.pathname !== '/') return;
		const locale = recallLocale() ?? detectLocale(navigator.languages);
		goto(localizeHref('/', { locale }), { replaceState: true });
	});
</script>

<svelte:head>
	<title>opentoys</title>
</svelte:head>

<main>
	<h1>opentoys</h1>
	<ul>
		{#each locales as locale (locale)}
			<li>
				<a
					href={localizeHref('/', { locale })}
					hreflang={htmlLang[locale]}
					lang={htmlLang[locale]}
					onclick={() => rememberLocale(locale)}>{endonyms[locale]}</a
				>
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		display: grid;
		place-content: center;
		gap: 1.5rem;
		min-height: 100svh;
		text-align: center;
		/* With JavaScript this page is only passed through; fade in late so it doesn't flash. */
		animation: appear 0.4s ease-out 0.6s both;
	}
	h1 {
		font-weight: 300;
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	a {
		display: inline-grid;
		place-items: center;
		min-height: 44px;
		padding: 0 1rem;
		color: var(--text);
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
</style>
