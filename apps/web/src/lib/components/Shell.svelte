<script lang="ts">
	// The frame around every page: the header (brand, colours, language), the devices' status strip, the
	// link-lost alerts (one per device), the page, the now-playing bar with the one Stop for every device, the
	// tab bar (bottom on phones, in the header on wide screens), and what opens over a page (connecting a
	// device, its set-up).
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { useApp } from '$lib/app/app.svelte';
	import Icon from './Icon.svelte';
	import HeaderTools from './HeaderTools.svelte';
	import Overlays from './Overlays.svelte';
	import StatusStrip from './StatusStrip.svelte';

	let { route, children }: { route: string; children: Snippet } = $props();

	const app = useApp();
	const devices = app.devices;

	// Sticky things below the header (e.g. the Patterns tabs) sit under its real height.
	let headerH = $state(0);
	$effect(() => document.documentElement.style.setProperty('--header-h', `${headerH}px`));

	const tabs = [
		{ path: '/', label: m.nav_patterns, icon: 'patterns' },
		{ path: '/control/', label: m.nav_control, icon: 'manual' },
		{ path: '/saved/', label: m.nav_saved, icon: 'saved' },
		{ path: '/settings/', label: m.nav_settings, icon: 'settings' },
		{ path: '/about/', label: m.nav_about, icon: 'about' }
	] as const;

	const inTab = (path: string) =>
		path === '/' ? route === '/' || route.startsWith('/pattern/') : route.startsWith(path);
	const welcome = $derived(route.startsWith('/welcome/'));
	// What is playing, except where its own Stop is on screen already: Control, and an open set-up.
	const nowPlaying = $derived(
		welcome || route.startsWith('/control/') ? [] : devices.active.filter((d) => !d.kind.showsOwnStop(d))
	);

	const onKey = (e: KeyboardEvent) => {
		// Esc stops everything, on every device, from any screen.
		if (e.key === 'Escape' && devices.anyActive) {
			e.preventDefault();
			devices.stopAll();
		}
	};
</script>

<svelte:window onkeydown={onKey} />

<a class="skip" href="#main">{m.skip_to_content()}</a>

<header class="top" bind:offsetHeight={headerH}>
	<a class="brand" href={localizeHref('/')}>opentoys</a>
	{#if !welcome}
		<nav class="desk-nav" aria-label={m.nav_label()}>
			{#each tabs as t (t.path)}
				<a href={localizeHref(t.path)} aria-current={inTab(t.path) ? 'page' : undefined}>{t.label()}</a>
			{/each}
		</nav>
	{/if}
	<div class="end">
		<HeaderTools />
	</div>
</header>

{#if !welcome}<StatusStrip />{/if}

{#each devices.lost as device (device.kind.id)}
	<div class="lost" role="alert">
		<p>
			<span class="lost-device">{device.kind.name()}</span>
			<strong>{m.lost_title()}</strong>
			{device.kind.lostAdvice(device) ?? ''}
		</p>
		<div class="lost-actions">
			<button class="btn primary small" type="button" onclick={() => device.reconnect()}
				>{m.lost_reconnect()}</button
			>
			<button class="btn small" type="button" onclick={() => device.dismissLoss()}>{m.lost_dismiss()}</button>
		</div>
	</div>
{/each}

{#if app.updateReady && !devices.anyActive}
	<div class="update" role="status">
		<p>{m.update_ready()}</p>
		<div class="lost-actions">
			<button class="btn primary small" type="button" onclick={() => app.applyUpdate()}
				>{m.update_now()}</button
			>
			<button class="btn small" type="button" onclick={() => (app.updateReady = false)}
				>{m.update_later()}</button
			>
		</div>
	</div>
{/if}

<main id="main" tabindex="-1">
	{@render children()}
</main>

{#if nowPlaying.length}
	<div class="nowbar" role="region" aria-label={m.now_title()}>
		<a class="now-link" href={localizeHref('/control/')}>
			<span class="now-kicker">{m.now_title()}</span>
			{#each nowPlaying as device (device.kind.id)}
				{@const line = device.kind.nowPlaying(device)}
				<span class="now-name">{line.name}</span>
				<span class="now-read">{line.readout}</span>
			{/each}
			{#if nowPlaying.every((d) => d.preview)}<span class="now-preview">{m.status_preview_short()}</span>{/if}
		</a>
		<button class="stop-mini" type="button" onclick={() => devices.stopAll()}>
			<Icon name="stop" size={18} />{m.stop()}
		</button>
	</div>
{/if}

<Overlays />

{#if !welcome}
	<nav class="tabbar" aria-label={m.nav_label()}>
		{#each tabs as t (t.path)}
			<a href={localizeHref(t.path)} aria-current={inTab(t.path) ? 'page' : undefined}>
				<Icon name={t.icon} />
				<span>{t.label()}</span>
			</a>
		{/each}
	</nav>
{/if}

<style>
	.skip {
		position: absolute;
		left: 0.5rem;
		top: -3rem;
		z-index: 50;
		padding: 0.6rem 1rem;
		border-radius: 0.6rem;
		background: var(--raised);
	}
	.skip:focus {
		top: 0.5rem;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: max(0.6rem, env(safe-area-inset-top)) 1rem 0.6rem;
		/* Solid: text scrolling underneath must not show through the header. */
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.brand {
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		text-decoration: none;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
	}
	.desk-nav {
		display: none;
	}
	.end {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.brand {
		flex: none;
	}
	.lost {
		position: sticky;
		top: 4.2rem;
		z-index: 9;
		margin: 0.75rem 1rem 0;
		padding: 0.9rem 1rem;
		border: 2px solid var(--danger);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--bg) 88%, var(--danger));
	}
	.update {
		margin: 0.75rem 1rem 0;
		padding: 0.9rem 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.update p {
		margin: 0 0 0.6rem;
	}
	.lost-device {
		display: block;
		font-size: 0.85rem;
		color: var(--soft);
	}
	.lost p {
		margin: 0 0 0.6rem;
	}
	.lost-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	main:focus {
		outline: none;
	}
	.nowbar {
		position: fixed;
		left: 0.6rem;
		right: 0.6rem;
		/* Above the tab bar, and above a page's own pinned bar (the pattern page's Start) when there is one. */
		bottom: calc(var(--tabbar-h) + var(--pinned-h, 0px) + 0.6rem + env(safe-area-inset-bottom));
		z-index: 12;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 44rem;
		margin: 0 auto;
		padding: 0.45rem 0.45rem 0.45rem 1rem;
		border: 1px solid var(--line);
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--raised) 92%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		box-shadow: var(--shadow);
	}
	.now-link {
		flex: 1;
		min-width: 0;
		display: grid;
		text-decoration: none;
		line-height: 1.3;
	}
	.now-kicker {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.now-name {
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.now-read {
		font-size: 0.8rem;
		color: var(--soft);
		font-variant-numeric: tabular-nums;
	}
	.now-preview {
		font-size: 0.75rem;
		color: var(--faint);
	}
	.stop-mini {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 48px;
		padding: 0 1.1rem;
		border: 0;
		border-radius: 0.9rem;
		background: var(--stop-bg);
		color: var(--stop-fg);
		font-weight: 800;
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 11;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
		padding-bottom: env(safe-area-inset-bottom);
		border-top: 1px solid var(--line);
		background: var(--bg);
	}
	.tabbar a {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.15rem;
		min-width: 0;
		font-size: 0.72rem;
		font-weight: 600;
		text-decoration: none;
		color: var(--faint);
	}
	.tabbar a[aria-current='page'] {
		color: var(--accent);
	}
	@media (min-width: 900px) {
		.tabbar {
			display: none;
		}
		.desk-nav {
			display: flex;
			gap: 0.25rem;
		}
		.desk-nav a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			padding: 0 1rem;
			border-radius: 999px;
			font-weight: 600;
			text-decoration: none;
			color: var(--soft);
		}
		.desk-nav a[aria-current='page'] {
			background: var(--accent-soft);
			color: var(--text);
		}
		.top {
			padding-inline: 1.5rem;
		}
	}
</style>
