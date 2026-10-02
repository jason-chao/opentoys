<script lang="ts">
	// The Coyote's safety notes: pads are a different risk from the ring. Shown in its set-up and under About.
	import { m } from '$lib/paraglide/messages';

	/** Only what is the Coyote's own: the notes every device shares are shown once, above (About). */
	let { own = false }: { own?: boolean } = $props();
</script>

<ul class="safety">
	{#if !own}
		<li>{m.safety_adults()}</li>
		<li><strong>{m.safety_estim_medical()}</strong></li>
	{/if}
	<li><strong>{m.coyote_safety_chest()}</strong></li>
	<li>{m.coyote_safety_contact()}</li>
	<li>{m.coyote_safety_skin()}</li>
	<li>{m.coyote_safety_not()}</li>
	<li>{m.coyote_safety_pads()}</li>
	<li>{m.coyote_safety_start()}</li>
	<li>{m.coyote_safety_break()}</li>
	{#if !own}
		<li>{m.coyote_safety_never()}</li>
		<li>{m.coyote_safety_stop()}</li>
	{/if}
	<li>{m.coyote_safety_maker()}</li>
	{#if !own}<li>{m.own_risk()}</li>{/if}
</ul>

<style>
	.safety {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
