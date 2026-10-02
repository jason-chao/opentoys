<script lang="ts">
	// Colour mode and language, one tap away on every screen. Both are per-viewer choices kept in this browser.
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { getLocale, localizeHref, locales } from '$lib/paraglide/runtime';
	import { endonyms, htmlLang, rememberLocale, shortNames } from '$lib/i18n/locales';
	import { useApp } from '$lib/app/app.svelte';
	import { THEMES, type ThemeChoice } from '$lib/app/theme';
	import Icon from './Icon.svelte';

	const app = useApp();
	let open = $state<'theme' | 'lang' | null>(null);
	let root: HTMLDivElement | undefined = $state();

	const current = getLocale();
	// Keep the query (?id=…, ?section=…) so a language switch stays on the same thing.
	const hrefFor = (locale: (typeof locales)[number]) =>
		localizeHref(page.url.pathname + page.url.search, { locale });

	const THEME_LABEL: Record<ThemeChoice, () => string> = {
		auto: m.theme_auto,
		ember: m.theme_ember,
		dawn: m.theme_dawn,
		tide: m.theme_tide,
		silk: m.theme_silk
	};

	function pick(theme: ThemeChoice) {
		app.setTheme(theme);
		open = null;
	}

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = null;
	}
	function onKey(e: KeyboardEvent) {
		// Escape also stops output (Shell): closing a menu must not swallow it.
		if (e.key === 'Escape') open = null;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<div class="tools" bind:this={root}>
	<div>
		<button
			class="tool"
			type="button"
			aria-haspopup="true"
			aria-expanded={open === 'theme'}
			aria-controls="theme-menu"
			aria-label={m.header_theme()}
			title={m.header_theme()}
			onclick={() => (open = open === 'theme' ? null : 'theme')}
		>
			<Icon name="palette" size={20} />
		</button>
		{#if open === 'theme'}
			<ul id="theme-menu" class="menu" aria-label={m.header_theme()}>
				{#each THEMES as t (t)}
					<li>
						<button type="button" class="item" aria-pressed={app.theme === t} onclick={() => pick(t)}>
							<span class="swatch {t}" aria-hidden="true"></span>
							{THEME_LABEL[t]()}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div>
		<button
			class="tool"
			type="button"
			aria-haspopup="true"
			aria-expanded={open === 'lang'}
			aria-controls="lang-menu"
			onclick={() => (open = open === 'lang' ? null : 'lang')}
		>
			<Icon name="globe" size={18} />
			<span class="code" lang={htmlLang[current]}>{shortNames[current]}</span>
			<span class="visually-hidden">{m.header_language()}</span>
		</button>
		{#if open === 'lang'}
			<ul id="lang-menu" class="menu" aria-label={m.header_language()}>
				{#each locales as locale (locale)}
					<li>
						<!-- Choosing a language here is what makes it the remembered one. -->
						<a
							class="item"
							href={hrefFor(locale)}
							hreflang={htmlLang[locale]}
							lang={htmlLang[locale]}
							aria-current={locale === current ? 'true' : undefined}
							onclick={() => {
								rememberLocale(locale);
								open = null;
							}}>{endonyms[locale]}</a
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.tools {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 44px;
		min-height: 44px;
		padding: 0 0.45rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--soft);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	.tool:hover,
	.tool[aria-expanded='true'] {
		background: var(--surface);
		color: var(--text);
	}
	/* Under the header, at the right edge of the screen: wide enough for the longest label on any phone. */
	.menu {
		position: fixed;
		right: 0.75rem;
		top: calc(var(--header-h, 3.6rem) + 0.35rem);
		z-index: 20;
		max-width: calc(100vw - 1.5rem);
		min-width: 11.5rem;
		margin: 0;
		padding: 0.35rem;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: 0.9rem;
		background: var(--raised);
		box-shadow: var(--shadow);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: 44px;
		padding: 0 0.8rem;
		border: 0;
		border-radius: 0.6rem;
		background: transparent;
		font: inherit;
		text-align: start;
		text-decoration: none;
		white-space: nowrap;
		color: var(--text);
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface);
	}
	.item[aria-current='true'],
	.item[aria-pressed='true'] {
		font-weight: 700;
		background: var(--accent-soft);
	}
	/* Each mode's own colours (fixed, whatever mode is active): page, vibration colour, e-stim colour. */
	.swatch {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		border: 1px solid var(--line);
	}
	.swatch.ember {
		background: radial-gradient(circle at 35% 35%, #ff9a5c 0 32%, #0b0610 34%);
	}
	.swatch.dawn {
		background: radial-gradient(circle at 35% 35%, #c2410c 0 32%, #fbf5f1 34%);
	}
	.swatch.tide {
		background: radial-gradient(circle at 35% 35%, #5fe0d1 0 32%, #03121b 34%);
	}
	.swatch.silk {
		background: radial-gradient(circle at 35% 35%, #ad4468 0 32%, #f8f0ea 34%);
	}
	.swatch.auto {
		background: linear-gradient(135deg, #fbf5f1 0 50%, #0b0610 50%);
	}
</style>
