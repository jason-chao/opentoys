<script lang="ts">
	import { untrack } from 'svelte';
	import { createOrb, type Level, type OrbHandle, type OrbPalette, type OrbVariant } from './engine';

	interface Props {
		variant: OrbVariant;
		read: () => Level;
		palette: OrbPalette;
		label: string;
		radius?: number;
		center?: [number, number];
		class?: string;
	}

	let { variant, read, palette, label, radius = 0.3, center = [0, 0], class: klass = '' }: Props = $props();

	let canvas: HTMLCanvasElement;
	let orb: OrbHandle | undefined;

	$effect(() => {
		// Created once per variant; palette and layout changes are pushed in below without a rebuild.
		const v = variant;
		const handle = untrack(() =>
			createOrb(canvas, {
				variant: v,
				read: () => read(),
				palette: $state.snapshot(palette) as OrbPalette,
				radius,
				center
			})
		);
		orb = handle;
		return () => {
			handle.destroy();
			orb = undefined;
		};
	});

	$effect(() => {
		orb?.setPalette($state.snapshot(palette) as OrbPalette);
	});

	$effect(() => {
		orb?.setLayout(radius, center);
	});
</script>

<div class="orb {klass}" role="img" aria-label={label}>
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.orb {
		position: relative;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		display: block;
	}
</style>
