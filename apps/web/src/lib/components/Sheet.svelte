<script lang="ts">
	// A dialog over the current screen: a sheet rising from the bottom on phones, a centred panel on wide
	// screens. Used for "More" on a Control row, connecting a device, and a device's set-up. While anything is
	// playing it carries its own Stop, since the page's is underneath it.
	import { onMount, type Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		onclose: () => void;
		/** Tall, for flows with several steps (a set-up). */
		tall?: boolean;
		children: Snippet;
	}
	let { title, onclose, tall = false, children }: Props = $props();

	const devices = useApp().devices;
	const id = $props.id();
	let sheet = $state<HTMLElement>();

	onMount(() => {
		const before = document.activeElement as HTMLElement | null;
		sheet?.focus();
		return () => before?.focus?.();
	});

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]';
	function onKey(e: KeyboardEvent) {
		// Esc stops output first (the app-wide rule). With nothing playing it closes the sheet.
		if (e.key === 'Escape' && !devices.anyActive) {
			e.preventDefault();
			onclose();
		}
		if (e.key !== 'Tab' || !sheet) return;
		// Keep the focus inside while it is open.
		const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => el.offsetParent !== null
		);
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const at = document.activeElement;
		if (e.shiftKey && (at === first || at === sheet)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && at === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div
		class="sheet"
		class:tall
		role="dialog"
		aria-modal="true"
		aria-labelledby="{id}-title"
		tabindex="-1"
		bind:this={sheet}
	>
		<header>
			<h2 id="{id}-title">{title}</h2>
			<button type="button" class="close" aria-label={m.close()} onclick={onclose}>
				<Icon name="close" size={20} />
			</button>
		</header>
		<div class="body">
			{@render children()}
		</div>
		{#if devices.anyActive}
			<footer>
				<button type="button" class="stop" onclick={() => devices.stopAll()}>
					<Icon name="stop" size={20} />{m.stop()}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		align-items: end;
		justify-items: center;
		background: rgb(0 0 0 / 0.5);
	}
	.sheet {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		width: min(100%, 34rem);
		max-height: 92svh;
		border-radius: 1.5rem 1.5rem 0 0;
		background: var(--raised);
		box-shadow: var(--shadow);
	}
	.sheet.tall {
		min-height: min(70svh, 40rem);
	}
	.sheet:focus {
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.6rem 0.6rem 0.2rem 1.2rem;
	}
	h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.close {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--soft);
		cursor: pointer;
	}
	.body {
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.4rem 1.2rem 1.2rem;
	}
	footer {
		padding: 0.6rem 1.2rem max(0.8rem, env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
	}
	.body:last-child {
		padding-bottom: max(1.2rem, env(safe-area-inset-bottom));
	}
	.stop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 52px;
		border: 0;
		border-radius: 999px;
		background: var(--stop-bg);
		color: var(--stop-fg);
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
	}
	@media (min-width: 700px) {
		.scrim {
			align-items: center;
		}
		.sheet {
			border-radius: 1.5rem;
			max-height: 86svh;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.sheet {
			animation: rise 0.18s ease-out;
		}
		@keyframes rise {
			from {
				translate: 0 1.5rem;
				opacity: 0;
			}
		}
	}
</style>
