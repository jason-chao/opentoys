<script lang="ts">
	// The ring's safety notes, kind but clear. Shown in its set-up and under About.
	import { m } from '$lib/paraglide/messages';

	/** Only what is the ring's own: the notes every device shares are shown once, above (About). */
	let { own = false }: { own?: boolean } = $props();
</script>

<ul class="safety">
	{#if !own}<li>{m.safety_adults()}</li>{/if}
	<li>{m.safety_estim_what()}</li>
	{#if !own}<li><strong>{m.safety_estim_medical()}</strong></li>{/if}
	<li>{m.safety_estim_below_waist()}</li>
	{#if !own}
		<li>{m.safety_never_sleeping()}</li>
		<li>{m.safety_stop_hurts()}</li>
		<li>{m.own_risk()}</li>
	{/if}
</ul>

<style>
	.safety {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
