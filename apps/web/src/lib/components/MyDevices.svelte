<script lang="ts">
	// "Which devices do you have?": My devices, as a multi-select over the kinds the app implements, in the
	// order devices are listed in everywhere. The rest of the app shows only what applies to the devices chosen.
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { toggleDevice } from '$lib/app/devices/mine';

	/** In Settings: the last device can't be taken out (there would be nothing left to show). */
	let { keepOne = false }: { keepOne?: boolean } = $props();
	const app = useApp();
	const registry = app.devices.registry;
</script>

<fieldset class="mine">
	<legend>{m.devices_question()}</legend>
	{#each registry.kinds as kind (kind.id)}
		<label>
			<input
				type="checkbox"
				checked={app.settings.devices.includes(kind.id)}
				disabled={keepOne && app.settings.devices.length === 1 && app.settings.devices[0] === kind.id}
				onchange={() => app.setDevices(toggleDevice(app.settings.devices, kind.id, registry))}
			/>
			<span class="text"><strong>{kind.name()}</strong><span class="note">{kind.about()}</span></span>
		</label>
	{/each}
</fieldset>

<style>
	.mine {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 0.4rem;
		font-weight: 650;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		min-height: 44px;
		padding: 0.4rem 0;
		cursor: pointer;
	}
	.text {
		display: grid;
		gap: 0.1rem;
	}
	input {
		flex: none;
		width: 1.35rem;
		height: 1.35rem;
		margin-top: 0.15rem;
		accent-color: var(--accent);
	}
</style>
