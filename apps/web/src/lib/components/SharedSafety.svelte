<script lang="ts">
	// The safety notes every device shares, for where several devices' notes are shown together (About): said
	// once, above each device's own. A device's set-up shows that device's complete list instead.
	import { m } from '$lib/paraglide/messages';
</script>

<ul class="safety">
	<li>{m.safety_adults()}</li>
	<li><strong>{m.safety_estim_medical()}</strong></li>
	<li>{m.coyote_safety_never()}</li>
	<li>{m.safety_stop_hurts()}</li>
	<li>{m.own_risk()}</li>
</ul>

<style>
	.safety {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding-left: 1.2rem;
	}
</style>
