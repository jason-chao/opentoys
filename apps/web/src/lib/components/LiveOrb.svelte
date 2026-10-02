<script lang="ts">
	// The living orb in the colours of the current colour mode. It only shows: nothing on it can be pressed.
	import { browser } from '$app/environment';
	import Orb from '$lib/orb/Orb.svelte';
	import type { Level, OrbPalette } from '$lib/orb/engine';
	import { useApp } from '$lib/app/app.svelte';
	import { token } from '$lib/app/theme';

	interface Props {
		read: () => Level;
		label: string;
		radius?: number;
		center?: [number, number];
		class?: string;
	}
	let { read, label, radius = 0.3, center = [0, 0], class: klass = '' }: Props = $props();

	const app = useApp();
	// Before the page runs in a browser (prerendering) there is no stylesheet to ask: Ember's colours.
	const FALLBACK: OrbPalette = {
		c0: '#2b0b26',
		c1: '#a33a55',
		c2: '#ff8a4c',
		c3: '#ffe3b3',
		fil: '#fff0c8',
		filA: '#3ff0d8',
		filB: '#b68cff'
	};
	const HEX = /^#[0-9a-f]{6}$/i;

	/** The orb tokens of the mode now applied (styles/base.css). */
	function fromTheme(): OrbPalette {
		const c = ['--orb-0', '--orb-1', '--orb-2', '--orb-3', '--orb-fil', '--orb-fil-a', '--orb-fil-b'].map(
			(name) => token(name)
		);
		if (!c.every((v) => HEX.test(v))) return FALLBACK;
		return {
			c0: c[0],
			c1: c[1],
			c2: c[2],
			c3: c[3],
			fil: c[4],
			filA: c[5],
			filB: c[6],
			light: Number(token('--orb-light')) || 0
		};
	}

	const palette = $derived.by(() => {
		void app.themeName; // read again whenever the mode changes
		return browser ? fromTheme() : FALLBACK;
	});
</script>

<Orb variant="ember" {read} {palette} {label} {radius} {center} class={klass} />
