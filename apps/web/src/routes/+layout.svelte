<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { baseLocale, deLocalizeUrl, extractLocaleFromUrl, localizeHref } from '$lib/paraglide/runtime';
	import { htmlLang } from '$lib/i18n/locales';
	import { App, provideApp } from '$lib/app/app.svelte';
	import Shell from '$lib/components/Shell.svelte';
	import '$lib/styles/base.css';
	import { pwaInfo } from 'virtual:pwa-info';

	let { children } = $props();

	// One app for the whole visit: the player (and its Bluetooth connection) outlives page and language changes.
	const app = provideApp(new App());

	// The bare root (language picker) has no locale in its URL.
	const localized = $derived(page.url.pathname !== '/');
	const locale = $derived(extractLocaleFromUrl(page.url) ?? baseLocale);
	const route = $derived(localized ? deLocalizeUrl(page.url).pathname : '/');

	// The app asks for a page by its path. Languages and routing are the layout's business.
	app.navigate = (path) => void goto(localizeHref(path));
	// Where the user came from, for Back (lib/app/back.ts).
	afterNavigate(({ from }) => (app.previousPath = from?.url.pathname ?? null));

	onMount(() => {
		let detach: (() => void) | undefined;
		void app.init().then((d) => (detach = d));
		return () => detach?.();
	});

	// The language is remembered only when the visitor chooses one (the header menu, or the picker at /), not
	// on every page view: until then a first visit follows the browser's language (routes/welcome).
	$effect(() => {
		if (localized) document.documentElement.lang = htmlLang[locale];
	});

	// First visit (or after "delete everything"): the welcome comes first, with its 18+ confirmation. About
	// can be read without it.
	$effect(() => {
		if (
			app.ready &&
			localized &&
			!app.settings.adult &&
			!route.startsWith('/welcome/') &&
			!route.startsWith('/about/')
		)
			void goto(localizeHref('/welcome/'), { replaceState: true });
	});
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- the plugin's own manifest <link>, no user content -->
	{@html pwaInfo?.webManifest.linkTag ?? ''}
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
</svelte:head>

<!-- Re-render on a language switch so every message is read again in the new locale. -->
{#key locale}
	{#if localized}
		<Shell {route}>{@render children()}</Shell>
	{:else}
		{@render children()}
	{/if}
{/key}
