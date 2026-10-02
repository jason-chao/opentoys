<script lang="ts">
	// What opens over the current screen, wherever it was asked for: the connect sheet for a device, and a
	// device's set-up. Both carry along the pattern the user was about to start (lib/app/app.svelte.ts).
	import { m } from '$lib/paraglide/messages';
	import { useApp } from '$lib/app/app.svelte';
	import { SCREENS } from '$lib/devices/screens';
	import ConnectPanel from './ConnectPanel.svelte';
	import Sheet from './Sheet.svelte';

	const app = useApp();
	const devices = app.devices;

	const connecting = $derived(app.connecting ? devices.session(app.connecting.device) : undefined);
	const settingUp = $derived(app.setup ? devices.session(app.setup.device) : undefined);
</script>

{#if app.setup && settingUp}
	{@const Setup = SCREENS[settingUp.kind.id].Setup}
	<Sheet tall title={m.setup_title({ device: settingUp.kind.name() })} onclose={() => app.setupClosed()}>
		{#key app.setup}
			<Setup session={settingUp} part={app.setup.part} ondone={() => app.setupClosed()} />
		{/key}
	</Sheet>
{:else if app.connecting && connecting}
	<Sheet
		title={app.connecting.then ? m.start_needs_device() : connecting.kind.name()}
		onclose={() => (app.connecting = null)}
	>
		<ConnectPanel
			session={connecting}
			compact
			onconnected={(kind) => (kind === 'preview' ? app.previewConnected() : undefined)}
		/>
	</Sheet>
{/if}
