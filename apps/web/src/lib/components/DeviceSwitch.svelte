<script lang="ts">
	// Which of My devices is shown (Patterns, Manual). Only there when there is more than one device.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';

	const devices = useApp().devices;
</script>

{#if devices.several}
	<div class="switch" role="group" aria-label={m.settings_device()}>
		{#each devices.mine as s (s.kind.id)}
			<button type="button" aria-pressed={devices.shown === s} onclick={() => devices.show(s.kind.id)}
				>{s.kind.name()}</button
			>
		{/each}
	</div>
{/if}

<style>
	.switch {
		display: flex;
		gap: 0.4rem;
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem 1rem 0;
	}
	button {
		flex: 1;
		min-height: 44px;
		padding: 0.3rem 0.8rem;
		font-size: 0.92rem;
		line-height: 1.25;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font-weight: 650;
		color: var(--soft);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--text);
	}
</style>
