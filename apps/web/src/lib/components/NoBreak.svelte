<script lang="ts">
	// Text for a heading, where "e-stim" must not break at its hyphen ("e-" / "stim").
	let { text }: { text: string } = $props();
	const parts = $derived(text.split(/(e-stim)/i));
</script>

{#each parts as part, i (i)}{#if i % 2}<span class="nw">{part}</span>{:else}{part}{/if}{/each}

<style>
	.nw {
		white-space: nowrap;
	}
</style>
